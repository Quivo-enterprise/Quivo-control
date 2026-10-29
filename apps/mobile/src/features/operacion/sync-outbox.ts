import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import type { EventoSync } from '@quivo/shared';
import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  marcarAcusados,
  marcarEnviados,
  obtenerLotePendiente,
  obtenerSaludOutbox,
  purgarAcusadosAntesDe,
  recuperarEnviadosHuerfanos,
  renovarLease,
  revertirAPendiente,
  ID_LEASE_DRENAJE,
  PISO_ENTRE_INTENTOS_DRENAJE_MS,
  TTL_LEASE_DRENAJE_MS,
} from '../../db/outbox';
import { ApiError } from '../../shared/api/http-client';
import { syncApi } from '../../shared/api/sync-api';
import { reportarSaludOutbox } from '../../shared/observability/sentry-contexto';
import { idsNoAcusados } from './sync-diff';

const LOTE_MAXIMO = 500;
const BACKOFF_INICIAL_MS = 2_000;
const BACKOFF_MAXIMO_MS = 60_000;

export { idsNoAcusados };

/**
 * Ventana de la poda del outbox (plan §2.1, "poda del outbox" — `purgarAcusadosAntesDe`,
 * `db/outbox.ts`, no tenía UN SOLO call site en producción): con N pasadas x 36 puntos de
 * control x todos los días sin purga, el outbox crece sin techo en un dispositivo que queda
 * encendido semanas.
 *
 * 🔴 MUCHO mayor que la duración de una sesión operativa (horas, no días) a propósito: la
 * semilla de histéresis del geofence (`clavesCumplimientoDesdePayloads`, `gps/location-task.ts`)
 * se reconstruye leyendo los `cumplimiento_punto_control` que siguen en el outbox de la
 * sesión activa. Si esta ventana fuera corta, podría purgar cumplimientos YA ACUSADOS de la
 * sesión EN CURSO (acusado no significa "sesión terminada", solo "el servidor ya lo
 * confirmó") y la semilla de una app que se reabre a mitad de turno quedaría incompleta —
 * el contador de pasadas retrocedería en vez de continuar. 7 días es, como mínimo, un orden
 * de magnitud mayor que cualquier turno real (el piloto Z12 son jornadas de horas).
 */
const VENTANA_PURGA_OUTBOX_MS = 7 * 24 * 60 * 60 * 1000;

/** Memoizado a nivel de módulo — una sola purga por proceso Y POR SESIÓN. La ventana es de
 * días, no de segundos: correr el `DELETE` de `purgarAcusadosAntesDe` en cada ciclo de sync
 * (cada 15 s mientras hay conexión, ver `use-sync-status.ts`) sería puro ruido sin beneficio —
 * lo que se purga hoy no vuelve a aparecer mañana. Nunca rechaza: es mantenimiento
 * best-effort, un fallo acá no debe tumbar el motor de sync.
 *
 * M5 (hallazgo de revisión, medio): keyeado por `sesionIdActiva`, no un único `Promise | null`.
 * Con la memo sin key, `??=` ataba la purga al `sesionIdActiva` del PRIMER llamador para toda
 * la vida del proceso — y `useSyncStatus` se monta desde dos pantallas distintas
 * (`operation-screen.tsx` y `perfil-screen.tsx`), con `sesionId` OPCIONAL en toda la cadena.
 * Un primer montaje sin ese parámetro corría el `DELETE` sin guarda de sesión activa,
 * borrando cumplimientos ya acusados de la sesión EN CURSO y haciendo retroceder el contador
 * de pasadas que `clavesCumplimientoDesdePayloads` reconstruye. Keyear por sesión conserva la
 * propiedad buscada (una sola purga por sesión, no una por ciclo de sync) sin arrastrar la
 * guarda equivocada de una sesión a otra.
 *
 * Nota sobre por qué keyear y no volver obligatorio el parámetro: `iniciarSyncAutomatico` lo
 * recibe desde `useSyncStatus(obtenerAccessToken, sesionId?)`, cuya firma pública es opcional y
 * vive en un archivo fuera del alcance de este fix. Hacerlo obligatorio acá solo empujaría el
 * `undefined` un nivel más arriba sin eliminarlo; la guarda de abajo lo elimina de verdad. */
