import { useSyncExternalStore } from 'react';
import { estaObsoleto } from './geo';
import { aplicarFix, type EstadoVisualMovimiento } from './reducer';
import type { FixVisual } from './tipos';

/**
 * Store visual — emisor mínimo, sin dependencias de React Native, singleton a nivel de módulo
 * (mismo patrón que `estado-recorrido-activo.ts`: un solo recorrido activo por proceso, así que
 * no hace falta más que un módulo con estado propio). Lo alimenta `useGpsOperativo` con CADA fix
 * (de evidencia o del canal visual — a este módulo le da igual el origen, ver
 * `use-gps-operativo.ts`) y lo consume SOLO `mapa/route-map.tsx` vía `useEstadoVisual()`: a
 * diferencia de `posicionActual` (el `useState` de `useGpsOperativo`), alimentar este store
 * nunca dispara un re-render de `operation-screen.tsx` — el único componente que re-renderiza es
 * el que llama al hook.
 */

/** Snapshot público — subconjunto de `EstadoVisualMovimiento` sin el estado interno de
 * histéresis de rumbo (`estadoRumbo`), que es un detalle de implementación del reducer. */
export interface EstadoVisual {
  lat: number;
  lng: number;
  rumbo: number | null;
  accuracy: number;
  speed: number;
  ts: number;
  /** `true` cuando pasaron más de 15s desde `ts` — ver `estaObsoleto` (`geo.ts`) — Y la
   * obsolescencia está habilitada (`configurarObsolescencia`, más abajo). Siempre `false` con
   * la obsolescencia deshabilitada (default, y el estado normal sin canal visual: sin él la
   * evidencia llega por distancia/heartbeat, así que "sin fix hace 15s" es un vehículo detenido,
   * no una señal perdida). Con ella habilitada, se reevalúa también sin fix nuevo, mediante el
   * temporizador de abajo, para que se vuelva `true` aunque el GPS deje de emitir del todo (si
   * dependiera solo de fixes nuevos, nunca notaría la ausencia de ellos). */
  obsoleto: boolean;
}

type Listener = () => void;

let estadoInterno: EstadoVisualMovimiento | null = null;
let snapshotPublico: EstadoVisual | null = null;
const listeners = new Set<Listener>();

/** Cada cuánto se reevalúa `obsoleto` sin depender de que llegue un fix nuevo. No tiene que ser
 * fino — 3s es más que suficiente frente al umbral de 15s de `estaObsoleto`. Solo corre mientras
 * haya algún suscriptor (nadie mirando el mapa = nada que reevaluar) Y la obsolescencia esté
 * habilitada (ver `configurarObsolescencia`, abajo). */
const INTERVALO_CHEQUEO_OBSOLETO_MS = 3000;
let temporizador: ReturnType<typeof setInterval> | null = null;

/**
 * FASE B (hallazgo de revisión, MEDIO — "`obsoleto` falso positivo sin canal visual"): sin el
 * canal visual (`watchPosition` a 1Hz, `use-gps-operativo.ts`), la evidencia le llega a este
 * store por distancia (`distanceFilter: 15`) o por el heartbeat de 60s — así que "sin fix hace
 * 15s" es el caso NORMAL de un vehículo detenido, no una señal perdida. `obsoleto` solo tiene
 * sentido como "el marcador dejó de moverse con el canal visual activo, algo se rompió" —
 * default `false` (nunca marca obsoleto) hasta que `iniciarCanalVisual`/`detenerCanalVisual`
 * llamen a `configurarObsolescencia` según corresponda.
 */
let obsolescenciaHabilitada = false;

function construirSnapshot(ahora: number): EstadoVisual | null {
  if (!estadoInterno) return null;
  return {
    lat: estadoInterno.lat,
    lng: estadoInterno.lng,
    rumbo: estadoInterno.rumbo,
    accuracy: estadoInterno.accuracy,
    speed: estadoInterno.speed,
    ts: estadoInterno.ts,
    // Con la obsolescencia deshabilitada (default, o sin canal visual), nunca reporta `true` —
    // ver el docblock de `obsolescenciaHabilitada`.
    obsoleto: obsolescenciaHabilitada ? estaObsoleto(estadoInterno.ts, ahora) : false,
  };
}

function notificar(): void {
  for (const listener of listeners) listener();
}

function revisarObsolescencia(): void {
  if (!estadoInterno || !obsolescenciaHabilitada) return;
  const nuevoObsoleto = estaObsoleto(estadoInterno.ts, Date.now());
  if (snapshotPublico?.obsoleto === nuevoObsoleto) return;
  snapshotPublico = construirSnapshot(Date.now());
  notificar();
}

/** Arranca o detiene el temporizador según haga falta — corre solo con AL MENOS un suscriptor Y
 * la obsolescencia habilitada; se detiene apenas falte cualquiera de las dos condiciones. */
