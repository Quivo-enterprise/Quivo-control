import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import BackgroundGeolocation, {
  type HeadlessEvent,
  type Location,
} from 'react-native-background-geolocation';
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
import { cargarSesionMovil, obtenerDeviceIdMovil } from '../shared/security/sesion-movil-store';
import {
  anunciarDeteccionesDelTick,
  anunciarPuntoControl,
} from '../features/operacion/anuncio-punto-control';

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
): Promise<{
  deteccion: DeteccionPuntoControl | null;
  deteccionAproximacion: DeteccionPuntoControl | null;
  puntosRearmados: string[];
}> {
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
): Promise<{
  deteccion: DeteccionPuntoControl | null;
  deteccionAproximacion: DeteccionPuntoControl | null;
  puntosRearmados: string[];
}> {
  // B6: `.current` se lee ACÁ, ya con el turno de la cola concedido — nunca en el caller, que
  // pudo haber quedado con una referencia previa a una re-siembra (ver
  // `ContenedorEstadosPuntosControl`).
  const estados = estadosPuntosControl.current;
  const { eventos, deteccion, deteccionAproximacion, transicionesEstado, avisosPrecision, puntosRearmados } =
    construirEventosDeUbicacion(location, contexto, estados);
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
    if (evento.clave !== undefined) {
      // FIX POST-REVISIÓN (bug 5): confirmación — encolar el evento y borrar la fila de
      // `visitas_pendientes` de esta visita en LA MISMA transacción (ver
      // `encolarEventoYLimpiarVisita`, `db/outbox.ts`).
      await encolarEventoYLimpiarVisita(
        db,
        { deviceId: contexto.deviceId, tipo: evento.tipo, payload: evento.payload },
        evento.clave,
      );
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
      // `gps_point` (siempre el primer evento, sin `clave` propia): ancla para aplicar las
      // transiciones de RE-ARMADO, que no tienen ningún evento propio al que atarse.
      for (const [clave, estado] of transicionesEstado) {
        if (!clavesConEventoPropio.has(clave)) estados.set(clave, estado);
      }
    }
  }

  // FIX POST-REVISIÓN (bug 5): housekeeping de `visitas_pendientes` — para CADA clave que este
  // tick tocó (no solo las confirmadas, que ya se limpiaron arriba en la misma transacción):
  // si sigue siendo una visita en curso sin confirmar, guarda/actualiza su candidato; si no
  // (re-armada, o B5 reentrada-ya-confirmada), borra cualquier fila vieja que pudiera quedar.
  // Best-effort a propósito (try/catch propio, no aborta el tick): la evidencia YA se persistió
  // arriba — esto es solo la copia durable del candidato para sobrevivir un kill de la app a
  // mitad de visita (bug 5), no la evidencia legal en sí.
  try {
    for (const [clave, estado] of transicionesEstado) {
      if (
        estado.dentro &&
        estado.confirmado === false &&
        estado.candidatoLat !== undefined &&
        estado.candidatoLng !== undefined &&
        estado.candidatoTsFixMs !== undefined &&
        estado.minDistanciaM !== undefined &&
        estado.puntoControlId !== undefined &&
        estado.radioToleranciaM !== undefined
      ) {
        await guardarVisitaPendiente(db, {
          clave,
          sesionId: contexto.sesionId,
          puntoControlId: estado.puntoControlId,
          pasadasPrevias: estado.pasadas,
          radioToleranciaM: estado.radioToleranciaM,
          minDistanciaM: estado.minDistanciaM,
          distanciaEntradaM: estado.distanciaEntradaM ?? estado.minDistanciaM,
          candidatoLat: estado.candidatoLat,
          candidatoLng: estado.candidatoLng,
          candidatoTsFixMs: estado.candidatoTsFixMs,
          ultimoEmitidoMs: estado.ultimoEmitidoMs,
          fixesDentroSinConfirmar: estado.fixesDentroSinConfirmar ?? 0,
        });
      } else if (!clavesConEventoPropio.has(clave)) {
        // Las que SÍ tuvieron evento propio ya se borraron transaccionalmente arriba — acá solo
        // cubre el caso defensivo de una fila vieja de una visita que se re-armó sin confirmar.
        await eliminarVisitaPendiente(db, clave);
      }
    }
  } catch (error) {
    console.error('[QUIVO][gps] No se pudo actualizar visitas_pendientes', error);
    Sentry.captureException(error, {
      tags: { contexto: 'gps-cola', paso: 'housekeeping-visitas-pendientes' },
      extra: { sesionId: contexto.sesionId },
    });
  }

  return { deteccion, deteccionAproximacion, puntosRearmados };
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
 * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): aplica las confirmaciones
 * forzadas de `confirmarVisitasVencidas` (`geofence.ts`, heartbeat o cierre de recorrido) —
 * encola cada `cumplimiento_punto_control` con el candidato ya guardado (mismo camino
 * transaccional que el confirm normal, `encolarEventoYLimpiarVisita`) y aplica su transición al
 * Map de estados. Exportada para que `use-gps-operativo.ts` (foreground) pueda reusarla sin
 * duplicar el armado del payload — es la MISMA forma de payload que construye
 * `construirEventosDeUbicacion` para el confirm normal (`location-task.ts`), solo que acá no
 * hay una `location` de la que leer `sesionId`/`deviceId`, así que se reciben aparte.
 */