const purgasOutboxProgramadas = new Map<string, Promise<void>>();

/** Clave del memo cuando NO hay sesión activa — ver la guarda en `programarPurgaOutbox`. */
const CLAVE_PURGA_SIN_SESION = '__sin-sesion__';

export function programarPurgaOutbox(sesionIdActiva?: string): Promise<void> {
  const clave = sesionIdActiva ?? CLAVE_PURGA_SIN_SESION;
  let purga = purgasOutboxProgramadas.get(clave);
  if (!purga) {
    purga = (async () => {
      if (!sesionIdActiva) {
        // M5: sin `sesionIdActiva` no hay forma de distinguir "no hay ninguna sesión abierta"
        // de "el llamador no lo pasó", y el `DELETE` sin guarda puede borrar cumplimientos ya
        // acusados de la sesión EN CURSO. La asimetría de costos es clara: postergar la purga
        // cuesta unas filas de más en SQLite hasta el próximo llamador que sí traiga la
        // sesión; correrla sin guarda cuesta el contador de pasadas de la jornada, que es
        // evidencia. Se posterga.
        Sentry.addBreadcrumb({
          category: 'sync',
          message: 'Purga del outbox omitida: no se recibió la sesión activa',
          level: 'info',
        });
        return;
      }
      try {
        const db = await abrirOutbox();
        const antesDe = new Date(Date.now() - VENTANA_PURGA_OUTBOX_MS);
        // M2 (hallazgo de revisión, medio, complementario): no purgar los cumplimientos de la
        // sesión ACTIVA — ver el comentario de `purgarAcusadosAntesDe` (`db/outbox.ts`).
        await purgarAcusadosAntesDe(db, antesDe, sesionIdActiva);
      } catch (error) {
        console.error('[QUIVO][sync] No se pudo podar el outbox', error);
        Sentry.captureException(error, {
          tags: { contexto: 'sync-outbox', paso: 'purgar-acusados' },
        });
      }
    })();
    purgasOutboxProgramadas.set(clave, purga);
  }
  return purga;
}

/** Un ciclo de sync: toma hasta `LOTE_MAXIMO` eventos pendientes, los manda, y marca según
 * el acuse del servidor — el cliente SOLO da por sincronizado lo que vino acusado (QUI-238).
 *
 * Punto 6 (code review 2026-09-25): además de `enviados` (ACEPTADOS por el servidor — el
 * único número que le importa al caller final, `iniciarSyncAutomatico`/UI), devuelve `leidos`
 * (filas que salieron de `obtenerLotePendiente`, ANTES de que el servidor acuse nada) — ver
 * `drenarLotesConLease` para el porqué: decidir si el LOTE salió lleno tiene que mirar cuánto
 * se LEYÓ del outbox, no cuánto se ACEPTÓ. */
export async function sincronizarPendientes(
  accessToken: string,
): Promise<{ enviados: number; leidos: number }> {
  try {
    return await sincronizarUnLote(accessToken);
  } finally {
    // Tras cada intento (foreground y headless pasan por acá) Sentry ve el atraso real del outbox.
    await reportarSaludDelOutbox();
  }
}

async function reportarSaludDelOutbox(): Promise<void> {
  try {
    reportarSaludOutbox(await obtenerSaludOutbox(await abrirOutbox()));
  } catch {
    // Observabilidad best-effort: nunca altera el resultado del sync.
  }
}

async function sincronizarUnLote(
  accessToken: string,
): Promise<{ enviados: number; leidos: number }> {
  const db = await abrirOutbox();
  const lote = await obtenerLotePendiente(db, LOTE_MAXIMO);
  if (lote.length === 0) {
    return { enviados: 0, leidos: 0 };
  }

  const eventIds = lote.map((evento) => evento.eventId);
  await marcarEnviados(db, eventIds);
  try {
    const eventos: EventoSync[] = lote.map((evento) => ({
      eventId: evento.eventId,
      deviceId: evento.deviceId,
      ts: evento.ts,
      tipo: evento.tipo,
      payload: evento.payload,
    }));
    const respuesta = await syncApi.enviarLote(eventos, accessToken);
    await marcarAcusados(db, respuesta.aceptados);
    await revertirAPendiente(db, idsNoAcusados(eventIds, respuesta.aceptados));
    return { enviados: respuesta.aceptados.length, leidos: lote.length };
  } catch (error) {
    // Fallo de red/servidor: todo el lote vuelve a pendiente para el próximo intento.
    await revertirAPendiente(db, eventIds);
    throw error instanceof ApiError
      ? error
      : new ApiError('network', 'Error de red al sincronizar');
  }
}

