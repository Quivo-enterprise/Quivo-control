import { z } from 'zod';
import { EstadoReglaSchema, GravedadReglaSchema, SujetoTipoSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const ReglaSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  nombre: z.string().min(1).max(200),
  tipo: z.string().min(1).max(100),
  gravedad: GravedadReglaSchema,
  aplicaA: SujetoTipoSchema,
  descripcion: z.string().max(2000).nullable(),
  estado: EstadoReglaSchema,
});
export type Regla = z.infer<typeof ReglaSchema>;

export const CrearReglaSchema = ReglaSchema.omit({ id: true, estado: true, descripcion: true }).extend({
  estado: EstadoReglaSchema.default('activo'),
  descripcion: z.string().max(2000).nullable().optional(),
});
export type CrearRegla = z.infer<typeof CrearReglaSchema>;

export const ActualizarReglaSchema = ReglaSchema.omit({ id: true, sindicatoId: true }).partial();
export type ActualizarRegla = z.infer<typeof ActualizarReglaSchema>;
