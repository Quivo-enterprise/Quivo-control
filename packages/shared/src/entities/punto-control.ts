import { z } from 'zod';
import { PuntoGeoJsonSchema } from '../geo.js';
import { uuidSchema } from '../primitives.js';

/** `coord` viaja como GeoJSON Point in/out — la columna real es `GEOGRAPHY(POINT)`
 * (SQL crudo en apps/api, igual que `paradas.coord`/`rutas.geometria`). La validación de
 * cumplimiento en recorrido (RF-39, contra `radioToleranciaM`) es de M3 (worker) — acá solo
 * la gestión del punto (RF-34..38). */
export const PuntoControlSchema = z.object({
  id: uuidSchema,
  rutaId: uuidSchema,
  orden: z.number().int().nonnegative(),
  coord: PuntoGeoJsonSchema,
  radioToleranciaM: z.number().int().positive(),
  obligatorio: z.boolean(),
});
export type PuntoControl = z.infer<typeof PuntoControlSchema>;

export const CrearPuntoControlSchema = PuntoControlSchema.omit({ id: true, rutaId: true, obligatorio: true }).extend(
  { obligatorio: z.boolean().default(true) },
);
export type CrearPuntoControl = z.infer<typeof CrearPuntoControlSchema>;

export const ActualizarPuntoControlSchema = PuntoControlSchema.omit({ id: true, rutaId: true }).partial();
export type ActualizarPuntoControl = z.infer<typeof ActualizarPuntoControlSchema>;
