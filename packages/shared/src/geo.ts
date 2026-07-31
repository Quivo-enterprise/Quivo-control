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
