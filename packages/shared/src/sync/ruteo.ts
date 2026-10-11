import { z } from 'zod';

/** Coordenada [lat, lng] — a diferencia de `PuntoGeoJson` (orden GeoJSON [lon, lat]), acá
 * usamos [lat, lng] por comodidad en el mapa móvil. */
const latLngSchema = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const RutaCalculadaSchema = z.object({
  coordenadas: z.array(latLngSchema).min(2),
  distanciaM: z.number().nonnegative(),
  duracionS: z.number().nonnegative(),
});
export type RutaCalculada = z.infer<typeof RutaCalculadaSchema>;
