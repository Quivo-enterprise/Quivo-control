import type * as SQLite from 'expo-sqlite';
import type { HeadlessEvent, Location } from 'react-native-background-geolocation';
import type { DeteccionPuntoControl } from './geofence';
import { construirEventosDeUbicacion, type ContextoUbicacion } from './location-task';
import { abrirOutbox, encolarEvento } from '../db/outbox';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal } from '../db/paquete-dia';
import { cargarSesionMovil, obtenerDeviceIdMovil } from '../shared/security/sesion-movil-store';

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
 * Devuelve `null` si no hay sesión guardada. El SDK nativo de Transistorsoft no depende de
 * React ni de la sesión de la app — si el chofer cerró sesión pero el tracking nativo sigue
 * corriendo (hoy no hay un `BackgroundGeolocation.stop()` explícito en el logout, fuera del
 * alcance de este fix), no hay `sesionId` al que atribuir el punto y se descarta en vez de
 * escribir evidencia huérfana.
 */
export async function obtenerContextoUbicacionPersistido(): Promise<ContextoUbicacion | null> {
  const deviceId = await obtenerDeviceIdMovil();
  const sesion = await cargarSesionMovil();
  if (!sesion) return null;

  const dbPaquete = await abrirPaqueteDiaDb();
  const paqueteLocal = await obtenerPaqueteDiaLocal(dbPaquete);

  return {
    deviceId,
    sesionId: sesion.contexto.sesionId,
    puntosControl: paqueteLocal?.paquete.puntosControl ?? [],
  };
}

/**
 * Set de puntos de control ya detectados durante el tracking headless — a nivel de módulo
 * (no de React, no existe árbol de componentes acá) para no reencolar el mismo cumplimiento
 * en cada tick. Vive mientras dure el proceso headless: si el proceso JS headless se reinicia
 * (p. ej. Android lo recicla tras inactividad), arranca vacío — igual que el `useRef` del
 * hook arranca vacío en cada `iniciar()`. No es una regresión: el servidor (worker QUI-241)
 * es la fuente de verdad del cumplimiento vía `ST_DWithin` server-side, no el cliente — una
 * detección repetida tras un reinicio agrega un evento no crítico, no compromete evidencia.
 */
const puntosControlDetectadosHeadless = new Set<string>();

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
 */
export async function tareaHeadlessUbicacion(event: HeadlessEvent): Promise<void> {
  if (event.name !== 'location') return;

  const contexto = await obtenerContextoUbicacionPersistido();
  if (!contexto) return;

  // El plugin tipa `HeadlessEvent.params` como `Map` genérico (`{[key: string]: ...}`) en
  // vez de exponer una unión discriminada por `event.name` — con `name === 'location'` el
  // shape real SÍ es `Location` (documentado en la wiki de Android Headless Mode), pero el
  // tipo del propio paquete no lo refleja. `as unknown as Location` documenta esa brecha en
  // vez de silenciarla con `any`/`@ts-ignore`.
  const location = event.params as unknown as Location;

  const db = await abrirOutbox();
  await registrarPuntoGps(db, location, contexto, puntosControlDetectadosHeadless);
}