export async function aplicarConfirmacionesForzadas(
  db: SQLite.SQLiteDatabase,
  deviceId: string,
  sesionId: string,
  emitir: CumplimientoAEmitir[],
  transiciones: ReadonlyMap<string, EstadoPuntoControl>,
  estados: Map<string, EstadoPuntoControl>,
): Promise<void> {
  for (const c of emitir) {
    await encolarEventoYLimpiarVisita(
      db,
      {
        deviceId,
        tipo: 'cumplimiento_punto_control',
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
    const estado = transiciones.get(c.clave);
    if (estado) estados.set(c.clave, estado);
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
    return;
  }
  if (event.name !== 'location') return;

  try {
    const contexto = await obtenerContextoUbicacionPersistido();
    if (!contexto) {
      // No hay turno vigente (sesión cerrada o paquete del día vencido): el punto se
      // descarta. La decisión de cortar o no el tracking nativo (inmediata en un caso, con
      // margen de gracia en el otro) ya se tomó dentro de `obtenerContextoUbicacionPersistido`
      // — ver su comentario para el porqué de cada camino.
      return;
    }

    // El plugin tipa `HeadlessEvent.params` como `Map` genérico (`{[key: string]: ...}`) en
    // vez de exponer una unión discriminada por `event.name` — con `name === 'location'` el
    // shape real SÍ es `Location` (documentado en la wiki de Android Headless Mode), pero el
    // tipo del propio paquete no lo refleja. `as unknown as Location` documenta esa brecha en
    // vez de silenciarla con `any`/`@ts-ignore`.
    const location = event.params as unknown as Location;

    const db = await abrirOutbox();
    await asegurarSemillaCumplimientos(db, contexto.sesionId);
    const { deteccion, deteccionAproximacion, puntosRearmados } = await registrarPuntoGps(
      db,
      location,
      contexto,
      puntosControlDetectadosHeadless,
    );
    // ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): el punto GPS y el
    // cumplimiento YA quedaron persistidos arriba (la evidencia, RF-64..73) — el anuncio al
    // chofer es best-effort y NUNCA debe poder tumbar ese resultado ya escrito. Por eso corre
    // DESPUÉS del `await` de arriba (nunca antes) y con su propio `catch`: un fallo acá cae en
    // el `paso: 'anunciar-punto-control'` de Sentry, no en el `paso:
    // 'registrar-punto-gps'` del catch general de abajo, que hoy reporta pérdida de EVIDENCIA —
    // mezclar los dos haría parecer perdido un punto GPS que en realidad se guardó bien.
    await anunciarDeteccionesDelTick(
      db,
      { sesionId: contexto.sesionId, puntosControl: contexto.puntosControl },
      { deteccion, deteccionAproximacion, puntosRearmados },
    ).catch((error) => {
      console.error('[QUIVO][headless] No se pudo anunciar el punto de control', error);
      Sentry.captureException(error, {
        tags: { contexto: 'headless-task', paso: 'anunciar-punto-control' },
      });
    });
  } catch (error) {
    console.error('[QUIVO][headless] No se pudo registrar la ubicación en el outbox', error);
    // QUI-365: este es EL escenario que el ticket marca como el peor y el que menos se ve —
    // el `try/catch` de toda la función existe para que un fallo transitorio no tumbe la
    // promesa que el SDK nativo no reintenta (ver doc arriba), pero eso mismo lo vuelve
    // invisible sin captura explícita: no hay UI, no hay logs que alguien vaya a mirar en el
    // teléfono de un conductor en ruta. Sin este `captureException`, un punto GPS perdido acá
    // (evidencia legal, RF-67..73) no dejaría NINGÚN rastro reportado.
    Sentry.captureException(error, {
      tags: { contexto: 'headless-task', paso: 'registrar-punto-gps', evento: event.name },
    });
  }
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
 */
async function manejarHeartbeatHeadless(): Promise<void> {
  try {
    const contexto = await obtenerContextoUbicacionPersistido();
    if (!contexto) return;

    const db = await abrirOutbox();
    await asegurarSemillaCumplimientos(db, contexto.sesionId);
    const estados = puntosControlDetectadosHeadless.current;
    // FIX POST-REVISIÓN (bug 2, hallazgo propio de `filtrarPorSesion` — ver su docblock en
    // `geofence.ts`): `puntosControlDetectadosHeadless` es un singleton de MÓDULO que
    // `asegurarSemillaCumplimientos` solo AGREGA entradas, nunca limpia entre sesiones — a
    // diferencia de `puntosControlDetectados` en `use-gps-operativo.ts` (foreground), que
    // `sembrarCumplimientos` REEMPLAZA entero en cada cambio de `sesionId`. Sin este filtro, una
    // visita sin confirmar de un turno ANTERIOR en el MISMO dispositivo/vehículo (cambio de
    // chofer sin reinicio de proceso) se confirmaría igual, atribuida por error a la sesión
    // ACTUAL (`aplicarConfirmacionesForzadas` usa un único `sesionId` para todo lo que emite).
    const estadosSesion = filtrarPorSesion(estados, contexto.sesionId);
    const { emitir, transiciones } = confirmarVisitasVencidas(
      estadosSesion,
      Date.now(),
      UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
    );
    if (emitir.length === 0) return;

    await aplicarConfirmacionesForzadas(db, contexto.deviceId, contexto.sesionId, emitir, transiciones, estados);

    for (const c of emitir) {
      await anunciarPuntoControl(
        db,
        c.deteccion,
        { sesionId: contexto.sesionId, puntosControl: contexto.puntosControl },
      ).catch((error) => {
        console.error('[QUIVO][headless] No se pudo anunciar la confirmación por heartbeat', error);
        Sentry.captureException(error, {
          tags: { contexto: 'headless-task', paso: 'anunciar-confirmacion-heartbeat' },
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
