import { z } from 'zod';
import { EstadoVarianteSchema } from '../enums/estados.js';
import { LineaGeoJsonSchema } from '../geo.js';
import { uuidSchema } from '../primitives.js';

/** Una variante es una etiqueta sobre una ruta (doc técnico §4.2). Desde F1 (docs/plan-molinos-
 * designacion.md) puede traer el TRAMO ADICIONAL (`geometria`, no el recorrido completo) y el
 * PC donde debe esperar (`puntoEsperaId`); ambos solo los edita un admin. */
export const VarianteSchema = z.object({
  id: uuidSchema,
  rutaId: uuidSchema,
  nombre: z.string().min(1).max(200),
  estado: EstadoVarianteSchema,
  geometria: LineaGeoJsonSchema.nullable().optional(),
  puntoEsperaId: uuidSchema.nullable().optional(),
});
export type Variante = z.infer<typeof VarianteSchema>;

export const CrearVarianteSchema = VarianteSchema.omit({ id: true, rutaId: true, estado: true }).extend({
  estado: EstadoVarianteSchema.default('activo'),
});
export type CrearVariante = z.infer<typeof CrearVarianteSchema>;

export const ActualizarVarianteSchema = VarianteSchema.omit({ id: true, rutaId: true }).partial();
export type ActualizarVariante = z.infer<typeof ActualizarVarianteSchema>;
