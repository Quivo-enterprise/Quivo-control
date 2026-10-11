import { haversineMetros } from '@quivo/shared';
import type { Coordenada } from './tipos';

/** Reduce cualquier ángulo en grados a `[0, 360)`. */
export function normalizarAngulo(angulo: number): number {
  const resultado = angulo % 360;
  return resultado < 0 ? resultado + 360 : resultado;
}

/**
 * Delta angular con signo, por el arco más corto, en `(-180, 180]` — positivo cuando `hasta`
 * queda en sentido horario de `desde`. Cruza la costura 0°/360° sin el salto de 340° que daría
 * una resta ingenua (`hasta - desde`): p. ej. de 350° a 10° el delta es `+20`, no `-340`; de
 * 10° a 350° es `-20`, no `+340`.
 */
export function deltaAnguloCorto(desde: number, hasta: number): number {
  const diferencia = normalizarAngulo(hasta - desde);
  return diferencia > 180 ? diferencia - 360 : diferencia;
}

/** Interpola el ángulo entre `desde` y `hasta` por el arco más corto, con `t ∈ [0,1]`. */
export function interpolarAngulo(desde: number, hasta: number, t: number): number {
  return normalizarAngulo(desde + deltaAnguloCorto(desde, hasta) * t);
}

/** Interpolación lineal de una coordenada — suficiente para el hueco entre dos fixes reales
 * (decenas de metros como mucho); no hace falta modelar la curvatura de la Tierra a esa
 * escala. */
export function interpolarLatLng(a: Coordenada, b: Coordenada, t: number): Coordenada {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Bearing inicial de `a` a `b`, en grados `[0,360)` — misma fórmula que tenía el
 * `calcHeading` del mapa Leaflet anterior (ya retirado). Usada por `seleccionarRumbo` (`rumbo.ts`) como
 * fallback cuando no se puede confiar en `coords.heading`.
 */
export function calcularBearing(a: Coordenada, b: Coordenada): number {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLon = (b.lng - a.lng) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizarAngulo(Math.atan2(y, x) * (180 / Math.PI));
}

/** Distancia en metros entre dos coordenadas `{lat,lng}` — delega en `haversineMetros`
 * (`@quivo/shared`, ya usada por `gps/geofence.ts`), que espera tuplas `[lon,lat]` (orden
 * GeoJSON) en vez del `{lat,lng}` que usa este módulo. */
export function distanciaMetros(a: Coordenada, b: Coordenada): number {
  return haversineMetros([a.lng, a.lat], [b.lng, b.lat]);
}

const DURACION_MIN_MS = 300;
const DURACION_MAX_MS = 2500;
const UMBRAL_HUECO_MS = 5000;
const DURACION_HUECO_MS = 500;

/**
 * Duración (ms) de la animación entre la posición mostrada anterior y la nueva, en función del
 * tiempo transcurrido entre los dos fixes que la originan (Δt). Acotada a `[300,2500]` ms: un
 * hueco de 100 ms (dos fixes casi seguidos) igual anima 300 ms para no verse como un salto en
 * seco, y uno de 20 s en movimiento normal no anima 20 s enteros (queda pegado 2.5 s). Un hueco
 * mayor a 5 s (offline, background, GPS perdido un rato) ya no es "seguir moviéndose": se corta
 * a una transición rápida de 500 ms en vez de animar un salto grande durante 2.5 s completos.
 */
export function duracionAnimacionMs(dtEntreFixesMs: number): number {
  if (dtEntreFixesMs > UMBRAL_HUECO_MS) return DURACION_HUECO_MS;
  return Math.min(DURACION_MAX_MS, Math.max(DURACION_MIN_MS, dtEntreFixesMs));
}

const UMBRAL_OBSOLETO_MS = 15_000;

/** `true` cuando pasaron más de 15 s desde el último fix aplicado (`ultimoFixTs`) — el
 * consumidor (Fase C) atenúa el marcador, como el punto gris de Google cuando pierde señal. */
export function estaObsoleto(ultimoFixTs: number, ahora: number): boolean {
  return ahora - ultimoFixTs > UMBRAL_OBSOLETO_MS;
}
