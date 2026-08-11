import { z } from 'zod';
import { PuntoGeoJsonSchema } from '../geo.js';
import { EstadoParadaSchema } from '../enums/estados.js';
import { uuidSchema } from '../primitives.js';

// El doc técnico (§4.2) no especifica los valores de `tipo` para paradas — estos tres son
// una asunción razonable (toda ruta tiene un origen y un destino), no una decisión de
// Producto confirmada. Ajustar si Producto define otra taxonomía.
export const TipoParadaSchema = z.enum(['origen', 'intermedia', 'destino']);
export type TipoParada = z.infer<typeof TipoParadaSchema>;

/** `coord` viaja como GeoJSON Point in/out — la columna real es `GEOGRAPHY(POINT)`
 * (SQL crudo en apps/api, igual que `rutas.geometria`). */
export const ParadaSchema = z.object({
  id: uuidSchema,
  rutaId: uuidSchema,
  tipo: TipoParadaSchema,
  orden: z.number().int().nonnegative(),
  coord: PuntoGeoJsonSchema,
  estado: EstadoParadaSchema,
});
export type Parada = z.infer<typeof ParadaSchema>;

export const CrearParadaSchema = ParadaSchema.omit({ id: true, rutaId: true, estado: true }).extend({
  estado: EstadoParadaSchema.default('activo'),
});
export type CrearParada = z.infer<typeof CrearParadaSchema>;

export const ActualizarParadaSchema = ParadaSchema.omit({ id: true, rutaId: true }).partial();
export type ActualizarParada = z.infer<typeof ActualizarParadaSchema>;
