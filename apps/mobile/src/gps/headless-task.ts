import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import BackgroundGeolocation, {
  type HeadlessEvent,
  type Location,
} from 'react-native-background-geolocation';
import type { DeteccionPuntoControl, EstadoPuntoControl } from './geofence';
import {
  clavesCumplimientoDesdePayloads,
  construirEventosDeUbicacion,
  type ContextoUbicacion,
} from './location-task';
import { abrirOutbox, encolarEvento, obtenerEventosPorTipo } from '../db/outbox';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal } from '../db/paquete-dia';
import { intentarDrenarOportunista } from '../features/operacion/drenaje-oportunista';
// Hallazgo 4 (code review de la Entrega 2/3): `refrescar` en vez de llamar directo a
// `intentarRefrescarConCircuito` — ver el docblock de `obtenerAccessTokenHeadless` más abajo.
import { refrescar } from '../features/auth/use-auth-movil';
import { cargarSesionMovil, obtenerDeviceIdMovil } from '../shared/security/sesion-movil-store';

/**
 * Margen de gracia antes de apagar el plugin nativo tras vencer el paquete del día (hallazgo
 * de revisión A8a). Descartar el punto GPS sigue siendo INMEDIATO en cuanto `venceAt` pasa —
 * eso no cambia. Lo que se demora es el `stop()` de `detenerTrackingNativo`, que además
 * desactiva `startOnBoot`: una decisión IRREVERSIBLE sin intervención humana, tomada acá con
 * `Date.now()` en el camino de arranque tras reboot — justo donde el reloj es menos confiable
 * (RTC drift, todavía sin corrección NTP). Un reboot a mitad de turno con el reloj adelantado
 * no debe apagar el tracking del resto de la jornada sin que el chofer tenga forma de
 * enterarse. Valor PROVISIONAL (2h) — pendiente de confirmación del CTO.
 */
const GRACIA_STOP_TRAS_VENCIMIENTO_MS = 2 * 60 * 60 * 1000;

/**
 * C2 (hallazgo de revisión CRÍTICO): cola FIFO a nivel de módulo que serializa TODAS las
 * llamadas a `registrarPuntoGps` (ambos callers, ver su comentario) para que dos ticks nunca
 * se procesen solapados. La mutación diferida de `estadosPuntosControl` (plan §2.4, ver el
 * comentario de la función) es PURA a propósito — pero eso abrió una ventana lectura→escritura
 * que el código viejo (que mutaba el Set sincrónicamente antes del primer `await`) no tenía:
 * en una ráfaga de salida de Doze, dos fixes pueden entrar a `registrarPuntoGpsInterno` antes
 * de que el primero termine sus `await encolarEvento` — los dos leen el MISMO estado
 * (`{dentro:false, pasadas:0}`), los dos calculan `pasada: 1`, los dos encolan la misma pasada
 * dos veces. Encadenar cada llamada en esta cola fuerza que los ticks se procesen en orden
 * estricto, uno a la vez, así que el segundo SIEMPRE ve las transiciones que aplicó el primero
 * antes de calcular las suyas.
 *
 * El `.catch(() => undefined)` de cada eslabón asegura que un `registrarPuntoGpsInterno` que
 * rechaza no deje la cola rota para siempre — una promesa rechazada instalada tal cual en
 * `colaRegistroGps` tumbaría TODOS los ticks futuros encadenados con `.then()`. El error real
 * se sigue propagando al caller de ESE tick puntual (`resultado`, sin el `.catch`), solo que
 * la cola avanza igual para el próximo.
 */
let colaRegistroGps: Promise<unknown> = Promise.resolve();

/**
 * B7 (hallazgo de revisión, bajo): techo de tiempo de CADA operación encolada, contado desde
 * que le toca su turno en `colaRegistroGps` (no desde que se encoló — si no, una cola larga
 * pero sana se auto-cancelaría en cascada).
 *
 * Sin este techo, un solo `encolarEvento` colgado —contención de lock de SQLite entre el
 * contexto headless y el hook de foreground, que es EXACTAMENTE el escenario por el que existe
 * la cola— bloquea todos los puntos GPS siguientes en AMBOS contextos, para siempre y sin
 * dejar rastro: una escritura trabada se convierte en la pérdida total de la evidencia del
 * resto del turno.
 *
 * 30 s es holgado para una escritura local (el intervalo de fixes es de 10 s, ver
 * `locationUpdateInterval` en `background-geolocation.config.ts`): una operación que lo supera
 * no está lenta, está trabada. No se aborta la operación subyacente —no hay forma de cancelar
 * una promesa de `expo-sqlite`, y si termina más tarde su escritura igual vale— lo que se
 * libera es la COLA, para que los fixes siguientes se procesen.
 */
