// Interpolación PURA de la posición mostrada de CADA vehículo del motor Google de `RouteMap`.
//
// Contexto: `/en-vivo` consulta `/posiciones` cada ~2 s y cada vehículo llega con su nueva
// posición. En vez de que el marcador salte, se desliza desde la posición que se estaba
// MOSTRANDO hacia la nueva en ~1 s, sin superar el intervalo del poll (interpolación lineal: un bus a
// velocidad ~constante entre dos fixes no necesita easing). Este módulo no toca el reloj ni el
// DOM: el llamador pasa `ahoraMs` (el timestamp de `requestAnimationFrame`), así se testea en
// el entorno `node` de Vitest sin temporizadores. El vehículo seleccionado con traza de alta
// resolución sigue usando `vehicle-marker-animation.ts` (cola de waypoints); esto cubre al resto.

export interface LatLngSimple {
  lat: number;
  lng: number;
}

export interface EstadoInterpolacion {
  desde: LatLngSimple;
  hasta: LatLngSimple;
  /** Instante (ms, mismo reloj que `ahoraMs`) en el que arrancó el tramo. */
  inicioMs: number;
  duracionMs: number;
}

/** Tope del deslizamiento: ~1 s (plan de /en-vivo, `min(1000, intervalo)`). Repartirlo en todo el
 * intervalo del poll (~2 s) añadiría ese tiempo entero como retraso respecto al dato real. */
export const DURACION_INTERPOLACION_MS = 1000;

/** Duración efectiva del deslizamiento para un intervalo de poll dado: `min(1000, intervalo)`. */
export function duracionInterpolacion(intervaloMs?: number): number {
  return Math.min(DURACION_INTERPOLACION_MS, intervaloMs ?? DURACION_INTERPOLACION_MS);
}

/** Por encima de esta distancia el vehículo "teletransporta" (reinicio de GPS, fix atrasado tras
 * un hueco largo): deslizar varios km en ~1 s sería un vuelo absurdo, no información. */
export const SALTO_DIRECTO_METROS = 1500;

const RADIO_TIERRA_M = 6_371_000;

/** Distancia haversine en metros. */
export function distanciaMetros(a: LatLngSimple, b: LatLngSimple): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estado "quieto" en `posicion`. */
export function interpolacionQuieta(posicion: LatLngSimple): EstadoInterpolacion {
  return { desde: posicion, hasta: posicion, inicioMs: 0, duracionMs: 0 };
}

/** Progreso 0..1 del tramo en `ahoraMs`. Duración 0 o tiempo vencido => 1. */
function progreso(estado: EstadoInterpolacion, ahoraMs: number): number {
  if (estado.duracionMs <= 0) return 1;
  const t = (ahoraMs - estado.inicioMs) / estado.duracionMs;
  return Math.min(1, Math.max(0, t));
}

/** Posición a dibujar en `ahoraMs`. */
export function posicionInterpolada(estado: EstadoInterpolacion, ahoraMs: number): LatLngSimple {
  const t = progreso(estado, ahoraMs);
  if (t >= 1) return estado.hasta;
  return {
    lat: estado.desde.lat + (estado.hasta.lat - estado.desde.lat) * t,
    lng: estado.desde.lng + (estado.hasta.lng - estado.desde.lng) * t,
  };
}

/** `true` mientras el tramo no terminó (el llamador sigue pidiendo frames). */
export function interpolacionEnMovimiento(estado: EstadoInterpolacion, ahoraMs: number): boolean {
  return progreso(estado, ahoraMs) < 1;
}

/**
 * Nuevo destino para el vehículo. Arranca desde la posición que se está MOSTRANDO en `ahoraMs`
 * (nunca rebobina a la posición vieja ni salta a la nueva a mitad de un tramo). Devuelve el mismo
 * estado si el destino no cambió. Salta directo (sin deslizar) con `reducirMovimiento`
 * (`prefers-reduced-motion`), destino a más de `SALTO_DIRECTO_METROS` o duración no positiva.
 */
export function apuntarInterpolacionA(
  estado: EstadoInterpolacion,
  destino: LatLngSimple,
  ahoraMs: number,
  opts: { duracionMs?: number; reducirMovimiento?: boolean } = {},
): EstadoInterpolacion {
  if (estado.hasta.lat === destino.lat && estado.hasta.lng === destino.lng) return estado;
  const duracionMs = opts.duracionMs ?? DURACION_INTERPOLACION_MS;
  const actual = posicionInterpolada(estado, ahoraMs);
  if (opts.reducirMovimiento || duracionMs <= 0 || distanciaMetros(actual, destino) > SALTO_DIRECTO_METROS) {
    return interpolacionQuieta(destino);
  }
  return { desde: actual, hasta: destino, inicioMs: ahoraMs, duracionMs };
}