/** Mismo umbral que `UMBRAL_RECUPERACION_ENVIADOS_MS` de `drenaje-oportunista.ts` (hallazgo
 * 3) — duplicado en vez de importado porque ese archivo importa `sincronizarPendientes` DESDE
 * este, y este módulo no puede importar de vuelta desde `drenaje-oportunista.ts` sin crear un
 * ciclo. 90 s: mayor que el timeout del request (20 s, `sync-api.ts`) y que el TTL del lease
 * (60 s, `TTL_LEASE_DRENAJE_MS`). */
const UMBRAL_RECUPERACION_ENVIADOS_MS = 90_000;

function generarTokenLease(): string {
  // Mismo criterio que `generarTokenLease` de `drenaje-oportunista.ts` — no es un
  // identificador criptográfico, solo necesita distinguir "soy el dueño que adquirió este
  // lease" entre intentos concurrentes de este dispositivo.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hallazgo 2 (code review, MEDIO — `sincronizarPendientesConLease`): tras un lote LLENO
 * (`LOTE_MAXIMO` eventos), `sincronizarPendientesConLease` liberaba el lease con el
 * enfriamiento de éxito (`PISO_ENTRE_INTENTOS_DRENAJE_MS`, 3 s) antes de devolver el
 * control. El encadenado `setTimeout(intentarSync, 500)` de `iniciarSyncAutomatico` llegaba
 * DEMASIADO PRONTO — a los 500 ms el lease seguía "tomado" por ese cooldown — así que el
 * segundo intento recibía `null` (alguien más tiene el lease), `iniciarSyncAutomatico` lo
 * trataba como "0 enviados" (no es un fallo, ver su comentario) y la cadena se cortaba ahí.
 * Con horas sin cobertura (miles de eventos acumulados), el drenado completo tardaba minutos
 * en foreground y hasta ~20 min en headless (recién al próximo heartbeat), con `/en-vivo`
 * mostrando una posición vieja todo ese tiempo.
 *
 * Fix: el MISMO holder del lease encadena el siguiente lote sin soltarlo mientras el lote
 * recién enviado haya salido LLENO (señal de que probablemente queda más) — hasta
 * `TOPE_LOTES_POR_CICLO_DRENAJE` lotes por llamada, para no monopolizar el lease (ni la red)
 * indefinidamente si el outbox nunca converge (p. ej. reingresando eventos más rápido de lo
 * que se drenan).
 *
 * G2 (hallazgo de `/codex-debug verify-fix` sobre este mismo fix, ALTO): al llegar al TOPE con
 * pendientes todavía por drenar, liberar con el enfriamiento normal reproducía el MISMO defecto
 * que este fix existe para cerrar — el `setTimeout(500ms)` de `iniciarSyncAutomatico` llegaba
 * igual de temprano contra un lease que el tope acababa de dejar "tomado" por 3 s más. Ver
 * `drenarLotesConLease` (`motivo: 'tope-alcanzado'`) y sus callers: al llegar al tope CON
 * pendientes restantes, liberan SIN enfriamiento — el siguiente disparo, sea el
 * `setTimeout(500ms)` en foreground o el próximo evento de ubicación en headless, adquiere el
 * lease de inmediato en vez de esperar el piso pensado para intentos OPORTUNISTAS espaciados.
 * El piso de `PISO_ENTRE_INTENTOS_DRENAJE_MS` sigue aplicando igual que antes SOLO cuando el
 * ciclo termina porque ya no queda más (lote no lleno, `motivo: 'agotado'`) o falla — nunca
 * cuando corta por el tope con trabajo pendiente.
 */
const TOPE_LOTES_POR_CICLO_DRENAJE = 20;

/** Por qué terminó `drenarLotesConLease` — decide cómo (o si) el caller libera el lease. */
export type MotivoFinDrenajeLotes = 'agotado' | 'tope-alcanzado' | 'lease-perdido';

export interface ResultadoDrenajeLotes {
  enviados: number;
  /** Filas que salieron del outbox en el ciclo (aceptadas o no). */
  leidos: number;
  motivo: MotivoFinDrenajeLotes;
}

/**
 * G1 (hallazgo de `/codex-debug verify-fix`, ALTO — causa raíz de que el encadenado de la
 * Entrega 2/hallazgo 2 no cerrara el síntoma del piloto para el camino headless):
 * `intentarDrenarOportunista` (`drenaje-oportunista.ts`) seguía llamando UNA sola vez a
 * `sincronizarPendientes`, sin pasar por ningún encadenado — un atraso grande en background
 * (la app cerrada, el único motor de sync es el evento de ubicación/heartbeat) drenaba un lote
 * por evento igual que antes de ese fix, aunque `sincronizarPendientesConLease` (foreground) sí
 * encadenara. Fix real: bucle COMPARTIDO — foreground y headless llaman a ESTA MISMA función
 * bajo un lease YA ADQUIRIDO por el caller (con su propio `token`), así que el comportamiento
 * de drenado (cuántos lotes, cuándo cortar, cómo renovar el lease) vive en un solo lugar en vez
 * de divergir entre los dos call sites.
 *
 * R1 (hallazgo de la misma verificación, ALTO): renueva el lease ANTES de cada lote
 * (`renovarLease`, `db/outbox.ts`) — no solo al liberar al final, como antes. Si la renovación
 * no afecta ninguna fila (ya no somos el dueño — el TTL venció mientras seguíamos trabajando,
 * o un salto de reloj hizo que otro contexto la reclamara como huérfana), el bucle CORTA DE
 * INMEDIATO con `motivo: 'lease-perdido'`, sin drenar más lotes y SIN que el caller libere el
 * lease (ya no es suyo — liberar pisaría al nuevo dueño). El progreso de los lotes YA enviados
 * en este ciclo (`enviados`) se devuelve igual: es trabajo real, no se pierde ni se reporta como
 * fallo.
 */
export async function drenarLotesConLease(
  db: SQLite.SQLiteDatabase,
  accessToken: string,
  token: string,
): Promise<ResultadoDrenajeLotes> {
  let totalEnviados = 0;
  let totalLeidos = 0;
  for (let lotesDrenados = 0; lotesDrenados < TOPE_LOTES_POR_CICLO_DRENAJE; lotesDrenados++) {
    const renovado = await renovarLease(db, ID_LEASE_DRENAJE, token, Date.now(), TTL_LEASE_DRENAJE_MS);
    if (!renovado) {
      return { enviados: totalEnviados, leidos: totalLeidos, motivo: 'lease-perdido' };
    }
    const resultado = await sincronizarPendientes(accessToken);
    totalEnviados += resultado.enviados;
    totalLeidos += resultado.leidos;
    // Punto 6 (code review 2026-09-25): decidir "agotado" con `resultado.enviados` (ACEPTADOS
    // por el servidor) en vez de `resultado.leidos` (filas que de verdad salieron del outbox)
    // cortaba el ciclo después de UN SOLO lote cuando algún evento del lote es rechazado SIEMPRE
    // por el servidor (p. ej. un payload con un id de punto de control que ya no existe) y cae
    // al PRINCIPIO de cada lote nuevo (`obtenerLotePendiente` es FIFO) — ese evento nunca se
    // acusa, así que `enviados` queda por debajo de `LOTE_MAXIMO` aunque el LOTE haya salido
    // lleno y quede mucho más atraso real detrás. `leidos` es la señal correcta de "¿este lote
    // vino lleno, probablemente hay más?" — independiente de cuántos acuse el servidor.
    if (resultado.leidos < LOTE_MAXIMO) {
      return { enviados: totalEnviados, leidos: totalLeidos, motivo: 'agotado' };
    }
  }
  return { enviados: totalEnviados, leidos: totalLeidos, motivo: 'tope-alcanzado' };
}

/**
 * Hallazgo 6 (code review, BAJO — `docs/plan-correccion-post-piloto-2026-09-09.md`): el lease
 * de `drenaje-oportunista.ts` (Entrega 2) no cubre a `iniciarSyncAutomatico` (más abajo,
 * disparado por `useSyncStatus`, montado en `operation-screen.tsx` y `perfil-screen.tsx`) ni
 * al latido de 15 s de `use-sync-status.ts`, que llaman a `sincronizarPendientes` SIN pasar
 * por ningún lease. En foreground, el drenado de `onLocation`/`onHeartbeat` (con lease) y
 * estos dos caminos (sin lease) pueden mandar DOS VECES el mismo lote de hasta 500 eventos —
 * no hay pérdida (la ingesta del servidor es idempotente por `eventId`), pero la exclusión
 * mutua que el docblock del lease promete no se cumple, y son dos POSTs de red en vez de uno.
 *
 * Fix: variante de `sincronizarPendientes` que respeta el MISMO lease SQLite que usa
 * `drenaje-oportunista.ts` (`ID_LEASE_DRENAJE`, `db/outbox.ts`) — cualquier caller que pase
 * por acá compite por el lease en igualdad de condiciones con el drenado disparado por
 * ubicación. No usa `startBackgroundTask` ni el backoff exponencial en memoria de
 * `drenaje-oportunista.ts` (esos dos son necesidades del camino headless/background; un hook
 * de pantalla en foreground no las tiene — si el POST falla, `sincronizarPendientes` ya
 * revierte su propio lote, y el caller (`iniciarSyncAutomatico`/`use-sync-status.ts`) ya tiene
 * su propio backoff/reintento). Si no consigue el lease (alguien más está drenando en este
 * instante), devuelve `null` y desiste en silencio — mismo comportamiento que
 * `intentarDrenarOportunista` en ese caso, nunca un error.
 *
 * También corre `recuperarEnviadosHuerfanos` (hallazgo 3) al adquirir el lease, igual que
 * `drenaje-oportunista.ts` — cualquier camino que gane el lease es un momento seguro para esa
 * recuperación, sin importar cuál de los tres disparadores fue.
 */
export async function sincronizarPendientesConLease(
  accessToken: string,
): Promise<{ enviados: number; leidos: number } | null> {
  const db = await abrirOutbox();
  const ahoraMs = Date.now();
  const token = generarTokenLease();
  const obtuvoLease = await adquirirLease(
    db,
    ID_LEASE_DRENAJE,
    token,
    ahoraMs,
    TTL_LEASE_DRENAJE_MS,
  );
  if (!obtuvoLease) {
    return null;
  }

  try {
    await recuperarEnviadosHuerfanos(db, new Date(ahoraMs - UMBRAL_RECUPERACION_ENVIADOS_MS));
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'sync-outbox', paso: 'recuperar-enviados-huerfanos' },
    });
  }

  try {
    // Hallazgo 2 + G1/G2 (verificación posterior): `drenarLotesConLease` es el bucle
    // COMPARTIDO con el camino headless (`intentarDrenarOportunista`) — ver su docblock para
    // el detalle de renovación de lease y de cómo se decide `motivo`.
    const { enviados, leidos, motivo } = await drenarLotesConLease(db, accessToken, token);
    if (motivo === 'lease-perdido') {
      // R1: ya no somos el dueño — no liberar acá pisaría el lease legítimo del contexto que
      // lo tomó. El progreso de este ciclo se reporta igual, no es un fallo.
      return { enviados, leidos };
    }
    // G2: sin enfriamiento si cortamos por el TOPE con pendientes restantes (`tope-alcanzado`)
    // — el próximo `setTimeout(500ms)` de `iniciarSyncAutomatico` debe poder adquirir el lease
    // de inmediato. Con `motivo: 'agotado'` (ya no queda más), el piso normal entre intentos
    // oportunistas sigue aplicando igual que antes.
    const cooldownMs = motivo === 'tope-alcanzado' ? 0 : PISO_ENTRE_INTENTOS_DRENAJE_MS;
    await liberarLeaseConCooldown(db, ID_LEASE_DRENAJE, token, Date.now(), cooldownMs);
    return { enviados, leidos };
  } catch (error) {
    // El caller (`intentarSync`/el intervalo de `use-sync-status.ts`) sigue siendo responsable
    // de reportar este fallo (backoff propio, `errorSync`) — acá solo se libera el lease para
    // que el próximo intento (de cualquier camino) pueda tomarlo.
    await liberarLeaseConCooldown(
      db,
      ID_LEASE_DRENAJE,
      token,
      Date.now(),
      PISO_ENTRE_INTENTOS_DRENAJE_MS,
    );
    throw error;
  }
}