const TIMEOUT_REGISTRO_GPS_MS = 30_000;

/**
 * B7: profundidad actual de la cola (operaciones encoladas todavía sin resolver). Se reporta
 * junto al timeout — una cola de 1 dice "una escritura puntual se trabó"; una de 40 dice "hace
 * 7 minutos que no entra ningún punto". A propósito NO hay un tope duro que descarte fixes: el
 * punto GPS es la evidencia legal (RF-67..73) y tirarlo para acotar memoria sería cambiar una
 * falla visible por una pérdida silenciosa. El techo real lo pone el timeout de arriba, que
 * garantiza que la cola avanza a lo sumo cada `TIMEOUT_REGISTRO_GPS_MS`.
 */
let profundidadColaRegistroGps = 0;

/** Umbral de profundidad a partir del cual la cola deja un breadcrumb: con fixes cada 10 s y un
 * timeout de 30 s, más de 5 operaciones en vuelo ya significa que algo se está acumulando. */
const PROFUNDIDAD_COLA_SOSPECHOSA = 5;

/** Error del techo de tiempo de B7 — tipo propio para poder distinguirlo en Sentry de un fallo
 * real de SQLite (el `message` de un timeout no dice nada del estado de la base). */
class TimeoutRegistroGpsError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`registrarPuntoGps no terminó en ${timeoutMs} ms`);
    this.name = 'TimeoutRegistroGpsError';
  }
}

/**
 * B7: corre `operacion` con un techo de tiempo. Si vence, la promesa devuelta rechaza (así la
 * cola avanza y el caller se entera), pero la operación original sigue viva — su resultado se
 * ignora, y si termina rechazando se le engancha un `.catch` vacío para no dejar un unhandled
 * rejection colgando en RN.
 */
