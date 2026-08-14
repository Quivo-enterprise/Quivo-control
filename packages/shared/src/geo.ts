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
