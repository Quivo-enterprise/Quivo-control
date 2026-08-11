import { z } from 'zod';
import { EstadoVarianteSchema } from '../enums/estados.js';
import { uuidSchema } from '../primitives.js';

/** Sin geometría propia — una variante es una etiqueta sobre una ruta (doc técnico §4.2 la
 * deja abierta: "variantes(id, ruta_id, ...)"), CRUD simple vía Prisma Client normal. */
export const VarianteSchema = z.object({
  id: uuidSchema,
  rutaId: uuidSchema,
  nombre: z.string().min(1).max(200),
  estado: EstadoVarianteSchema,
});
export type Variante = z.infer<typeof VarianteSchema>;

export const CrearVarianteSchema = VarianteSchema.omit({ id: true, rutaId: true, estado: true }).extend({
  estado: EstadoVarianteSchema.default('activo'),
});
export type CrearVariante = z.infer<typeof CrearVarianteSchema>;

export const ActualizarVarianteSchema = VarianteSchema.omit({ id: true, rutaId: true }).partial();
export type ActualizarVariante = z.infer<typeof ActualizarVarianteSchema>;