function conTimeout<T>(operacion: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => {
      reject(new TimeoutRegistroGpsError(timeoutMs));
    }, timeoutMs);
    operacion.then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (error: unknown) => {
        clearTimeout(temporizador);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Contenedor del Map de estados de histéresis. B6 (hallazgo de revisión, bajo): la cola FIFO
 * difiere la ejecución de `registrarPuntoGpsInterno`, así que recibir el Map POR VALOR dejaba
 * al caller de foreground (`use-gps-operativo.ts`) atado a la referencia que tenía al momento
 * del fix: `sembrarCumplimientos` REEMPLAZA `puntosControlDetectados.current` por un Map nuevo,
 * y un fix encolado antes de esa re-siembra aplicaba sus transiciones al Map huérfano — la
 * pasada desaparecía del estado y el punto se re-emitía como `pasada: 1` en el fix siguiente.
 * Con el contenedor, `.current` se lee recién DENTRO de `registrarPuntoGpsInterno`, cuando le
 * toca su turno en la cola. La forma `{ current }` es la de un `useRef` de React a propósito:
 * el hook pasa su ref tal cual, sin envoltorios. */
export interface ContenedorEstadosPuntosControl {
  current: Map<string, EstadoPuntoControl>;
}

/**
 * Punto único de escritura al outbox para un evento de ubicación (QUI-216): usa la lógica
 * pura de `location-task.ts` y persiste lo que devuelve con `encolarEvento` (RF-67..73 — el
 * evento nace en SQLite antes de cualquier intento de red). Lo llaman:
 * - `useGpsOperativo` (`use-gps-operativo.ts`), con el contexto que ya tiene en React y su
 *   propio `useRef<Map>` de estados de histéresis (vive mientras dure el `iniciar()` en curso).
 * - `tareaHeadlessUbicacion`, de abajo, con el contexto leído de disco y el Map de estados a
 *   nivel de módulo de este archivo.
 *
 * Serializado por `colaRegistroGps` (C2, ver su comentario) — el cuerpo real vive en
 * `registrarPuntoGpsInterno`, que esta función encadena en la cola en vez de ejecutar directo.
 */
export function registrarPuntoGps(
  db: SQLite.SQLiteDatabase,
  location: Location,
  contexto: ContextoUbicacion,
  estadosPuntosControl: ContenedorEstadosPuntosControl,
): Promise<{ deteccion: DeteccionPuntoControl | null }> {
  profundidadColaRegistroGps += 1;
  if (profundidadColaRegistroGps >= PROFUNDIDAD_COLA_SOSPECHOSA) {
    Sentry.addBreadcrumb({
      category: 'gps',
      message: 'Cola de registro de puntos GPS acumulándose',
      level: 'warning',
      data: { profundidad: profundidadColaRegistroGps, timeoutMs: TIMEOUT_REGISTRO_GPS_MS },
    });
  }

  // B7: el techo de tiempo arranca cuando la operación EMPIEZA (dentro del `then`), no cuando
  // se encola — ver el comentario de `TIMEOUT_REGISTRO_GPS_MS`.
  const resultado = colaRegistroGps
    .then(() =>
      conTimeout(
        registrarPuntoGpsInterno(db, location, contexto, estadosPuntosControl),
        TIMEOUT_REGISTRO_GPS_MS,
      ),
    )
    .catch((error: unknown) => {
      if (error instanceof TimeoutRegistroGpsError) {
        console.error('[QUIVO][gps] registrarPuntoGps venció su techo de tiempo', error);
        // Sin esto, una escritura trabada arrastra al resto del turno en silencio — el peor
        // caso del ticket, invisible por definición (nadie lee la consola del teléfono de un
        // conductor en ruta).
        Sentry.captureException(error, {
          tags: { contexto: 'gps-cola', paso: 'timeout-registro-punto' },
          extra: {
            timeoutMs: TIMEOUT_REGISTRO_GPS_MS,
            profundidadCola: profundidadColaRegistroGps,
            sesionId: contexto.sesionId,
          },
        });
      }
      throw error;
    })
    .finally(() => {
      profundidadColaRegistroGps -= 1;
    });

  // Encadenar SIEMPRE (éxito o fallo) para que un rechazo no rompa la cola — ver el comentario
  // de `colaRegistroGps`.
  colaRegistroGps = resultado.catch(() => undefined);
  return resultado;
}

/**
 * Cuerpo real de `registrarPuntoGps` — separado para que la serialización de arriba pueda
 * encadenarlo sin ejecutarlo antes de su turno en la cola.
 *
 * Plan §2.4 (hallazgo de revisión: "el Set se muta antes de confirmar la escritura"):
 * `construirEventosDeUbicacion` es PURA y devuelve `transicionesEstado` sin tocar
 * `estadosPuntosControl`. M4 (hallazgo de revisión, medio): la transición de cada
 * `cumplimiento_punto_control` se aplica INMEDIATAMENTE después de SU PROPIO `encolarEvento`
 * — no al final del tick con un segundo `for` — para que un `encolarEvento` que falla A MITAD
 * de tick (dos puntos de control con radios solapados, por ejemplo) no deje sin aplicar la
 * transición de un cumplimiento que SÍ quedó persistido antes del fallo. Con la versión vieja
 * (transiciones aplicadas todo-o-nada tras el loop completo), ese cumplimiento quedaba
 * persistido en el outbox pero con el Map todavía en `dentro:false, pasadas:0` — el próximo
 * fix lo re-emitía como `pasada: 1`, duplicando evidencia ya escrita.
 *
 * Las transiciones de RE-ARMADO (sin `cumplimiento_punto_control` asociado — un punto que
 * simplemente se aleja no genera ningún evento) se aplican junto con el `gps_point`, que es
 * SIEMPRE el primer evento del tick: si el `gps_point` falla, el `await` de abajo aborta el
 * tick entero antes de llegar a aplicar NINGUNA transición (ni de re-armado ni de
 * cumplimiento) — mismo comportamiento que antes para ese caso.
 */
async function registrarPuntoGpsInterno(
  db: SQLite.SQLiteDatabase,
  location: Location,
  contexto: ContextoUbicacion,
  estadosPuntosControl: ContenedorEstadosPuntosControl,
): Promise<{ deteccion: DeteccionPuntoControl | null }> {
  // B6: `.current` se lee ACÁ, ya con el turno de la cola concedido — nunca en el caller, que
  // pudo haber quedado con una referencia previa a una re-siembra (ver
  // `ContenedorEstadosPuntosControl`).
  const estados = estadosPuntosControl.current;
  const { eventos, deteccion, transicionesEstado, avisosPrecision } = construirEventosDeUbicacion(
    location,
    contexto,
    estados,
  );
  // M3: la precisión degradada del fix queda registrada como breadcrumb — es la telemetría que
  // el gate de accuracy anterior NO dejaba (descartaba la pasada en silencio).
  for (const aviso of avisosPrecision) {
    Sentry.addBreadcrumb({
      category: 'gps',
      message: `Precisión del fix condicionó la histéresis (${aviso.motivo})`,
      level: 'info',
      data: { ...aviso, sesionId: contexto.sesionId },
    });
  }
  // Claves cuya transición ya está atada a un evento propio (`evento.clave`, los
  // `cumplimiento_punto_control` emitidos este tick) — el resto de `transicionesEstado` son
  // re-armados sin evento asociado, aplicados junto al `gps_point`.
  const clavesConEventoPropio = new Set(
    eventos.map((evento) => evento.clave).filter((clave): clave is string => clave !== undefined),
  );

  for (const evento of eventos) {
    await encolarEvento(db, {
      deviceId: contexto.deviceId,
      tipo: evento.tipo,
      payload: evento.payload,
    });
    if (evento.clave !== undefined) {
      // `cumplimiento_punto_control`: transición aplicada YA, recién confirmada su propia
      // escritura — ver el comentario de la función para el porqué (M4).
      const estado = transicionesEstado.get(evento.clave);
      if (estado) estados.set(evento.clave, estado);
    } else {
      // `gps_point` (siempre el primer evento, sin `clave` propia): ancla para aplicar las
      // transiciones de RE-ARMADO, que no tienen ningún evento propio al que atarse.
      for (const [clave, estado] of transicionesEstado) {
        if (!clavesConEventoPropio.has(clave)) estados.set(clave, estado);
      }
    }
  }
  return { deteccion };
}

/**
 * Reconstruye el `ContextoUbicacion` leyendo SOLO almacenamiento persistente del
 * dispositivo — decisión deliberada (QUI-216): el headless task corre fuera de React, sin
 * closures ni hooks a los que engancharse, así que no hay otra fuente posible. No hizo falta
 * inventar un almacén nuevo porque los tres datos que necesita ya se persisten hoy para que
 * la app funcione offline:
 * - `deviceId`: `obtenerDeviceIdMovil()` — SecureStore, `sesion-movil-store.ts` (se genera
 *   una sola vez por instalación).
 * - `sesionId`: `cargarSesionMovil().contexto.sesionId` — SecureStore, el mismo objeto de
 *   sesión que guarda el login (`guardarSesionMovil`, `use-auth-movil.ts`).
 * - `puntosControl`: `obtenerPaqueteDiaLocal()` — SQLite, el paquete del día que ya se
 *   descarga y persiste para operar sin red (RF-67/73, `db/paquete-dia.ts`).
 *
 * Devuelve `null` cuando NO hay turno vigente al que atribuir el punto — en ambos casos, el
 * punto se descarta. Dos casos, con manejo DISTINTO del `stop()` del tracking nativo (antes
 * vivía, igual para los dos, en el caller — separado acá porque dejó de ser igual, hallazgo
 * de revisión A8a):
 * - **Sin sesión guardada.** El SDK nativo de Transistorsoft no depende de React ni de la
 *   sesión de la app: si el chofer cerró sesión, no hay `sesionId`, el punto sería evidencia
 *   huérfana y no hay ambigüedad de reloj que justifique esperar — se corta de inmediato.
 * - **Sesión vencida.** `startOnBoot: true` + `stopOnTerminate: false` hacen que el tracking
 *   sobreviva a todo salvo un `stop()` explícito, y `detener()` es el único que lo llama: un
 *   chofer que termina el turno matando la app dejaba el plugin `enabled` escribiendo
 *   `gps_point` contra un `sesionId` vencido toda la noche, y reanudándose tras cada reboot.
 *   El vencimiento se evalúa contra `sesion.contexto.asignacion.venceAt` — la SESIÓN activa,
 *   NO el paquete del día guardado en SQLite (hallazgo 3, code review de este cambio):
 *   `obtenerPaqueteDiaLocal()` puede devolver `null` cuando la fila local es de otra
 *   asignación (hallazgo 1, arriba), y con el paquete como fuente esa rama de vencimiento se
 *   saltaba entera — el tracker seguía corriendo toda la noche exactamente en el escenario
 *   que este chequeo existe para cubrir. `venceAt` de la sesión, en cambio, siempre está
 *   disponible mientras haya sesión y es, por definición, el fin real del turno operativo al
 *   que se le atribuiría el punto. Acá el `stop()` espera el margen de gracia
 *   (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`) antes de dispararse, porque este chequeo corre en el
 *   camino de arranque tras reboot, donde `Date.now()` es menos confiable.
 *
 * Que NO corta: un paquete ausente o ilegible con sesión vigente y no vencida. Ahí se sigue
 * registrando `gps_point` sin puntos de control (comportamiento anterior) — un fallo de
 * descarga del paquete no debe costar la evidencia GPS de la jornada, que es lo que sustenta
 * la sanción.
 */
export async function obtenerContextoUbicacionPersistido(): Promise<ContextoUbicacion | null> {
  // El chequeo de sesión va PRIMERO: `obtenerDeviceIdMovil()` acuña y persiste un device id
  // nuevo si SecureStore no tiene uno, y un tick headless sin autenticar no debe crear una
  // identidad de dispositivo que el backend nunca vio.
  const sesion = await cargarSesionMovil();
  if (!sesion) {
    // Sin este `stop()`, `stopOnTerminate: false` + `startOnBoot: true` dejan al plugin
    // `enabled` para siempre — batería quemada toda la noche y un reporte que muestra el
    // micro "manejando" durante días, sin `fin_recorrido`. `stop()` también desactiva el
    // arranque en boot: el SDK solo reanuda si quedó `enabled`.
    await detenerTrackingNativo();
    return null;
  }

  const dbPaquete = await abrirPaqueteDiaDb();
  // Hallazgo 1 (CRÍTICO, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): comparar contra la
  // asignación de ESTA sesión (ya validada arriba), no aceptar la fila a ciegas — la fila de
  // `paquete_dia` sobrevive al logout y puede ser de un turno anterior en el mismo teléfono.
  const paqueteLocal = await obtenerPaqueteDiaLocal(dbPaquete, sesion.contexto.asignacion.id);

  // Hallazgo 3 (MEDIO, code review de este mismo cambio): el vencimiento se evalúa contra
  // `sesion.contexto.asignacion.venceAt` — la SESIÓN activa, ya autenticada arriba — NUNCA
  // contra `paqueteLocal`. Antes se leía `paqueteLocal.paquete.asignacion.venceAt`, pero el
  // hallazgo 1 de arriba hace que `obtenerPaqueteDiaLocal` devuelva `null` en cuanto la fila
  // de SQLite es de OTRA asignación (identidad no matchea) — y con `paqueteLocal` en `null`,
  // esta rama de vencimiento se saltaba ENTERA: ni el chequeo inmediato de descarte del
  // punto ni, tras la gracia, el `stop()`. El resultado era el mismo bug que A8a existía
  // para cerrar: el tracker seguía escribiendo `gps_point` toda la noche con `startOnBoot`
  // armado, batería quemada y recorrido fantasma. `sesion.contexto.asignacion.venceAt` es la
  // fuente correcta porque es lo único que siempre está disponible cuando hay sesión (viene
  // del login/refresh, no de una fila de caché que puede faltar o pertenecer a otro turno) y
  // es, exactamente, el vencimiento de la sesión a la que se le atribuiría el punto GPS si
  // se llegara a registrar.
  const venceAtMs = Date.parse(sesion.contexto.asignacion.venceAt);
  const vencido = !Number.isNaN(venceAtMs) && Date.now() >= venceAtMs;
  if (vencido) {
    // El punto se descarta ya (no hay turno vigente al que atribuirlo) — el `stop()`
    // irreversible se demora hasta que pase el margen de gracia, ver
    // `GRACIA_STOP_TRAS_VENCIMIENTO_MS`.
    const graciaVencida = Date.now() - venceAtMs >= GRACIA_STOP_TRAS_VENCIMIENTO_MS;
    if (graciaVencida) {
      await detenerTrackingNativo();
    }
    return null;
  }

  const deviceId = await obtenerDeviceIdMovil();
  return {
    deviceId,
    sesionId: sesion.contexto.sesionId,
    puntosControl: paqueteLocal?.paquete.puntosControl ?? [],
  };
}

/**
 * Estados de histéresis de cada punto de control ya visto durante el tracking headless — a
 * nivel de módulo (no de React, no existe árbol de componentes acá) para no reencolar la
 * misma pasada en cada tick ni perder el contador de pasadas entre ticks. Las claves son
 * `${sesionId}:${puntoControlId}` (`claveCumplimiento`, `geofence.ts`), NO el
 * `puntoControlId` solo: este Map vive todo el contexto JS headless y nadie lo resetea al
 * cambiar de sesión (a diferencia del `useRef` del hook, que `iniciar()` reemplaza), así que
 * indexarlo solo por punto de control haría que la ruta B — o el turno del día siguiente
 * sobre la misma ruta recurrente — arrastrara el estado de la sesión anterior.
 *
 * El caso inverso (contexto JS reciclado a mitad de turno → Map vacío → contador de pasadas
 * reiniciado en 1 y la pasada en curso reemitida con un `eventId` nuevo) lo cubre
 * `asegurarSemillaCumplimientos`, sembrando el Map desde el outbox en el primer tick.
 */
const puntosControlDetectadosHeadless: ContenedorEstadosPuntosControl = { current: new Map() };

/** Memo de la siembra: una sola lectura del outbox por (contexto JS headless, `sesionId`), y
 * ticks concurrentes de la MISMA sesión esperan la misma promesa en vez de sembrar dos veces.
 * Nunca rechaza — la semilla es best-effort y un fallo no debe costar el punto GPS de este
 * tick.
 *
 * Keyeada por `sesionId` (hallazgo de revisión, alto — antes era un único `Promise<void> |
 * null` a nivel de módulo, sin key): `puntosControlDetectadosHeadless` de arriba ya documenta
 * que un mismo contexto JS headless puede ver MÁS de un `sesionId` en su vida (el turno del
 * día siguiente sobre la misma ruta recurrente, sin que Android mate el proceso entre
 * turnos) — nada garantiza "un solo sesionId por contexto". Con la memo sin key, la siembra
 * de la sesión 1 dejaba `semillaCumplimientos` resuelta para siempre: si Android reciclaba el
 * contexto JS a mitad de la sesión 2 (el escenario que esta siembra existe para cubrir, ver
 * el comentario de `puntosControlDetectadosHeadless`), `asegurarSemillaCumplimientos` para
 * `sesionId` 2 nunca volvía a leer el outbox y esa sesión perdía sus cumplimientos ya
 * persistidos. Un `Map` por `sesionId` preserva la propiedad que buscaba el código original
 * — sembrar una sola vez por sesión, no en cada tick — sin arrastrar el estado entre
 * sesiones. */
const semillasCumplimientosPorSesion = new Map<string, Promise<void>>();

async function asegurarSemillaCumplimientos(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
): Promise<void> {
  let semilla = semillasCumplimientosPorSesion.get(sesionId);
  if (!semilla) {
    semilla = (async () => {
      try {
        const eventos = await obtenerEventosPorTipo(db, 'cumplimiento_punto_control', sesionId);
        for (const [clave, estado] of clavesCumplimientoDesdePayloads(eventos)) {
          puntosControlDetectadosHeadless.current.set(clave, estado);
        }
      } catch (error) {
        console.error('[QUIVO][headless] No se pudo sembrar cumplimientos desde el outbox', error);
        // QUI-365: este catch es best-effort a propósito (ver doc de la función) — sin captura
        // explícita, un fallo acá es invisible para siempre, nadie lee la consola del teléfono
        // de un conductor en ruta.
        Sentry.captureException(error, {
          tags: { contexto: 'headless-task', paso: 'sembrar-cumplimientos' },
        });
      }
    })();
    semillasCumplimientosPorSesion.set(sesionId, semilla);
  }
  await semilla;
}

/**
 * Access token para el drenado oportunista (Entrega 2) DESDE EL CONTEXTO HEADLESS —
 * deliberadamente DISTINTO de `obtenerAccessToken` de `use-auth-movil.ts` (ese es un hook de
 * React, con estado en memoria y `useCallback`; acá no hay árbol de componentes, así que la
 * única fuente posible es SecureStore, igual que `obtenerContextoUbicacionPersistido` arriba).
 *
 * Entrega 3 (cierra el punto de extensión que dejó la Entrega 2): si el access token venció,
 * ahora SÍ se intenta un refresh — protegido por el mismo circuit breaker que usa el hook de
 * foreground.
 *
 * Hallazgo 4 (code review, causa candidata de los `refresh-agotado` de Sentry
 * QUIVO-CONTROL-CONDUCTOR-2, siempre al arrancar la app): esta función usaba directo
 * `intentarRefrescarConCircuito` + `actualizarSesionMovil`, salteándose el single-flight de
 * `refrescar()` (`refrescosEnVuelo`, `use-auth-movil.ts`). Con fixes de GPS a ~1/s y el access
 * token vencido, CADA tick del outbox disparaba su propio refresh — el servidor rota el
 * refresh token de forma ATÓMICA (`refresh()`, `auth-movil.service.ts`), así que de N
 * refreshes concurrentes con el mismo `refreshToken` viejo solo uno gana y los N-1 restantes
 * reciben 401 real. Con 5 o más fallos 401 reales, el circuito se abre EN FALSO (no porque la
 * sesión esté muerta, sino por la carrera). Peor: si el chofer reabre la app durante un
 * refresh headless en vuelo, el foreground lee el token viejo (todavía no rotado en su
 * SecureStore local) y también intenta refrescarlo — mismo problema, otro contexto.
 *
 * Fix: reusar `refrescar()` de `use-auth-movil.ts` en vez de orquestar el refresh a mano acá.
 * `refrescar()` ya es single-flight por `refreshToken` (`refrescosEnVuelo`) — toda llamada
 * concurrente para el MISMO token comparte la única promesa en vuelo, así que dentro de un
 * mismo contexto JS (el caso que dispara el bug: varios ticks headless seguidos, o headless +
 * foreground si Android no reciclo el contexto entre ambos) el servidor ve UN solo refresh,
 * no N. Si Android sí recicla el contexto (headless y foreground en instancias JS distintas),
 * el peor caso es el mismo que ya acepta el circuit breaker (un intento de más) — nunca se
 * rompe nada, nunca hay doble captura de la misma evidencia. `refrescar()` ya persiste el
 * token nuevo (`actualizarSesionMovil`) ANTES de resolver su promesa compartida, así que
 * cualquier caller que esperaba esa misma promesa lee el token YA persistido — condición (c)
 * del hallazgo.
 *
 * Sigue siendo TRANSPORTE, no captura: si el refresh falla (circuito abierto, 401 real, o
 * simplemente sin red), esta función devuelve `null` en silencio y `intentarDrenarOportunista`
 * aborta el drenado sin tocar la pantalla del chofer — la evidencia ya está a salvo en el
 * outbox. El breaker ya reporta a Sentry por su cuenta cuando corresponde (ver su docblock);
 * acá no hace falta un `captureException` adicional por cada intento fallido.
 */
export async function obtenerAccessTokenHeadless(): Promise<string | null> {
  const sesion = await cargarSesionMovil();
  if (!sesion) return null;
  if (new Date(sesion.accessTokenExpiresAt) > new Date()) return sesion.accessToken;
  try {
    const actualizada = await refrescar(sesion);
    return actualizada.accessToken;
  } catch {
    return null;
  }
}

/**
 * Headless task de Transistorsoft (QUI-216): se registra UNA sola vez desde `index.js` — es
 * el único lugar donde el SDK permite hacerlo — y sigue ejecutándose después de que el
 * usuario mata la app, siempre que la config tenga `stopOnTerminate: false` +
 * `enableHeadless: true` (`background-geolocation.config.ts`). Sin este registro, el SDK
 * nativo sigue grabando puntos en su propia SQLite interna, pero nada los copia al outbox de
 * la app (`quivo-outbox.db`) — la fuente de verdad de la evidencia legal (RF-67..73) se
 * queda vacía justo en el escenario que el criterio C del spike existe para probar.
 *
 * Doc oficial de Transistorsoft: "Standard JavaScript callbacks like `onLocation` do not
 * fire after app termination. Only registered headless tasks execute."
 *
 * Procesa `location` (registra el punto) y, desde el hallazgo 2 de abajo, también
 * `heartbeat` (solo para drenar, nunca para registrar un punto GPS falso). El resto
 * (`terminate`, `motionchange`, etc.) no tiene, hoy, ninguna escritura asociada — se ignoran
 * explícitamente en vez de fallar en silencio ante un `switch` sin `default`.
 *
 * El registro del punto va bajo `try/catch`: el wrapper del SDK rechaza la promesa de la
 * tarea ante cualquier throw y NO reintenta, así que un fallo transitorio de SecureStore o
 * SQLite perdería ese fix en silencio, justo en el camino de app terminada que el criterio C
 * del spike existe para demostrar.
 *
 * Hallazgo 1 (CRÍTICO, code review de la Entrega 2): ANTES, el `return` de la rama
 * `!contexto` vivía DENTRO de este `try`, y ese `return` salía de TODA la función — el
 * drenado (entonces al final del cuerpo, después del try/catch) nunca se alcanzaba en ese
 * camino. Con el paquete del día vencido o la sesión en el margen de gracia
 * (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`) y la app terminada, CADA tick de ubicación salía por
 * ahí: un `fin_recorrido` pendiente encolado ANTES de que la sesión venciera nunca se drenaba
 * en background — exactamente el caso que el comentario de esa rama decía cubrir, pero no
 * cubría. Fix: el registro del punto y el drenado quedan en bloques separados, sin ningún
 * `return` que pueda saltear al segundo — el drenado de abajo corre pase lo que pase con el
 * primero (fix nuevo, contexto nulo, evento `heartbeat` sin punto que registrar, o error de
 * escritura).
 */
export async function tareaHeadlessUbicacion(event: HeadlessEvent): Promise<void> {
  // Hallazgo 2 (MEDIO, code review de la Entrega 2): `heartbeat` también dispara el drenado.
  // `background-geolocation.config.ts` declara `heartbeatInterval: 60` justamente para dar un
  // segundo punto de enganche cuando el vehículo está quieto y ningún fix `location` llega
  // (nada que reportar, `distanceFilter` no dispara) — sin este camino, con la app terminada
  // los últimos puntos quedaban en el outbox hasta el próximo movimiento y `/en-vivo` mostraba
  // la posición vieja toda la parada.
  if (event.name !== 'location' && event.name !== 'heartbeat') return;

  if (event.name === 'location') {
    try {
      const contexto = await obtenerContextoUbicacionPersistido();
      if (contexto) {
        // El plugin tipa `HeadlessEvent.params` como `Map` genérico (`{[key: string]: ...}`)
        // en vez de exponer una unión discriminada por `event.name` — con `name ===
        // 'location'` el shape real SÍ es `Location` (documentado en la wiki de Android
        // Headless Mode), pero el tipo del propio paquete no lo refleja. `as unknown as
        // Location` documenta esa brecha en vez de silenciarla con `any`/`@ts-ignore`.
        const location = event.params as unknown as Location;

        const db = await abrirOutbox();
        await asegurarSemillaCumplimientos(db, contexto.sesionId);
        await registrarPuntoGps(db, location, contexto, puntosControlDetectadosHeadless);
      }
      // `contexto === null`: sin turno vigente (sesión cerrada o paquete del día vencido) —
      // el punto se descarta, decisión ya tomada dentro de
      // `obtenerContextoUbicacionPersistido` (ver su comentario). El drenado de abajo corre
      // IGUAL — ver el hallazgo 1 arriba.
    } catch (error) {
      console.error('[QUIVO][headless] No se pudo registrar la ubicación en el outbox', error);
      // QUI-365: este es EL escenario que el ticket marca como el peor y el que menos se ve —
      // el `try/catch` de este bloque existe para que un fallo transitorio no tumbe la
      // promesa que el SDK nativo no reintenta (ver doc arriba), pero eso mismo lo vuelve
      // invisible sin captura explícita: no hay UI, no hay logs que alguien vaya a mirar en
      // el teléfono de un conductor en ruta. Sin este `captureException`, un punto GPS
      // perdido acá (evidencia legal, RF-67..73) no dejaría NINGÚN rastro reportado. Este
      // catch NO envuelve el drenado de abajo a propósito: que este tick falle en capturar no
      // debe impedir el intento de vaciar lo que YA estaba persistido de ticks anteriores.
      Sentry.captureException(error, {
        tags: { contexto: 'headless-task', paso: 'registrar-punto-gps', evento: event.name },
      });
    }
  }

  // Entrega 2 (`docs/plan-correccion-post-piloto-2026-09-09.md`) — causa raíz del síntoma más
  // reportado del piloto ("tengo que cerrar la app para que se actualice la ubicación"):
  // `headless-task.ts` escribía al outbox pero nadie lo drenaba en background. Ningún
  // `return` de arriba puede saltear esta línea (hallazgo 1) — corre para `location` Y
  // `heartbeat`, con o sin contexto, con o sin error de escritura. Va con AWAIT porque el SDK
  // de Transistorsoft da por terminada la tarea headless en cuanto se ejecuta la ÚLTIMA LÍNEA
  // de esta función: sin este `await`, la promesa de `intentarDrenarOportunista` queda
  // corriendo "de fondo" sobre un contexto que el SDK ya considera cerrado, y el trabajo
  // (mutex, POST, liberar el lease) se corta a mitad de camino en cuanto el wake lock se
  // libera.
  await intentarDrenarOportunista(obtenerAccessTokenHeadless);
}

/** `stop()` aislado en su propio try/catch: que falle apagar el plugin no debe escalar al
 * catch general del tick ni impedir que el punto siguiente se evalúe de nuevo. */
async function detenerTrackingNativo(): Promise<void> {
  try {
    const estado = await BackgroundGeolocation.getState();
    if (!estado.enabled) return;
    await BackgroundGeolocation.stop();
  } catch (error) {
    console.error('[QUIVO][headless] No se pudo detener el tracking nativo', error);
    Sentry.captureException(error, {
      tags: { contexto: 'headless-task', paso: 'detener-tracking-nativo' },
    });
  }
}
