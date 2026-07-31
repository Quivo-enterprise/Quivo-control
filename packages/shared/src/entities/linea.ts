import { z } from 'zod';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const LineaSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(200),
  color: z.string().max(30).nullable(),
  descripcion: z.string().max(1000).nullable(),
});
export type Linea = z.infer<typeof LineaSchema>;

export const CrearLineaSchema = LineaSchema.omit({ id: true, color: true, descripcion: true }).extend({
  color: z.string().max(30).nullable().optional(),
  descripcion: z.string().max(1000).nullable().optional(),
});
export type CrearLinea = z.infer<typeof CrearLineaSchema>;

export const ActualizarLineaSchema = LineaSchema.omit({ id: true, sindicatoId: true }).partial();
export type ActualizarLinea = z.infer<typeof ActualizarLineaSchema>;
