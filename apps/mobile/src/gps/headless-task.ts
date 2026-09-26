import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import BackgroundGeolocation, {
  type HeadlessEvent,
  type Location,
} from 'react-native-background-geolocation';
import { derivarEventIdDeterministico, type PuntoControlPaquete } from '@quivo/shared';
import {
  confirmarVisitasVencidas,
  filtrarPorSesion,
  UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
  type CumplimientoAEmitir,
  type DeteccionPuntoControl,
  type EstadoPuntoControl,
} from './geofence';
import {
  clavesCumplimientoDesdePayloads,
  combinarConVisitasPendientes,
  construirEventosDeUbicacion,
  type ContextoUbicacion,
} from './location-task';
import {
  abrirOutbox,
  encolarEvento,
  encolarEventoYLimpiarVisita,
  eliminarVisitaPendiente,
  guardarVisitaPendiente,
  obtenerEventosPorTipo,
  obtenerVisitasPendientes,
} from '../db/outbox';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal } from '../db/paquete-dia';
import { intentarDrenarOportunista } from '../features/operacion/drenaje-oportunista';
// Hallazgo 4 (code review de la Entrega 2/3): `refrescar` en vez de llamar directo a
// `intentarRefrescarConCircuito` — ver el docblock de `obtenerAccessTokenHeadless` más abajo.
import { refrescar } from '../features/auth/use-auth-movil';
import {
  cargarSesionMovil,
  hayLogoutSolicitado,
  obtenerDeviceIdMovil,
} from '../shared/security/sesion-movil-store';
import {
  anunciarDeteccionesDelTick,
  anunciarLlegadaPuntoControl,
  reintentarAnunciosLlegadaPendientes,
} from '../features/operacion/anuncio-punto-control';
import {
  evaluarAnuncioDeHeartbeat,
  evaluarAnunciosDeFixes,
  UMBRAL_ANUNCIO_PROXIMIDAD_MS,
  type AnuncioDecidido,
} from '../features/operacion/decidir-anuncio';

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
 * R1 (hallazgo de revisión SERIO, ampliación posterior): desde ese fix, esta MISMA cola también
 * serializa las confirmaciones forzadas de heartbeat/cierre de recorrido
 * (`confirmarVisitasVencidasEnCola`, headless y foreground) — no solo los fixes reales. Antes,
 * el heartbeat y el cierre llamaban `aplicarConfirmacionesForzadas` por FUERA de la cola: un fix
 * y un heartbeat concurrentes podían leer la MISMA visita pendiente antes de que ninguno
 * terminara de escribir, y los dos emitir un `cumplimiento_punto_control` con `eventId`
 * DISTINTOS para la MISMA pasada — el servidor solo dedupea por `eventId` (QUI-241), así que el
 * paso se contaba dos veces. La cola cierra esa ventana exactamente igual que cierra la de los
 * fixes: mientras una operación de CUALQUIERA de los tres caminos está en curso, ninguna otra
 * puede empezar a leer/escribir `visitas_pendientes` ni emitir cumplimientos.
 *
 * El `.catch(() => undefined)` de cada eslabón asegura que una operación que rechaza no deje la
 * cola rota para siempre — una promesa rechazada instalada tal cual en `colaRegistroGps`
 * tumbaría TODAS las operaciones futuras encadenadas con `.then()`. El error real se sigue
 * propagando al caller de ESA operación puntual (`resultado`, sin el `.catch`), solo que la cola
 * avanza igual para la próxima.
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
 * FIX POST-REVISIÓN (hallazgo 8, code review — "el reintento de notificaciones bloquea
 * gps_point"): techo de tiempo PROPIO, separado de `TIMEOUT_REGISTRO_GPS_MS`, para
 * `reintentarAnunciosLlegadaPendientes` — ver el docblock de `ejecutarEnColaRegistroGps` para el
 * porqué de correrlo aparte. Más corto que el de la escritura crítica: un puente de
 * notificaciones colgado (`expo-notifications`) no debe demorar el tick siguiente ni un segundo
 * más de lo necesario para detectarlo.
 */
const TIMEOUT_REINTENTO_ANUNCIOS_MS = 5_000;

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
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 7, "el timeout de la cola no cancela la
 * operación subyacente"): contador de GENERACIÓN de la cola. `conTimeout` (arriba) ya
 * documentaba el hueco: al vencer el techo de `TIMEOUT_REGISTRO_GPS_MS`, la cola avanza (el
 * siguiente fix/heartbeat puede empezar a leer/escribir `estadosPuntosControl`/SQLite) pero la
 * operación VENCIDA sigue corriendo de fondo — si finalmente termina (SQLite que tardó pero no
 * estaba muerta), sus escrituras llegan TARDE y pueden intercalarse con las de la operación que
 * la cola ya dejó avanzar, con el memory Map como principal víctima (una escritura vieja podría
 * pisar un estado más nuevo).
 *
 * DECISIÓN (documentada, punto 7 del brief): se optó por este contador de generación en vez de
 * simplemente "no liberar la exclusión al vencer el timeout". No liberar reintroduciría el
 * problema ORIGINAL que el propio timeout (B7) existe para cerrar: una escritura REALMENTE
 * trabada (no solo lenta) colgaría la cola para siempre, y con ella TODOS los puntos GPS del
 * resto del turno, en los dos contextos (headless y foreground) — "la pérdida total de la
 * evidencia del resto del turno", tal como ya lo describe el comentario de
 * `TIMEOUT_REGISTRO_GPS_MS`. El generation counter deja que la cola siga avanzando (evidencia
 * nueva sigue entrando sin esperar a la operación trabada) mientras impide que esa operación,
 * si finalmente despierta, corrompa el estado que las operaciones más nuevas ya construyeron:
 * `registrarPuntoGpsInterno` captura su propia generación al empezar y la revisa antes de cada
 * tramo de escritura — si ya quedó vieja, aborta el RESTO de su trabajo (lo que ya escribió
 * antes de vencer no tiene vuelta atrás, pero no sigue escribiendo después).
 */
let generacionColaRegistroGps = 0;

/** `true` si `miGeneracion` sigue siendo la generación ACTUAL de la cola — `false` si esta
 * operación ya venció su timeout (la cola avanzó, incrementando el contador) mientras seguía
 * corriendo de fondo. Ver `generacionColaRegistroGps`. */
function generacionVigente(miGeneracion: number): boolean {
  return miGeneracion === generacionColaRegistroGps;
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
 *
 * R1 (hallazgo de revisión SERIO, "evidencia duplicada por concurrencia"): el cuerpo genérico de
 * encolado vive ahora en `ejecutarEnColaRegistroGps` (abajo), compartido con las confirmaciones
 * forzadas de heartbeat/cierre (`confirmarVisitasVencidasEnCola`) — antes esas dos corrían POR
 * FUERA de esta cola, así que un fix y un heartbeat concurrentes podían leer la MISMA visita
 * pendiente antes de que ninguno terminara de escribir y emitir dos `cumplimiento_punto_control`
 * con `eventId` distintos para la MISMA pasada (el servidor solo dedupea por `eventId`, QUI-241
 * — el paso se contaba dos veces). Ver el docblock de `ejecutarEnColaRegistroGps`.
 */
export function registrarPuntoGps(
  db: SQLite.SQLiteDatabase,
  location: Location,
  contexto: ContextoUbicacion,
  estadosPuntosControl: ContenedorEstadosPuntosControl,
): Promise<{
  deteccion: DeteccionPuntoControl | null;
  deteccionAproximacion: DeteccionPuntoControl | null;
  puntosRearmados: string[];
  puntosRearmadosVoz: string[];
  anunciosLlegada: AnuncioDecidido[];
}> {
  return ejecutarEnColaRegistroGps(
    db,
    () => registrarPuntoGpsInterno(db, location, contexto, estadosPuntosControl),
    contexto.sesionId,
    contexto.puntosControl,
  );
}

/**
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 6, "visita perdida si falla
 * guardarVisitaPendiente"): cola de reintento EN MEMORIA para escrituras de `visitas_pendientes`
 * que fallaron en su primer intento. Antes de este fix, una escritura fallida dejaba la
 * transición SIN aplicar a `estados` (memoria) — a propósito, para no adelantar la memoria
 * respecto de lo que SQLite tenía realmente confirmado (ver el docblock viejo de
 * `registrarPuntoGpsInterno`, G2). El problema real que ese diseño no cubría: si el ÚNICO fix
 * dentro del radio de un punto de control es justo el que falla al escribir, la memoria se
 * queda en `dentro:false` para siempre — el próximo fix, ya afuera del radio, no ve ninguna
 * visita en curso que cerrar, y esa pasada se pierde PARA SIEMPRE, no solo hasta que SQLite se
 * desocupe (el escenario que `visitas_pendientes` existe para cubrir era justo el opuesto:
 * proteger contra un CRASH, no contra una escritura momentáneamente ocupada mientras el proceso
 * sigue vivo).
 *
 * El fix: la transición SIEMPRE se aplica a `estados` (memoria) — la continuidad de la visita
 * dentro de la vida de ESTE proceso ya no depende de que la escritura a SQLite salga bien en el
 * primer intento — y la escritura fallida se encola acá para reintentarse, en orden, ANTES de
 * procesar la PRÓXIMA operación de la cola (el próximo fix o heartbeat, sea cual sea primero).
 * Tradeoff ACEPTADO y documentado: si el proceso muere ANTES de que el reintento drene esta
 * cola, la copia durable de esa visita en curso se pierde igual (no hay forma de sobrevivir a un
 * crash sin haber llegado a disco) — pero es estrictamente MEJOR que el diseño anterior, que
 * perdía la visita incluso sin ningún crash de por medio.
 */
type ReintentoVisitaPendiente =
  | { tipo: 'guardar'; visita: Parameters<typeof guardarVisitaPendiente>[1] }
  | { tipo: 'eliminar'; clave: string };

const reintentosVisitaPendiente = new Map<string, ReintentoVisitaPendiente>();

/** Drena la cola de `reintentosVisitaPendiente` — se llama desde `ejecutarEnColaRegistroGps`,
 * ANTES de cada operación nueva (fix o heartbeat), así que corre serializada con el resto de la
 * cola y nunca compite por la escritura con la operación que la sigue. Nunca rechaza: un
 * reintento que vuelve a fallar simplemente queda en la cola para el próximo turno.
 *
 * FIX POST-REVISIÓN (hallazgo 7, code review — "sin chequeo de generación, una operación vencida
 * puede resucitar `visitas_pendientes`"): antes, este drenado no tenía forma de saber si la
 * operación que lo encoló (`ejecutarEnColaRegistroGps`) ya venció su timeout mientras tanto — si
 * `guardarVisitaPendiente`/`eliminarVisitaPendiente` tardaban lo suficiente como para que la cola
 * avanzara (generación++) y una operación MÁS NUEVA ya hubiera confirmado/borrado la MISMA visita,
 * este drenado, al despertar tarde, podía reinsertar (`guardarVisitaPendiente`) una fila que la
 * operación nueva YA había borrado transaccionalmente (`encolarEventoYLimpiarVisita`) — una visita
 * fantasma que el próximo sembrado (`combinarConVisitasPendientes`) reabriría, duplicando una
 * pasada de evidencia ya emitida. `miGeneracion` se captura ANTES de empezar (en
 * `ejecutarEnColaRegistroGps`, el turno que le toca a esta operación) y se revisa después de CADA
 * `await` — si ya quedó vieja, se corta sin seguir mutando `reintentosVisitaPendiente`/SQLite.
 */
async function drenarReintentosVisitaPendiente(
  db: SQLite.SQLiteDatabase,
  miGeneracion: number,
): Promise<void> {
  if (reintentosVisitaPendiente.size === 0) return;
  for (const [clave, reintento] of Array.from(reintentosVisitaPendiente.entries())) {
    if (!generacionVigente(miGeneracion)) return;
    try {
      if (reintento.tipo === 'guardar') {
        await guardarVisitaPendiente(db, reintento.visita);
      } else {
        await eliminarVisitaPendiente(db, reintento.clave);
      }
      // FIX POST-REVISIÓN (hallazgo 7): re-chequear INMEDIATAMENTE después del `await` — si la
      // cola avanzó mientras esta escritura estaba en vuelo, no tocar `reintentosVisitaPendiente`
      // (la operación nueva, en su propia generación, es la única fuente de verdad a partir de
      // acá).
      if (!generacionVigente(miGeneracion)) return;
      reintentosVisitaPendiente.delete(clave);
    } catch (error) {
      if (!generacionVigente(miGeneracion)) return;
      Sentry.captureException(error, {
        tags: { contexto: 'gps-cola', paso: 'reintento-visita-pendiente' },
        extra: { clave },
      });
      // Sigue en la cola — se reintenta de nuevo en la próxima operación encolada.
    }
  }
}

/**
 * R1: cuerpo genérico de la cola FIFO — extraído de `registrarPuntoGps` para que
 * `confirmarVisitasVencidasEnCola` (heartbeat y cierre de recorrido, headless y foreground)
 * pueda encolar SU operación en la MISMA cola, con el MISMO techo de tiempo (B7) y el mismo
 * manejo de errores/profundidad. Serializar por acá — no solo el camino de fixes reales — es lo
 * que cierra la ventana de concurrencia de R1: mientras una operación (fix, heartbeat o cierre)
 * está en curso, ninguna otra puede empezar a leer/escribir `visitas_pendientes` ni emitir
 * cumplimientos, sin importar de cuál de los tres caminos venga.
 */
function ejecutarEnColaRegistroGps<T>(
  db: SQLite.SQLiteDatabase,
  operacion: () => Promise<T>,
  sesionId: string,
  puntosControl: PuntoControlPaquete[],
): Promise<T> {
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
  // se encola — ver el comentario de `TIMEOUT_REGISTRO_GPS_MS`. FIX POST-REVISIÓN (punto 6, gap
  // "el drenado de reintentos queda fuera de conTimeout"): el drenado de VISITAS PENDIENTES sigue
  // corriendo DENTRO del mismo `conTimeout` que `operacion()` — es housekeeping de la escritura
  // crítica (`visitas_pendientes`), con el mismo presupuesto de tiempo.
  //
  // FIX POST-REVISIÓN (hallazgo 8, code review — "el reintento de notificaciones bloquea
  // gps_point"): el reintento de ANUNCIOS de llegada (`reintentarAnunciosLlegadaPendientes`) YA
  // NO corre acá adentro — antes corría ANTES de `operacion()`, dentro del MISMO
  // `TIMEOUT_REGISTRO_GPS_MS`, así que un puente de notificaciones colgado (`expo-notifications`
  // sin responder) consumía el presupuesto de tiempo de la escritura de `gps_point`/evidencia,
  // que no tiene nada que ver con notificaciones. Ahora corre DESPUÉS de que `operacion()`
  // resuelve (evidencia ya persistida) y FUERA de la cadena que `resultado` propaga: un
  // `conTimeout` propio (`TIMEOUT_REINTENTO_ANUNCIOS_MS`), fire-and-forget con su propio
  // `.catch` — nunca bloquea ni hace fallar el tick siguiente.
  //
  // FIX POST-REVISIÓN (code review, "doble llegaste" — vibración+notificación duplicadas): este
  // reintento fire-and-forget corre CONCURRENTE con cualquier `anunciarLlegadaPuntoControl` que
  // el caller dispare después de `await`ar esta misma operación (p. ej. `manejarHeartbeatHeadless`
  // sobre los `anunciosLlegada` que acaba de devolver `confirmarVisitasVencidasEnCola`) — su
  // `SELECT` (`obtenerAnunciosPendientesDeProgramar`, `db/outbox.ts`) puede correr ENTRE el
  // `INSERT` del claim (`reclamarIntencionAnuncio`) y el resto de `intentarProgramarNotificacion`.
  // Lo que cierra esa ventana NO es un `identifier` fijo por sí solo (`identifier` solo evita que
  // DOS notificaciones apiladas queden visibles, no evita que `scheduleNotificationAsync` y
  // `Vibration.vibrate` se disparen dos veces): es que `reclamarIntencionAnuncio` deja la fila
  // reclamada ATÓMICAMENTE en `'programando'` con `ultimo_intento_ts` puesto en el MISMO INSERT
  // (`db/outbox.ts`) — nunca pasa por un estado `'pendiente'` intermedio que el `SELECT` de arriba
  // pudiera ofrecer sin chequear antigüedad. Ver el docblock de `reclamarIntencionAnuncio` para el
  // detalle del hueco que tenía antes y el tradeoff de recuperación tras un crash.
  const miGeneracionAlEmpezar = generacionColaRegistroGps;
  const resultado = colaRegistroGps
    .then(() =>
      conTimeout(
        (async () => {
          await drenarReintentosVisitaPendiente(db, miGeneracionAlEmpezar);
          return operacion();
        })(),
        TIMEOUT_REGISTRO_GPS_MS,
      ),
    )
    .then((valor) => {
      void conTimeout(
        reintentarAnunciosLlegadaPendientes(db, sesionId, puntosControl),
        TIMEOUT_REINTENTO_ANUNCIOS_MS,
      ).catch((error: unknown) => {
        console.error('[QUIVO][gps] no se pudo reintentar los anuncios de llegada pendientes', error);
        Sentry.captureException(error, {
          tags: { contexto: 'gps-cola', paso: 'reintento-anuncios-llegada' },
          extra: { sesionId },
        });
      });
      return valor;
    })
    .catch((error: unknown) => {
      if (error instanceof TimeoutRegistroGpsError) {
        console.error('[QUIVO][gps] una operación de la cola de registro venció su techo de tiempo', error);
        // FIX POST-REVISIÓN (punto 7): incrementa la GENERACIÓN — la operación vencida, si
        // finalmente termina de correr, va a ver `generacionVigente(miGeneracion) === false` y
        // va a abortar el resto de sus escrituras en vez de corromper el estado que la próxima
        // operación (ya despachada, ver el `.then` de arriba) construya mientras tanto.
        generacionColaRegistroGps += 1;
        // Sin esto, una escritura trabada arrastra al resto del turno en silencio — el peor
        // caso del ticket, invisible por definición (nadie lee la consola del teléfono de un
        // conductor en ruta). Sirve, además, de WATCHDOG: es la señal que Sentry recibe de que
        // una operación vencida quedó corriendo de fondo.
        Sentry.captureException(error, {
          tags: { contexto: 'gps-cola', paso: 'timeout-registro-punto' },
          extra: {
            timeoutMs: TIMEOUT_REGISTRO_GPS_MS,
            profundidadCola: profundidadColaRegistroGps,
            generacion: generacionColaRegistroGps,
            sesionId,
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
 * Las transiciones de RE-ARMADO/entrada/avance de mínimo (sin `cumplimiento_punto_control`
 * asociado — un punto que simplemente se aleja, entra o mejora su mínimo sin confirmar no
 * genera ningún evento) se aplican junto con el `gps_point`, que es SIEMPRE el primer evento del
 * tick: si el `gps_point` falla, el `await` de abajo aborta el tick entero antes de llegar a
 * aplicar NINGUNA transición (ni de re-armado ni de cumplimiento) — mismo comportamiento que
 * antes para ese caso.
 *
 * FIX POST-REVISIÓN (G2, "la persistencia del candidato va después de la memoria"): para ESAS
 * transiciones sin evento propio, la copia durable del candidato (`visitas_pendientes`,
 * `guardarVisitaPendiente`/`eliminarVisitaPendiente`) se escribe AHORA, por clave, INMEDIATAMENTE
 * ANTES de aplicar esa transición puntual a `estados` (memoria) — nunca en un segundo `for`
 * aparte después de que TODA la memoria ya avanzó, como hacía la versión anterior (el
 * "housekeeping" de bug 5, hoy fusionado acá). Antes, si `guardarVisitaPendiente` fallaba, el
 * error quedaba solo logueado (`console.error`, sin capturar la causa raíz de forma que bloquee
 * nada) y la memoria YA había avanzado igual: si la app se mataba entre ese momento y el próximo
 * fix, `asegurarSemillaCumplimientos`/`sembrarCumplimientos` reconstruía el estado desde el
 * outbox SIN la fila de `visitas_pendientes` (nunca se escribió) — la visita en curso se perdía
 * por completo, exactamente el escenario que `visitas_pendientes` existe para cubrir.
 *
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 6, "visita perdida si falla
 * guardarVisitaPendiente" — SUPERSEDE el párrafo de arriba): el diseño de G2 (no aplicar la
 * transición a `estados` si la escritura falla) tenía su propio hueco: si el ÚNICO fix dentro
 * del radio de un punto es justo el que falla al escribir, la memoria se queda en `dentro:
 * false` para siempre — el próximo fix, ya afuera del radio, no ve ninguna visita que cerrar, y
 * la pasada se pierde PARA SIEMPRE, no solo hasta que SQLite se desocupe. Ahora la transición
 * SIEMPRE se aplica a `estados` (memoria) y la escritura fallida se encola en
 * `reintentosVisitaPendiente` (ver su docblock) para reintentarse antes de la PRÓXIMA operación
 * de la cola. El resto de las claves de este mismo tick no se ven afectadas (el fallo es por
 * clave, no aborta el tick completo).
 */
async function registrarPuntoGpsInterno(
  db: SQLite.SQLiteDatabase,
  location: Location,
  contexto: ContextoUbicacion,
  estadosPuntosControl: ContenedorEstadosPuntosControl,
): Promise<{
  deteccion: DeteccionPuntoControl | null;
  deteccionAproximacion: DeteccionPuntoControl | null;
  puntosRearmados: string[];
  puntosRearmadosVoz: string[];
  anunciosLlegada: AnuncioDecidido[];
}> {
  // FIX POST-REVISIÓN (Codex `verify-fix`, punto 7): generación capturada AL EMPEZAR — si para
  // cuando esta operación llega a escribir algo la cola ya avanzó (esta operación venció su
  // timeout mientras tanto), `generacionVigente(miGeneracion)` da `false` y el resto del cuerpo
  // aborta sin seguir escribiendo. Ver el docblock largo de `generacionColaRegistroGps`.
  const miGeneracion = generacionColaRegistroGps;

  // B6: `.current` se lee ACÁ, ya con el turno de la cola concedido — nunca en el caller, que
  // pudo haber quedado con una referencia previa a una re-siembra (ver
  // `ContenedorEstadosPuntosControl`).
  const estados = estadosPuntosControl.current;
  const {
    eventos,
    deteccion,
    deteccionAproximacion,
    deteccionesTick,
    tsFixMs,
    transicionesEstado,
    avisosPrecision,
    puntosRearmados,
    puntosRearmadosVoz,
  } = construirEventosDeUbicacion(location, contexto, estados);
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

  // REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
  // 2026-09-23 — "un solo punto de llamada, dentro de colaRegistroGps"): la decisión de anuncio
  // de "llegaste" (`evaluarAnunciosDeFixes`, `features/operacion/decidir-anuncio.ts`) corre ACÁ,
  // ANTES de persistir nada — es PURA (sin I/O, sin `await` de por medio), así que no hay ventana
  // de generación que proteger: lee `estados` (el Map TAL COMO ESTABA antes de este tick) y
  // `transicionesEstado` (la salida YA CALCULADA de `filtrarNuevosCumplimientos` para el MISMO
  // tick), nunca la evidencia ya persistida — la evidencia NUNCA dispara este canal.
  const { anuncios: anunciosLlegada, transiciones: transicionesAnuncio } = evaluarAnunciosDeFixes(
    estados,
    transicionesEstado,
    deteccionesTick,
    puntosRearmados,
    contexto.sesionId,
    tsFixMs,
  );

  // Claves cuya transición ya está atada a un evento propio (`evento.clave`, los
  // `cumplimiento_punto_control` emitidos este tick) — el resto de `transicionesEstado` son
  // re-armados/entradas/avances de mínimo sin evento asociado, aplicados junto al `gps_point`.
  const clavesConEventoPropio = new Set(
    eventos.map((evento) => evento.clave).filter((clave): clave is string => clave !== undefined),
  );

  for (const evento of eventos) {
    // FIX POST-REVISIÓN (punto 7): chequeo de generación ANTES de cada escritura del tick — una
    // operación que venció su timeout y sigue corriendo de fondo deja de escribir apenas la
    // cola avanzó, en vez de intercalar escrituras tardías con la operación más nueva que ya
    // está en curso.
    if (!generacionVigente(miGeneracion)) break;
    if (evento.clave !== undefined) {
      // FIX POST-REVISIÓN (bug 5): confirmación — encolar el evento y borrar la fila de
      // `visitas_pendientes` de esta visita en LA MISMA transacción (ver
      // `encolarEventoYLimpiarVisita`, `db/outbox.ts`). Ya es persist-antes-que-memoria (la
      // transacción entera corre antes de tocar `estados`) — no necesita el fix de G2.
      await encolarEventoYLimpiarVisita(
        db,
        {
          deviceId: contexto.deviceId,
          tipo: evento.tipo,
          payload: evento.payload,
          // FIX POST-REVISIÓN ("eventId estable"): derivado de {sesionId, puntoControlId,
          // pasada} en `construirEventosDeUbicacion` — ver `EventoUbicacionConstruido.eventId`.
          eventId: evento.eventId,
        },
        evento.clave,
      );
      // FIX POST-REVISIÓN (gap "la generación de la cola no se chequea después de cada await"):
      // re-chequear ACÁ, inmediatamente después del `await` de arriba y ANTES de cualquier
      // mutación — antes solo se chequeaba al INICIO de cada iteración del `for`, dejando una
      // ventana entre el `await` y el `estados.set` de abajo sin proteger.
      if (!generacionVigente(miGeneracion)) break;
      // FIX POST-REVISIÓN (gap "reintentos descartados en confirmación transaccional"): la
      // confirmación que acaba de correr ya borró (transaccionalmente, `encolarEventoYLimpiarVisita`)
      // cualquier fila de `visitas_pendientes` de esta MISMA clave — un reintento 'guardar' viejo
      // que hubiera quedado en `reintentosVisitaPendiente` de un `guardarVisitaPendiente` fallido
      // en un tick ANTERIOR ahora está obsoleto: si se drenara después, reinsertaría una visita
      // que ya confirmó, reabriendo una pasada fantasma.
      reintentosVisitaPendiente.delete(evento.clave);
      // `cumplimiento_punto_control`: transición aplicada YA, recién confirmada su propia
      // escritura — ver el comentario de la función para el porqué (M4).
      const estado = transicionesEstado.get(evento.clave);
      if (estado) estados.set(evento.clave, estado);
    } else {
      await encolarEvento(db, {
        deviceId: contexto.deviceId,
        tipo: evento.tipo,
        payload: evento.payload,
      });
      // FIX POST-REVISIÓN (gap "generación tras cada await"): mismo motivo que arriba — el
      // `gps_point` recién persistió, chequear ANTES de entrar al loop de housekeeping.
      if (!generacionVigente(miGeneracion)) break;
      // FIX POST-REVISIÓN (G2): `gps_point` (siempre el primer evento, sin `clave` propia) ya
      // persistió — ahora, por cada transición SIN evento propio, primero se escribe (o borra)
      // su fila de `visitas_pendientes` y RECIÉN SI ESO SALE BIEN se aplica la transición a
      // `estados`. Ver el docblock de la función para el porqué del orden y del fail-per-clave
      // (no aborta el tick, no bloquea las demás claves).
      for (const [clave, estado] of transicionesEstado) {
        // FIX POST-REVISIÓN (punto 7): mismo chequeo que el loop externo — una tanda de
        // housekeeping puede cubrir varias claves; si la cola avanzó a mitad de esta tanda, se
        // corta acá en vez de seguir escribiendo con datos ya viejos.
        if (!generacionVigente(miGeneracion)) break;
        if (clavesConEventoPropio.has(clave)) continue; // ya persistida+aplicada arriba
        const esVisitaEnCurso =
          estado.dentro &&
          estado.confirmado === false &&
          estado.candidatoLat !== undefined &&
          estado.candidatoLng !== undefined &&
          estado.candidatoTsFixMs !== undefined &&
          estado.minDistanciaM !== undefined &&
          estado.puntoControlId !== undefined &&
          estado.radioToleranciaM !== undefined;
        const reintento: ReintentoVisitaPendiente = esVisitaEnCurso
          ? {
              tipo: 'guardar',
              visita: {
                clave,
                sesionId: contexto.sesionId,
                puntoControlId: estado.puntoControlId as string,
                pasadasPrevias: estado.pasadas,
                radioToleranciaM: estado.radioToleranciaM as number,
                minDistanciaM: estado.minDistanciaM as number,
                distanciaEntradaM: estado.distanciaEntradaM ?? (estado.minDistanciaM as number),
                candidatoLat: estado.candidatoLat as number,
                candidatoLng: estado.candidatoLng as number,
                candidatoTsFixMs: estado.candidatoTsFixMs as number,
                ultimoEmitidoMs: estado.ultimoEmitidoMs,
                fixesDentroSinConfirmar: estado.fixesDentroSinConfirmar ?? 0,
              },
            }
          : { tipo: 'eliminar', clave };
        try {
          if (reintento.tipo === 'guardar') {
            await guardarVisitaPendiente(db, reintento.visita);
          } else {
            // Re-armada sin confirmar, o transición sin visita en curso: borra cualquier fila
            // vieja que pudiera quedar (no-op seguro si no había ninguna).
            await eliminarVisitaPendiente(db, clave);
          }
          // FIX POST-REVISIÓN (gap "generación tras cada await"): chequear INMEDIATAMENTE
          // después del `await` de arriba, antes de tocar `reintentosVisitaPendiente`/`estados`.
          if (!generacionVigente(miGeneracion)) break;
          // La escritura salió bien: si había quedado un reintento pendiente de un fallo
          // anterior para esta MISMA clave, ya no hace falta — este intento lo reemplaza.
          reintentosVisitaPendiente.delete(clave);
        } catch (error) {
          console.error('[QUIVO][gps] No se pudo actualizar visitas_pendientes — se reintentará antes del próximo fix/heartbeat', error);
          // FIX POST-REVISIÓN (Codex `verify-fix`, punto 6): a diferencia del diseño anterior
          // (G2), que dejaba la memoria SIN avanzar para esta clave, ahora se encola el
          // reintento (`reintentosVisitaPendiente`, drenado por `ejecutarEnColaRegistroGps`
          // ANTES de la próxima operación) — ver el docblock largo de esa cola para el porqué
          // del cambio de tradeoff. `estados.set` de abajo corre SIEMPRE, éxito o fallo.
          reintentosVisitaPendiente.set(clave, reintento);
          Sentry.captureException(error, {
            tags: { contexto: 'gps-cola', paso: 'visita-pendiente-reintento-encolado' },
            extra: { sesionId: contexto.sesionId, clave },
          });
        }
        // FIX POST-REVISIÓN (gap "generación tras cada await"): el `catch` de arriba también
        // corre después de un `await` que rechazó — cubrir ese camino acá también, no solo el de
        // éxito (que ya chequeó arriba, antes de este punto).
        if (!generacionVigente(miGeneracion)) break;
        // FIX POST-REVISIÓN (punto 6): se aplica SIEMPRE, haya salido bien o mal la escritura —
        // la continuidad de la visita dentro de la vida de este proceso ya no depende de que
        // SQLite confirme en el primer intento (ver el docblock de `reintentosVisitaPendiente`).
        estados.set(clave, estado);
      }
    }
  }

  // REDISEÑO: aplica las transiciones de ANUNCIO (`anuncioHecho`/`anuncioDesdeMs`, decididas más
  // arriba por `evaluarAnunciosDeFixes`, ANTES de que este loop empezara) como OVERLAY sobre lo
  // que la evidencia ya dejó en `estados` — nunca antes, para no pisar una transición de
  // evidencia con un objeto desactualizado. Vuelve a chequear la generación (el loop de arriba
  // pudo haber corrido `await`s que la vencieran mientras tanto).
  if (generacionVigente(miGeneracion)) {
    for (const [clave, estadoAnuncio] of transicionesAnuncio) {
      const actual = estados.get(clave);
      if (!actual) continue;
      estados.set(clave, {
        ...actual,
        anuncioHecho: estadoAnuncio.anuncioHecho,
        anuncioDesdeMs: estadoAnuncio.anuncioDesdeMs,
      });
    }
  }

  return {
    deteccion,
    deteccionAproximacion,
    puntosRearmados,
    puntosRearmadosVoz,
    anunciosLlegada,
  };
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

  // Fix drenado en background (2026-09-25, punto 2): `ejecutarLogout` (`use-auth-movil.ts`)
  // puede devolver 'pendiente' cuando no consigue el lease `refresh-sesion` a tiempo (caso
  // patológico) — marca `marcarLogoutSolicitado()` pero deja la sesión INTACTA en disco a
  // propósito, para que `intentarRevocacionesPendientes` la encuentre y reintente el logout
  // completo. Este task headless corre fuera de React y de ese ciclo de reintento: sin este
  // chequeo, seguiría atribuyendo evidencia GPS NUEVA (RF-67..73) al `sesionId` de un chofer
  // que ya pidió cerrar sesión — crítico en teléfonos compartidos, donde otro chofer puede
  // tomar el vehículo en esa ventana.
  //
  // Punto 2 (code review 2026-09-25): la marca PRESENTE y la LECTURA que falla NO son lo
  // mismo, y antes se trataban igual (fail-closed también sobre el tracker). Un error
  // transitorio de Keystore/SecureStore en un solo tick no es evidencia de que el chofer pidió
  // cerrar sesión — pero `detenerTrackingNativo()` es IRREVERSIBLE en este camino: además de
  // parar el plugin, desactiva `startOnBoot`, así que un solo tick con Keystore ocupado podía
  // matar la captura GPS del resto del turno sin que nada la reanude. Ahora: marca PRESENTE →
  // se sigue deteniendo el tracker (fail-closed real, hay evidencia). LECTURA que falla → se
  // descarta el punto de ESTE tick (fail-closed sobre la atribución, mismo motivo que
  // `debeRestaurarComoDeslogueado` en `use-auth-movil.ts`) pero el tracker sigue corriendo —
  // el próximo tick vuelve a intentar leer la marca. A propósito NO se toca el drenado
  // (`intentarDrenarOportunista`, ver el caller): la evidencia YA registrada antes de este
  // punto debe seguir subiendo — la sesión sigue siendo válida server-side hasta que la
  // revocación real se complete, así que autenticar ESE envío no es operar por el chofer que
  // se fue, es solo terminar de entregar lo que ya se capturó legítimamente.
  let logoutSolicitado: boolean;
  try {
    logoutSolicitado = await hayLogoutSolicitado();
  } catch {
    return null;
  }
  if (logoutSolicitado) {
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

/**
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 5, "semilla fallida"): sesiones cuya siembra
 * HIDRATÓ de verdad (el `try` de abajo terminó sin excepción) — separado del cache de promesas
 * de arriba a propósito. Antes de este fix, una lectura fallida (SQLite ocupada, handle zombi)
 * quedaba igual "completada" en `semillasCumplimientosPorSesion` (la promesa resuelve aunque su
 * `catch` interno haya corrido) con el Map vacío — el contador de pasadas de esa sesión
 * arrancaba de cero, y con el `eventId` determinístico (`{sesionId, puntoControlId, pasada}`)
 * una pasada REAL posterior podía reusar `pasada: 1` y el servidor la descartaba (`ON CONFLICT
 * DO NOTHING`) por chocar con la `pasada: 1` de una visita anterior real — evidencia perdida en
 * silencio. Con este Map, una siembra fallida NO cuenta como hidratada: `tareaHeadlessUbicacion`
 * consulta `estaSemillaHidratada` antes de procesar cumplimientos (ver su uso más abajo) y, si
 * todavía no hidrató, procesa el fix SOLO para `gps_point` (la captura GPS no depende de esto),
 * sin tocar la máquina de estados de cumplimiento.
 */
const semillasHidratadasPorSesion = new Map<string, boolean>();

/** Ver `semillasHidratadasPorSesion`: `true` solo si la siembra de esta sesión hidrató con
 * éxito alguna vez en este contexto JS. */
export function estaSemillaHidratada(sesionId: string): boolean {
  return semillasHidratadasPorSesion.get(sesionId) === true;
}

async function asegurarSemillaCumplimientos(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
): Promise<void> {
  // FIX POST-REVISIÓN (punto 5): si ya hidrató alguna vez, no hay nada que reintentar — evita
  // releer el outbox en cada tick de una sesión que ya sembró bien.
  if (semillasHidratadasPorSesion.get(sesionId) === true) return;

  let semilla = semillasCumplimientosPorSesion.get(sesionId);
  if (!semilla) {
    semilla = (async () => {
      try {
        const eventos = await obtenerEventosPorTipo(db, 'cumplimiento_punto_control', sesionId);
        const base = clavesCumplimientoDesdePayloads(eventos);
        // FIX POST-REVISIÓN (bug 5): superpone las visitas PENDIENTES persistidas — ver el
        // docblock de `combinarConVisitasPendientes` (`location-task.ts`) para el porqué. Sin
        // esto, una visita en curso al momento del kill/reciclado volvía como si nunca hubiera
        // pasado (o, peor, como "ya confirmada" si había una pasada previa de ese punto).
        const visitasPendientes = await obtenerVisitasPendientes(db, sesionId);
        const combinado = combinarConVisitasPendientes(base, visitasPendientes);
        for (const [clave, estado] of combinado) {
          puntosControlDetectadosHeadless.current.set(clave, estado);
        }
        // FIX POST-REVISIÓN (punto 5): recién ACÁ, tras terminar sin excepción, se marca
        // hidratada — es la señal que habilita procesar transiciones de cumplimiento.
        semillasHidratadasPorSesion.set(sesionId, true);
      } catch (error) {
        console.error('[QUIVO][headless] No se pudo sembrar cumplimientos desde el outbox', error);
        // QUI-365: este catch es best-effort a propósito (ver doc de la función) — sin captura
        // explícita, un fallo acá es invisible para siempre, nadie lee la consola del teléfono
        // de un conductor en ruta.
        Sentry.captureException(error, {
          tags: { contexto: 'headless-task', paso: 'sembrar-cumplimientos' },
        });
        // FIX POST-REVISIÓN (punto 5): NO se marca hidratada, y se saca del cache de promesas
        // para que el PRÓXIMO tick dispare un reintento nuevo en vez de quedar pegado para
        // siempre a esta promesa ya resuelta (fallida).
        semillasCumplimientosPorSesion.delete(sesionId);
      }
    })();
    semillasCumplimientosPorSesion.set(sesionId, semilla);
  }
  await semilla;
}

/**
 * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): aplica las confirmaciones
 * forzadas de `confirmarVisitasVencidas` (`geofence.ts`, heartbeat o cierre de recorrido) —
 * encola cada `cumplimiento_punto_control` con el candidato ya guardado (mismo camino
 * transaccional que el confirm normal, `encolarEventoYLimpiarVisita`) y aplica su transición al
 * Map de estados. Exportada para que `use-gps-operativo.ts` (foreground) pueda reusarla sin
 * duplicar el armado del payload — es la MISMA forma de payload que construye
 * `construirEventosDeUbicacion` para el confirm normal (`location-task.ts`), solo que acá no
 * hay una `location` de la que leer `sesionId`/`deviceId`, así que se reciben aparte.
 *
 * FIX POST-REVISIÓN (hallazgo 7, code review — "sin chequeo de generación, una operación vencida
 * puede duplicar evidencia"): antes, este loop no revisaba la generación de la cola en NINGÚN
 * punto — el único chequeo vivía en el CALLER (`confirmarVisitasVencidasEnCola`), una sola vez,
 * DESPUÉS de que la función entera terminara. Si esta operación vencía su timeout a mitad del
 * `for` (varias visitas vencidas en el mismo heartbeat) y la cola avanzaba mientras tanto, el
 * resto de las iteraciones seguía escribiendo `cumplimiento_punto_control` — potencialmente para
 * la MISMA visita que una operación más nueva, en la generación siguiente, ya estaba confirmando
 * por su cuenta — dos `encolarEventoYLimpiarVisita` para la misma pasada (mitigado por el
 * `eventId` determinístico, pero no evitado: el segundo intento igual corre contra
 * `visitas_pendientes` ya mutado por el primero). `miGeneracion` se recibe del caller (capturada
 * ahí ANTES de este loop) y se revisa después de CADA `await`, igual criterio que
 * `registrarPuntoGpsInterno`.
 */
export async function aplicarConfirmacionesForzadas(
  db: SQLite.SQLiteDatabase,
  deviceId: string,
  sesionId: string,
  emitir: CumplimientoAEmitir[],
  transiciones: ReadonlyMap<string, EstadoPuntoControl>,
  estados: Map<string, EstadoPuntoControl>,
  miGeneracion: number = generacionColaRegistroGps,
): Promise<void> {
  for (const c of emitir) {
    if (!generacionVigente(miGeneracion)) return;
    await encolarEventoYLimpiarVisita(
      db,
      {
        deviceId,
        tipo: 'cumplimiento_punto_control',
        // FIX POST-REVISIÓN ("eventId estable"): la MISMA tripleta {sesionId, puntoControlId,
        // pasada} que derivaría `construirEventosDeUbicacion` (`location-task.ts`) para un fix
        // real — así, si un fix y este confirm forzado (heartbeat/cierre) terminaran
        // confirmando la MISMA pasada, emiten el MISMO `eventId` en vez de dos distintos. Ver
        // `EventoUbicacionConstruido.eventId`.
        eventId: derivarEventIdDeterministico([sesionId, c.deteccion.puntoControlId, String(c.pasada)]),
        payload: {
          sesionId,
          puntoControlId: c.deteccion.puntoControlId,
          lat: c.candidatoLat,
          lng: c.candidatoLng,
          distanciaM: c.deteccion.distanciaM,
          distanciaEntradaM: c.distanciaEntradaM,
          distanciaMinAproximacionM: c.distanciaMinAproximacionM,
          validadoPor: 'app',
          tsFix: c.candidatoTsFixMs !== undefined ? new Date(c.candidatoTsFixMs).toISOString() : undefined,
          pasada: c.pasada,
        },
      },
      c.clave,
    );
    // FIX POST-REVISIÓN (hallazgo 7): re-chequear INMEDIATAMENTE después del `await` de arriba,
    // ANTES de tocar `estados` — una operación vencida que despierta tarde no debe pisar el
    // estado que la operación nueva ya construyó.
    if (!generacionVigente(miGeneracion)) return;
    const estado = transiciones.get(c.clave);
    if (estado) estados.set(c.clave, estado);
  }
}

/**
 * R1 (hallazgo de revisión SERIO, "evidencia duplicada por concurrencia"): variante de
 * `confirmarVisitasVencidas` + `aplicarConfirmacionesForzadas` que corre las DOS DENTRO de
 * `ejecutarEnColaRegistroGps` — la MISMA cola que serializa los fixes reales
 * (`registrarPuntoGps`). Reemplaza las llamadas directas que hacían `manejarHeartbeatHeadless`
 * (abajo), `onHeartbeat` y `detener` (`use-gps-operativo.ts`, foreground) a esas dos funciones
 * por FUERA de la cola: un fix y un heartbeat concurrentes podían leer la MISMA visita pendiente
 * (`estadosPuntosControl.current`) antes de que ninguno terminara de escribir, y los dos emitir
 * un `cumplimiento_punto_control` con `eventId` DISTINTOS para la MISMA pasada — el servidor
 * dedupea solo por `eventId` (QUI-241), así que el paso se contaba DOS VECES.
 *
 * `estadosPuntosControl` se recibe como CONTENEDOR (`{ current }`), no como Map por valor — igual
 * criterio que B6 en `registrarPuntoGps`: `.current` se lee DENTRO de la operación encolada,
 * cuando le toca su turno, nunca en el caller (que pudo quedar con una referencia previa a una
 * re-siembra).
 *
 * `filtrarSesionActual` distingue los dos callers reales: `true` para el heartbeat HEADLESS
 * (`puntosControlDetectadosHeadless` es un singleton de módulo que nunca se limpia entre
 * sesiones — ver `filtrarPorSesion`/bug 2 en `geofence.ts`); `false` para el heartbeat y el
 * cierre de recorrido FOREGROUND (`puntosControlDetectados` de `use-gps-operativo.ts`, que
 * `sembrarCumplimientos` reemplaza entero en cada cambio de `sesionId` — filtrar ahí no hace
 * nada, pero tampoco hace falta).
 *
 * Devuelve los cumplimientos emitidos (`CumplimientoAEmitir[]`, EVIDENCIA — el caller NUNCA debe
 * anunciarlos, ver el rediseño de 2026-09-23) y `anunciosLlegada` (`AnuncioDecidido[]`, el
 * ÚNICO dato que el caller puede pasar a `anunciarLlegadaPuntoControl`).
 *
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23, punto 2 del brief — "evaluarAnunciosProximidadVencidos solo se llama desde
 * tests"): esta es la ÚNICA función que un heartbeat (headless o foreground) invoca, así que es
 * acá — no en un caller aparte — donde también corre `evaluarAnuncioDeHeartbeat`
 * (`features/operacion/decidir-anuncio.ts`), el fallback de TIEMPO para un vehículo detenido.
 * Corre TANTO para el heartbeat como para el cierre de recorrido (`detener()`,
 * `use-gps-operativo.ts`) — un cierre que confirma la última visita pendiente también merece su
 * "llegaste" si nunca sonó.
 */
export function confirmarVisitasVencidasEnCola(
  db: SQLite.SQLiteDatabase,
  deviceId: string,
  sesionId: string,
  estadosPuntosControl: ContenedorEstadosPuntosControl,
  ahoraMs: number,
  umbralMs: number,
  filtrarSesionActual: boolean,
  puntosControl: PuntoControlPaquete[],
  umbralAnuncioMs: number = UMBRAL_ANUNCIO_PROXIMIDAD_MS,
): Promise<{ emitir: CumplimientoAEmitir[]; anunciosLlegada: AnuncioDecidido[] }> {
  return ejecutarEnColaRegistroGps(
    db,
    async () => {
      const miGeneracion = generacionColaRegistroGps;
      const estados = estadosPuntosControl.current;
      const estadosAEvaluar = filtrarSesionActual ? filtrarPorSesion(estados, sesionId) : estados;
      const { emitir, transiciones } = confirmarVisitasVencidas(estadosAEvaluar, ahoraMs, umbralMs);
      if (emitir.length > 0) {
        await aplicarConfirmacionesForzadas(db, deviceId, sesionId, emitir, transiciones, estados, miGeneracion);
        if (!generacionVigente(miGeneracion)) return { emitir, anunciosLlegada: [] };
      }

      // REDISEÑO: fallback de TIEMPO del anuncio — independiente de la evidencia de arriba
      // (`emitir`/`transiciones`), evaluado sobre el estado YA actualizado. Nunca lee `emitir`.
      const { anuncios: anunciosLlegada, transiciones: transicionesAnuncio } = evaluarAnuncioDeHeartbeat(
        filtrarSesionActual ? filtrarPorSesion(estados, sesionId) : estados,
        ahoraMs,
        umbralAnuncioMs,
      );
      for (const [clave, estadoAnuncio] of transicionesAnuncio) {
        if (!generacionVigente(miGeneracion)) break;
        const actual = estados.get(clave);
        if (!actual) continue;
        estados.set(clave, {
          ...actual,
          anuncioHecho: estadoAnuncio.anuncioHecho,
          anuncioDesdeMs: estadoAnuncio.anuncioDesdeMs,
        });
      }
      return { emitir, anunciosLlegada };
    },
    sesionId,
    puntosControl,
  );
}

/**
 * Igual que `obtenerAccessToken` (`use-auth-movil.ts`), pero sin React ni contexto de
 * componente — el drenado oportunista corre tanto en el headless task (sin árbol) como en
 * foreground (`use-gps-operativo.ts`, que sí tiene el suyo vía `useAuthMovil`). Best-effort:
 * `null` si no hay sesión o el refresh falla.
 *
 * 🔴 Hallazgo 3 (code review, MEDIO — corrige la afirmación de abajo, que era FALSA): si
 * Android SÍ recicla el contexto (headless y foreground en instancias JS distintas, el caso
 * COMÚN — Android arranca un runtime nuevo por cada tick headless), el peor caso NO era "un
 * intento de más": era una RÁFAGA de 401 reales. Un tick headless en su propio contexto podía
 * rotar el refresh token de T0 a T1 y persistirlo en SecureStore mientras el contexto de
 * foreground, recién arrancado, seguía con T0 en memoria — ese T0 ya canjeado server-side
 * dispara un 401 de verdad, y `refrescarConReintentos` (`use-auth-movil.ts`) reintentaba 4
 * veces MÁS con el mismo T0 sin releer disco, acumulando los 5 fallos que abren el circuit
 * breaker. Con el circuito abierto, `obtenerAccessToken`/esta misma función quedaban
 * devolviendo `null` indefinidamente aunque SecureStore tuviera T1 válido — el patrón de
 * ráfaga de 401 visto en producción (Entrega 28 del plan). El fix real vive en `refrescar()`
 * (`ejecutarRefresh`, `use-auth-movil.ts`): ante un 401 real, releer SecureStore y reintentar
 * una vez con el token vigente si difiere del usado — cubre este camino headless automática-
 * mente, porque esta función pasa por esa misma `refrescar()`.
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
 * Procesa `location` (el camino principal) y, desde el FIX POST-REVISIÓN del bug 2, también
 * `heartbeat` (confirmación forzada de visitas vencidas — ver `manejarHeartbeatHeadless` abajo).
 * El resto (`terminate`, `motionchange`, etc.) no tiene, hoy, ninguna escritura asociada — se
 * ignora explícitamente en vez de fallar en silencio ante un `switch` sin `default`.
 *
 * Todo el cuerpo va bajo `try/catch`: el wrapper del SDK rechaza la promesa de la tarea ante
 * cualquier throw y NO reintenta, así que un fallo transitorio de SecureStore o SQLite
 * perdería ese fix en silencio, justo en el camino de app terminada que el criterio C del
 * spike existe para demostrar.
 */
export async function tareaHeadlessUbicacion(event: HeadlessEvent): Promise<void> {
  if (event.name === 'heartbeat') {
    await manejarHeartbeatHeadless();
    // Entrega 2 (drenado oportunista del outbox en background) — ver el comentario grande más
    // abajo, en el camino 'location', para el porqué completo (causa raíz del síntoma más
    // reportado del piloto) y por qué va con `await`.
    await intentarDrenarOportunista(obtenerAccessTokenHeadless);
    return;
  }
  if (event.name !== 'location') return;

  // Hallazgo 1 (CRÍTICO, code review de la Entrega 2 del drenado): el `return` de la rama
  // `!contexto` (y cualquier otro `return`/`throw` de este bloque) ya NO puede saltear el
  // drenado de más abajo — antes vivía DENTRO de este `try`, con un `return` que salía de TODA
  // la función, y el drenado (entonces al final del cuerpo) nunca se alcanzaba en ese camino.
  // Con el paquete del día vencido o la sesión en el margen de gracia
  // (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`) y la app terminada, CADA tick de ubicación salía por
  // ahí: un `fin_recorrido` pendiente encolado ANTES de que la sesión venciera nunca se drenaba
  // en background. Fix: el registro del punto vive en su propio bloque, sin ningún `return` que
  // pueda saltear el drenado — corre pase lo que pase con el primero (fix nuevo, contexto nulo,
  // o error de escritura).
  try {
    const contexto = await obtenerContextoUbicacionPersistido();
    if (contexto) {
      // El plugin tipa `HeadlessEvent.params` como `Map` genérico (`{[key: string]: ...}`) en
      // vez de exponer una unión discriminada por `event.name` — con `name === 'location'` el
      // shape real SÍ es `Location` (documentado en la wiki de Android Headless Mode), pero el
      // tipo del propio paquete no lo refleja. `as unknown as Location` documenta esa brecha en
      // vez de silenciarla con `any`/`@ts-ignore`.
      const location = event.params as unknown as Location;

      const db = await abrirOutbox();
      await asegurarSemillaCumplimientos(db, contexto.sesionId);
      // FIX POST-REVISIÓN (Codex `verify-fix`, punto 5): mientras la semilla de esta sesión no
      // haya hidratado (lectura fallida, se reintenta en el próximo tick — ver
      // `asegurarSemillaCumplimientos`), este fix se procesa SOLO para `gps_point` — la máquina
      // de estados de cumplimiento (`filtrarNuevosCumplimientos`) queda sin evaluar, para no
      // arrancar el contador de pasadas desde un Map vacío. `puntosControl: []` es lo que hace
      // que `construirEventosDeUbicacion` salte esa parte (ver su chequeo
      // `contexto.puntosControl.length > 0`) sin tocar la captura GPS, que no depende de esto.
      const contextoTick = estaSemillaHidratada(contexto.sesionId)
        ? contexto
        : { ...contexto, puntosControl: [] };
      const {
        deteccionAproximacion,
        puntosRearmadosVoz,
        anunciosLlegada,
      } = await registrarPuntoGps(db, location, contextoTick, puntosControlDetectadosHeadless);
      // ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): el punto GPS y el
      // cumplimiento YA quedaron persistidos arriba (la evidencia, RF-64..73) — el anuncio al
      // chofer es best-effort y NUNCA debe poder tumbar ese resultado ya escrito. Por eso corre
      // DESPUÉS del `await` de arriba (nunca antes) y con su propio `catch`: un fallo acá cae en
      // el `paso: 'anunciar-punto-control'` de Sentry, no en el `paso:
      // 'registrar-punto-gps'` del catch general de abajo, que hoy reporta pérdida de EVIDENCIA —
      // mezclar los dos haría parecer perdido un punto GPS que en realidad se guardó bien.
      // REDISEÑO: `anunciosLlegada` YA fue DECIDIDO dentro de `registrarPuntoGps` (la cola) — este
      // wrapper solo EJECUTA (voz de aproximación + notificación/vibración de llegada), nunca
      // vuelve a evaluar nada de evidencia (`deteccion` ya NO se pasa: la evidencia nunca dispara
      // este canal, ver el rediseño de 2026-09-23).
      await anunciarDeteccionesDelTick(
        db,
        { sesionId: contexto.sesionId, puntosControl: contexto.puntosControl },
        { deteccionAproximacion, anunciosLlegada, puntosRearmadosVoz },
      ).catch((error) => {
        console.error('[QUIVO][headless] No se pudo anunciar el punto de control', error);
        Sentry.captureException(error, {
          tags: { contexto: 'headless-task', paso: 'anunciar-punto-control' },
        });
      });
    }
    // `contexto === null`: sin turno vigente (sesión cerrada, logout solicitado o paquete del
    // día vencido) — el punto se descarta, decisión ya tomada dentro de
    // `obtenerContextoUbicacionPersistido` (ver su comentario). El drenado de abajo corre IGUAL
    // — ver el hallazgo 1 de arriba.
  } catch (error) {
    console.error('[QUIVO][headless] No se pudo registrar la ubicación en el outbox', error);
    // QUI-365: este es EL escenario que el ticket marca como el peor y el que menos se ve —
    // el `try/catch` de este bloque existe para que un fallo transitorio no tumbe la
    // promesa que el SDK nativo no reintenta (ver doc arriba), pero eso mismo lo vuelve
    // invisible sin captura explícita: no hay UI, no hay logs que alguien vaya a mirar en el
    // teléfono de un conductor en ruta. Sin este `captureException`, un punto GPS perdido acá
    // (evidencia legal, RF-67..73) no dejaría NINGÚN rastro reportado. Este catch NO envuelve
    // el drenado de abajo a propósito: que este tick falle en capturar no debe impedir el
    // intento de vaciar lo que YA estaba persistido de ticks anteriores.
    Sentry.captureException(error, {
      tags: { contexto: 'headless-task', paso: 'registrar-punto-gps', evento: event.name },
    });
  }

  // Entrega 2 (`docs/plan-correccion-post-piloto-2026-09-09.md`) — causa raíz del síntoma más
  // reportado del piloto ("tengo que cerrar la app para que se actualice la ubicación"):
  // `headless-task.ts` escribía al outbox pero nadie lo drenaba en background. Ningún `return`
  // de arriba puede saltear esta línea (hallazgo 1) — corre con o sin contexto, con o sin error
  // de escritura. Va con AWAIT porque el SDK de Transistorsoft da por terminada la tarea
  // headless en cuanto se ejecuta la ÚLTIMA LÍNEA de esta función: sin este `await`, la promesa
  // de `intentarDrenarOportunista` queda corriendo "de fondo" sobre un contexto que el SDK ya
  // considera cerrado, y el trabajo (mutex, POST, liberar el lease) se corta a mitad de camino
  // en cuanto el wake lock se libera.
  await intentarDrenarOportunista(obtenerAccessTokenHeadless);
}

/**
 * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): handler de `heartbeat` en
 * headless — el otro extremo del bug (junto con `onHeartbeat` en `use-gps-operativo.ts` para
 * foreground). Un vehículo DETENIDO dentro del radio de un punto de control no produce fixes
 * nuevos (`distanceFilter: 15` — sin desplazamiento no hay `onLocation`), así que la única
 * forma de cerrar esa visita es un evento que SÍ siga llegando con el vehículo quieto — el
 * `heartbeat` del SDK (`heartbeatInterval: 60`, `background-geolocation.config.ts`), que hasta
 * este fix se recibía y se ignoraba (ver el comentario de cabecera de `tareaHeadlessUbicacion`).
 *
 * Deliberadamente NO llama a `registrarPuntoGps`/no escribe ningún `gps_point`: el heartbeat no
 * trae un fix nuevo del que valga la pena dejar evidencia (`HeartbeatEvent.location` es "the
 * *last-known* location", no una lectura fresca) — solo evalúa si alguna visita en curso ya
 * lleva demasiado sin mejorar su mínimo (`confirmarVisitasVencidas`, `geofence.ts`) y, si es
 * así, la confirma con el candidato YA observado.
 *
 * FIX POST-REVISIÓN (R1, "evidencia duplicada por concurrencia"): la lectura de
 * `puntosControlDetectadosHeadless` + `confirmarVisitasVencidas` + `aplicarConfirmacionesForzadas`
 * corren ahora DENTRO de `confirmarVisitasVencidasEnCola` (la MISMA cola que
 * `registrarPuntoGps`) — antes corrían acá directo, por FUERA de la cola, así que un fix real
 * concurrente podía leer la MISMA visita pendiente antes de que este heartbeat terminara de
 * escribirla (o viceversa) y los dos terminaban emitiendo la MISMA pasada con `eventId`
 * distintos — el servidor dedupea solo por `eventId` (QUI-241), así que el paso se contaba dos
 * veces. `filtrarSesionActual: true` — ver el comentario de `confirmarVisitasVencidasEnCola`.
 */
async function manejarHeartbeatHeadless(): Promise<void> {
  try {
    const contexto = await obtenerContextoUbicacionPersistido();
    if (!contexto) return;

    const db = await abrirOutbox();
    await asegurarSemillaCumplimientos(db, contexto.sesionId);
    // REDISEÑO: `emitir` (confirmaciones de EVIDENCIA forzadas por antigüedad) YA NO se anuncia
    // — la evidencia nunca dispara ningún canal hacia el chofer (gap 1 y 2 del brief). Solo
    // `anunciosLlegada`, decidido por `evaluarAnuncioDeHeartbeat` DENTRO de
    // `confirmarVisitasVencidasEnCola` (punto 2 del brief: el fallback de 90 s ahora SÍ corre en
    // producción, desde este mismo punto de llamada).
    const { anunciosLlegada } = await confirmarVisitasVencidasEnCola(
      db,
      contexto.deviceId,
      contexto.sesionId,
      puntosControlDetectadosHeadless,
      Date.now(),
      UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
      true,
      contexto.puntosControl,
    );
    if (anunciosLlegada.length === 0) return;

    for (const anuncio of anunciosLlegada) {
      await anunciarLlegadaPuntoControl(
        db,
        anuncio.puntoControlId,
        anuncio.pasada,
        anuncio.motivo,
        { sesionId: contexto.sesionId, puntosControl: contexto.puntosControl },
      ).catch((error) => {
        console.error('[QUIVO][headless] No se pudo anunciar la llegada por heartbeat', error);
        Sentry.captureException(error, {
          tags: { contexto: 'headless-task', paso: 'anunciar-llegada-heartbeat' },
        });
      });
    }
  } catch (error) {
    console.error('[QUIVO][headless] No se pudo procesar el heartbeat', error);
    Sentry.captureException(error, {
      tags: { contexto: 'headless-task', paso: 'procesar-heartbeat' },
    });
  }
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