export type ResultadoSync = { enviados: number } | { error: string };

/**
 * Dispara `sincronizarPendientes` al detectar conexión y reintenta con backoff exponencial
 * ante fallos (RNF-36) — devuelve una función para des-suscribirse (llamarla al desmontar
 * la pantalla que lo use, QUI-243).
 */
export function iniciarSyncAutomatico(
  obtenerAccessToken: () => string | null,
  onResultado?: (resultado: ResultadoSync) => void,
  onSyncStart?: () => void,
  sesionIdActiva?: string,
): () => void {
  // Punto sensato del ciclo de sync para la poda (plan §2.1): se dispara una vez por arranque
  // del motor de sync, en paralelo, sin bloquear ni el `return` síncrono de esta función ni el
  // primer intento de sync — `programarPurgaOutbox` está memoizada POR SESIÓN (M5), así que
  // remontar la pantalla de operación no reintenta la purga, pero un cambio de sesión sí
  // vuelve a evaluarla con la guarda correcta.
  void programarPurgaOutbox(sesionIdActiva);

  let backoffMs = BACKOFF_INICIAL_MS;
  let detenido = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const intentarSync = async (): Promise<void> => {
    if (detenido) return;
    const accessToken = obtenerAccessToken();
    if (!accessToken) return;

    try {
      onSyncStart?.();
      // Hallazgo 6 (code review): `sincronizarPendientesConLease`, NO `sincronizarPendientes`
      // directo — ver su docblock. `resultado === null` significa "alguien más (el drenado
      // por ubicación, u otro disparo de este mismo motor) tiene el lease ahora mismo".
      const resultado = await sincronizarPendientesConLease(accessToken);
      if (resultado === null) {
        // Punto 5 (code review 2026-09-25): lease no disponible NO es un éxito — antes esto
        // reseteaba `backoffMs` a `BACKOFF_INICIAL_MS` y, como `resultado && ...` daba `false`,
        // NO reprogramaba ningún reintento. Sin otro disparador externo (NetInfo, un evento de
        // ubicación) que volviera a llamar a `intentarSync`, la cadena de reintentos por
        // backoff moría en silencio ahí mismo. Ahora: el backoff vigente NO se toca, y se
        // reprograma respetando COMO PISO el cooldown del lease (`PISO_ENTRE_INTENTOS_DRENAJE_MS`)
        // — reintentar antes solo repetiría el mismo `null`, el lease de drenado no se libera
        // más rápido que eso.
        onResultado?.({ enviados: 0 });
        timeoutId = setTimeout(
          () => void intentarSync(),
          Math.max(backoffMs, PISO_ENTRE_INTENTOS_DRENAJE_MS),
        );
        return;
      }
      backoffMs = BACKOFF_INICIAL_MS;
      onResultado?.(resultado);
      if (resultado.enviados > 0) {
        // Puede haber más pendientes que el límite de un lote — seguir de inmediato.
        timeoutId = setTimeout(() => void intentarSync(), 500);
      }
    } catch (error) {
      onResultado?.({ error: error instanceof Error ? error.message : 'Error de sincronización' });
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAXIMO_MS);
      timeoutId = setTimeout(() => void intentarSync(), backoffMs);
    }
  };

  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void intentarSync();
    }
  });

  return () => {
    detenido = true;
    if (timeoutId) clearTimeout(timeoutId);
    unsubscribe();
  };
}
