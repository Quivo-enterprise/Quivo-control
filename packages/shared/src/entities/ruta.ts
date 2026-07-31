import { z } from 'zod';
import { EstadoRutaSchema } from '../enums/estados.js';
import { LineaGeoJsonSchema } from '../geo.js';
import { uuidSchema } from '../primitives.js';

/** `geometria` viaja como GeoJSON in/out (RF-24..33) — la columna real es
 * `GEOGRAPHY(LINESTRING)` en Postgres, pero eso es un detalle de `apps/api`
 * (ST_GeomFromGeoJSON/ST_AsGeoJSON vía SQL crudo, Prisma no tipa GEOGRAPHY nativo). */
export const RutaSchema = z.object({
  id: uuidSchema,
  lineaId: uuidSchema,
  sentido: z.string().min(1).max(50),
  geometria: LineaGeoJsonSchema,
  estado: EstadoRutaSchema,
});
export type Ruta = z.infer<typeof RutaSchema>;

export const CrearRutaSchema = RutaSchema.omit({ id: true, lineaId: true, estado: true }).extend({
  estado: EstadoRutaSchema.default('activo'),
});
export type CrearRuta = z.infer<typeof CrearRutaSchema>;

export const ActualizarRutaSchema = RutaSchema.omit({ id: true, lineaId: true }).partial();
export type ActualizarRuta = z.infer<typeof ActualizarRutaSchema>;
