/**
 * Rescope SESION_NO_VIGENTE en foreground (decisión del CTO, code review de
 * `fix/sesion-no-vigente`): módulo MÍNIMO, sin React ni dependencias del SDK nativo
 * (`react-native-background-geolocation` no se importa acá), que espeja si HAY un recorrido de
 * GPS activo ahora mismo — el `tracking` de `useGpsOperativo` (`use-gps-operativo.ts`).
 *
 * Por qué existe: `useAuthMovil` (`features/auth/use-auth-movil.ts`) necesita esta lectura para
 * decidir, ante `SESION_NO_VIGENTE`, si puede borrar la sesión de inmediato (sin recorrido) o
 * si debe esperar a que el chofer toque "Finalizar" (con recorrido activo) — ver
 * `cerrarSesionPorNoVigente`. Pero `GpsProvider` (que monta `useGpsOperativo`) vive DEBAJO de
 * la etapa de auth en el árbol (`App.tsx` solo renderiza `OperationNavigator`/`GpsProvider`
 * cuando `auth.estado.etapa === 'operacion'`) — no hay Context de React que fluya de un hijo
 * hacia un hook que vive más arriba sin invertir la dependencia. Un módulo compartido, ínfimo y
 * sin importar nada pesado es la wiring MENOS invasiva: `useGpsOperativo` lo actualiza en un
 * `useEffect` sobre `tracking`; `use-auth-movil.ts` solo lo LEE (síncrono) o se suscribe a sus
 * cambios cuando necesita esperar la PRIMERA lectura real (ver `suscribirseARecorridoActivo`,
 * usado en `restaurarSesion` para el caso "flag headless + app recién reabierta", donde el
 * re-enganche nativo de `useGpsOperativo` tarda unos `await`s en resolver — leer el booleano
 * crudo en ese instante daría casi siempre `false` aunque el recorrido siga activo).
 */

type Listener = (activo: boolean) => void;

let recorridoActivo = false;
/** `true` desde la primera vez que `useGpsOperativo` publicó una lectura real (re-enganche o
 * `iniciar()`/`detener()`) en ESTE proceso — antes de eso, `recorridoActivo === false` es solo
 * el valor inicial, no evidencia de que no haya recorrido. */
let huboLectura = false;
const listeners = new Set<Listener>();

export function marcarRecorridoActivoGlobal(activo: boolean): void {
  recorridoActivo = activo;
  huboLectura = true;
  for (const listener of listeners) listener(activo);
}

export function hayRecorridoActivoGlobal(): boolean {
  return recorridoActivo;
}

export function huboLecturaDeRecorridoActivo(): boolean {
  return huboLectura;
}

/** Se suscribe a la PRÓXIMA (y siguientes) publicación de `marcarRecorridoActivoGlobal`.
 * Devuelve la función de desuscripción. Ver el docblock del módulo para el caso de uso real
 * (`restaurarSesion` esperando el primer veredicto de re-enganche tras un flag headless). */
export function suscribirseARecorridoActivo(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** SOLO para tests: limpia el estado del módulo entre casos — sin esto, un test que deja
 * `recorridoActivo`/`huboLectura` en `true` contamina el siguiente. Sin caller en producción. */
export function reiniciarEstadoRecorridoActivoParaTests(): void {
  recorridoActivo = false;
  huboLectura = false;
  listeners.clear();
}
