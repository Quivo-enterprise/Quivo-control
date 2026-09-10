import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import type { EventoSync } from '@quivo/shared';
import {
  abrirOutbox,
  adquirirLease,
  liberarLeaseConCooldown,
  marcarAcusados,
  marcarEnviados,
  obtenerLotePendiente,
  purgarAcusadosAntesDe,
  recuperarEnviadosHuerfanos,
  revertirAPendiente,
  ID_LEASE_DRENAJE,
  PISO_ENTRE_INTENTOS_DRENAJE_MS,
  TTL_LEASE_DRENAJE_MS,
} from '../../db/outbox';
import { ApiError } from '../../shared/api/http-client';
import { syncApi } from '../../shared/api/sync-api';
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
 * el acuse del servidor — el cliente SOLO da por sincronizado lo que vino acusado (QUI-238). */
export async function sincronizarPendientes(accessToken: string): Promise<{ enviados: number }> {
  const db = await abrirOutbox();
  const lote = await obtenerLotePendiente(db, LOTE_MAXIMO);
  if (lote.length === 0) {
    return { enviados: 0 };
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
    return { enviados: respuesta.aceptados.length };
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
): Promise<{ enviados: number } | null> {
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
    const resultado = await sincronizarPendientes(accessToken);
    await liberarLeaseConCooldown(
      db,
      ID_LEASE_DRENAJE,
      token,
      Date.now(),
      PISO_ENTRE_INTENTOS_DRENAJE_MS,
    );
    return resultado;
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
      // por ubicación, u otro disparo de este mismo motor) tiene el lease ahora mismo": no es
      // un fallo, así que se trata como un éxito vacío (no toca `errorSync`/el contador de
      // fallos consecutivos) y no se agenda un reintento inmediato — el próximo disparo normal
      // (reconexión de NetInfo, o el intervalo de `use-sync-status.ts`) ya va a volver a
      // intentar.
      const resultado = await sincronizarPendientesConLease(accessToken);
      backoffMs = BACKOFF_INICIAL_MS;
      onResultado?.(resultado ?? { enviados: 0 });
      if (resultado && resultado.enviados > 0) {
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