function actualizarTemporizador(): void {
  const debeCorrer = obsolescenciaHabilitada && listeners.size > 0;
  if (debeCorrer && !temporizador) {
    temporizador = setInterval(revisarObsolescencia, INTERVALO_CHEQUEO_OBSOLETO_MS);
  } else if (!debeCorrer && temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}

/**
 * Alimenta el store con un fix nuevo. Corre el reducer puro (`aplicarFix`, `reducer.ts`) y
 * notifica a los suscriptores solo si algo cambió — evita re-renders del mapa cuando un fix
 * llega pero el propio reducer no movió nada (p. ej. filtrado por el anti-jitter).
 */
export function alimentarEstadoVisual(fix: FixVisual): void {
  const anterior = estadoInterno;
  estadoInterno = aplicarFix(estadoInterno, fix);
  if (
    anterior &&
    anterior.lat === estadoInterno.lat &&
    anterior.lng === estadoInterno.lng &&
    anterior.rumbo === estadoInterno.rumbo &&
    anterior.accuracy === estadoInterno.accuracy &&
    anterior.speed === estadoInterno.speed &&
    anterior.ts === estadoInterno.ts
  ) {
    return;
  }
  snapshotPublico = construirSnapshot(Date.now());
  notificar();
}

/** `subscribe` de `useSyncExternalStore` — arranca/detiene el temporizador de staleness según
 * haya o no algún consumidor suscrito. */
export function suscribirseEstadoVisual(listener: Listener): () => void {
  listeners.add(listener);
  actualizarTemporizador();
  return () => {
    listeners.delete(listener);
    actualizarTemporizador();
  };
}

/**
 * FASE B (hallazgo de revisión, MEDIO): habilita/deshabilita la reevaluación de `obsoleto` —
 * llamado desde `iniciarCanalVisual`/`detenerCanalVisual` (`use-gps-operativo.ts`), nunca
 * directamente por un componente. Con `false` (default): el snapshot pasa a `obsoleto: false`
 * de inmediato (si había un fix cargado) y el temporizador se detiene si estaba corriendo. Con
 * `true`: reevalúa de inmediato (por si ya pasó el umbral mientras estaba deshabilitada) y
 * arranca el temporizador si hay algún suscriptor. No-op si el valor no cambia.
 */
export function configurarObsolescencia(habilitada: boolean): void {
  if (obsolescenciaHabilitada === habilitada) return;
  obsolescenciaHabilitada = habilitada;
  actualizarTemporizador();
  if (!estadoInterno) return;
  const nuevoSnapshot = construirSnapshot(Date.now());
  if (nuevoSnapshot?.obsoleto === snapshotPublico?.obsoleto) return;
  snapshotPublico = nuevoSnapshot;
  notificar();
}

/** `getSnapshot` de `useSyncExternalStore` — y también la lectura síncrona que puede necesitar
 * un `useEffect` sin suscribirse (p. ej. recentrar el mapa). */
export function obtenerEstadoVisual(): EstadoVisual | null {
  return snapshotPublico;
}

/** Hook de lectura — `null` mientras no llegó ningún fix todavía. Pensado para que lo consuma
 * SOLO `mapa/route-map.tsx`: ver el docblock del módulo, arriba. */
export function useEstadoVisual(): EstadoVisual | null {
  return useSyncExternalStore(suscribirseEstadoVisual, obtenerEstadoVisual);
}

/**
 * FASE B (hallazgo de revisión, ALTO — "store visual nunca se reinicia"): vuelve el store a "sin
 * fix" y NOTIFICA a los suscriptores — a diferencia de `reiniciarEstadoVisualParaTests` (abajo),
 * NO toca `listeners` ni el temporizador. Llamado desde `use-gps-operativo.ts` en `detener()`
 * (tras cortar el canal visual) y en el cleanup de desmontaje/cambio de sesión del hook: sin
 * esto, al ser un singleton de módulo, `mapa/route-map.tsx` seguía priorizando la posición VIEJA
 * de un recorrido ya terminado sobre el prop `posicionActual` fresco (p. ej. el
 * `getCurrentPosition` del próximo montaje) hasta que llegara un fix nuevo — que con un recorrido
 * detenido nunca llega. Notificar acá hace que `useEstadoVisual()` pase a `null` de inmediato y
 * el componente caiga al prop en el siguiente render.
 */
export function reiniciarEstadoVisual(): void {
  estadoInterno = null;
  snapshotPublico = null;
  notificar();
}

/** SOLO para tests: limpia el estado del módulo entre casos, incluidos `listeners`/temporizador/
 * flag de obsolescencia — mismo patrón que `reiniciarEstadoRecorridoActivoParaTests`
 * (`estado-recorrido-activo.ts`). Sin caller en producción (ver `reiniciarEstadoVisual`, arriba,
 * para el equivalente que SÍ se usa en producción). */
export function reiniciarEstadoVisualParaTests(): void {
  reiniciarEstadoVisual();
  listeners.clear();
  obsolescenciaHabilitada = false;
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}
