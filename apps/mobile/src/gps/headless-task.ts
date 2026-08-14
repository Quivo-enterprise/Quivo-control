import type * as SQLite from 'expo-sqlite';
import BackgroundGeolocation, {
  type HeadlessEvent,
  type Location,
} from 'react-native-background-geolocation';
import type { DeteccionPuntoControl } from './geofence';
import {
  clavesCumplimientoDesdePayloads,
  construirEventosDeUbicacion,
  type ContextoUbicacion,
} from './location-task';
import { abrirOutbox, encolarEvento, obtenerPayloadsPorTipo } from '../db/outbox';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal } from '../db/paquete-dia';
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
 * Punto único de escritura al outbox para un evento de ubicación (QUI-216): usa la lógica
 * pura de `location-task.ts` y persiste lo que devuelve con `encolarEvento` (RF-67..73 — el
 * evento nace en SQLite antes de cualquier intento de red). Lo llaman:
 * - `useGpsOperativo` (`use-gps-operativo.ts`), con el contexto que ya tiene en React y su
 *   propio `useRef<Set>` de detecciones (vive mientras dure el `iniciar()` en curso).
 * - `tareaHeadlessUbicacion`, de abajo, con el contexto leído de disco y el Set de
 *   detecciones a nivel de módulo de este archivo.
 */
export async function registrarPuntoGps(
  db: SQLite.SQLiteDatabase,
  location: Location,
  contexto: ContextoUbicacion,
  puntosControlDetectados: Set<string>,
): Promise<{ deteccion: DeteccionPuntoControl | null }> {
  const { eventos, deteccion } = construirEventosDeUbicacion(
    location,
    contexto,
    puntosControlDetectados,
  );
  for (const evento of eventos) {
    await encolarEvento(db, {
      deviceId: contexto.deviceId,
      tipo: evento.tipo,
      payload: evento.payload,
    });
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
 * - **Paquete del día vencido.** `startOnBoot: true` + `stopOnTerminate: false` hacen que el
 *   tracking sobreviva a todo salvo un `stop()` explícito, y `detener()` es el único que lo
 *   llama: un chofer que termina el turno matando la app dejaba el plugin `enabled`
 *   escribiendo `gps_point` contra un `sesionId` vencido toda la noche, y reanudándose tras
 *   cada reboot. `venceAt` del paquete es el fin real del turno operativo — pero acá el
 *   `stop()` espera el margen de gracia (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`) antes de
 *   dispararse, porque este chequeo corre en el camino de arranque tras reboot, donde
 *   `Date.now()` es menos confiable.
 *
 * Que NO corta: un paquete ausente o ilegible con sesión vigente. Ahí se sigue registrando
 * `gps_point` sin puntos de control (comportamiento anterior) — un fallo de descarga del
 * paquete no debe costar la evidencia GPS de la jornada, que es lo que sustenta la sanción.
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
  const paqueteLocal = await obtenerPaqueteDiaLocal(dbPaquete);
  if (paqueteLocal?.vencido === true) {
    // El punto se descarta ya (no hay turno vigente al que atribuirlo) — el `stop()`
    // irreversible se demora hasta que pase el margen de gracia, ver
    // `GRACIA_STOP_TRAS_VENCIMIENTO_MS`. Si `venceAt` no se puede parsear (no debería pasar:
    // `PaqueteDiaSchema` ya lo valida como `datetime()`) se prefiere NO apagar el plugin en
    // vez de arriesgar un `stop()` sobre un dato en el que no se puede confiar.
    const venceAtMs = Date.parse(paqueteLocal.paquete.asignacion.venceAt);
    const graciaVencida =
      !Number.isNaN(venceAtMs) && Date.now() - venceAtMs >= GRACIA_STOP_TRAS_VENCIMIENTO_MS;
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
 * Set de cumplimientos ya emitidos durante el tracking headless — a nivel de módulo (no de
 * React, no existe árbol de componentes acá) para no reencolar el mismo cumplimiento en cada
 * tick. Las claves son `${sesionId}:${puntoControlId}` (`claveCumplimiento`, `geofence.ts`),
 * NO el `puntoControlId` solo: este Set vive todo el contexto JS headless y nadie lo resetea
 * al cambiar de sesión (a diferencia del `useRef` del hook, que `iniciar()` limpia), así que
 * indexarlo solo por punto de control hacía que la ruta B — o el turno del día siguiente
 * sobre la misma ruta recurrente — nunca emitiera su `cumplimiento_punto_control`.
 *
 * El caso inverso (contexto JS reciclado a mitad de turno → Set vacío → cumplimiento
 * reemitido con un `eventId` nuevo → segunda fila en `cumplimientos_pc`, que el worker
 * deduplica solo por `eventId`) lo cubre `asegurarSemillaCumplimientos`, sembrando el Set
 * desde el outbox en el primer tick.
 */
const puntosControlDetectadosHeadless = new Set<string>();

/** Memo de la siembra: una sola lectura del outbox por contexto JS headless, y ticks
 * concurrentes esperan la misma promesa en vez de sembrar dos veces. Nunca rechaza — la
 * semilla es best-effort y un fallo no debe costar el punto GPS de este tick. */
let semillaCumplimientos: Promise<void> | null = null;

async function asegurarSemillaCumplimientos(db: SQLite.SQLiteDatabase): Promise<void> {
  semillaCumplimientos ??= (async () => {
    try {
      const payloads = await obtenerPayloadsPorTipo(db, 'cumplimiento_punto_control');
      for (const clave of clavesCumplimientoDesdePayloads(payloads)) {
        puntosControlDetectadosHeadless.add(clave);
      }
    } catch (error) {
      console.error('[QUIVO][headless] No se pudo sembrar cumplimientos desde el outbox', error);
    }
  })();
  await semillaCumplimientos;
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
 * Solo procesa el evento `location`; el resto (`terminate`, `heartbeat`, `motionchange`,
 * etc.) no tiene, hoy, ninguna escritura asociada — se ignoran explícitamente en vez de
 * fallar en silencio ante un `switch` sin `default`.
 *
 * Todo el cuerpo va bajo `try/catch`: el wrapper del SDK rechaza la promesa de la tarea ante
 * cualquier throw y NO reintenta, así que un fallo transitorio de SecureStore o SQLite
 * perdería ese fix en silencio, justo en el camino de app terminada que el criterio C del
 * spike existe para demostrar.
 */
export async function tareaHeadlessUbicacion(event: HeadlessEvent): Promise<void> {
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
    await asegurarSemillaCumplimientos(db);
    await registrarPuntoGps(db, location, contexto, puntosControlDetectadosHeadless);
  } catch (error) {
    console.error('[QUIVO][headless] No se pudo registrar la ubicación en el outbox', error);
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
  }
}
