import { z } from 'zod';

/** [longitud, latitud] — orden GeoJSON estándar (RFC 7946), no [lat, lon]. */
const coordenadaSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const PuntoGeoJsonSchema = z.object({
  type: z.literal('Point'),
  coordinates: coordenadaSchema,
});
export type PuntoGeoJson = z.infer<typeof PuntoGeoJsonSchema>;

export const LineaGeoJsonSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(coordenadaSchema).min(2, 'una LineString necesita al menos 2 puntos'),
});
export type LineaGeoJson = z.infer<typeof LineaGeoJsonSchema>;

const RADIO_TIERRA_METROS = 6_371_000;

/**
 * Distancia haversine entre dos puntos `[lon, lat]` (orden GeoJSON), en metros. Aproxima la
 * Tierra como esfera — suficiente para el radio de tolerancia de puntos de control (decenas
 * de metros, QUI-239/RF-64..66); el servidor usa `ST_DWithin` de PostGIS sobre un elipsoide
 * real como fuente de verdad (`common/geo/proximidad-ruta.ts`), esto es solo detección
 * offline en el dispositivo con feedback inmediato al chofer.
 */
export function haversineMetros(a: [number, number], b: [number, number]): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h =
    senoLat * senoLat + Math.cos(latA * rad) * Math.cos(latB * rad) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Una coordenada `{lat, lng}` (a diferencia de las tuplas `[lon, lat]` GeoJSON de arriba). */
export interface Coordenada {
  lat: number;
  lng: number;
}
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
 * (arriba), que espera tuplas `[lon,lat]` (orden
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

