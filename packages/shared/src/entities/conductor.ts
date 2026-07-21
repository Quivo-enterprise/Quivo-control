import { z } from 'zod';
import { EstadoConductorSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const ConductorSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  nombre: z.string().min(1).max(200),
  documentoIdentidad: z.string().min(1).max(50),
  licenciaConducir: z.string().min(1).max(50),
  estado: EstadoConductorSchema,
});
export type Conductor = z.infer<typeof ConductorSchema>;

export const CrearConductorSchema = ConductorSchema.omit({ id: true, estado: true }).extend({
  estado: EstadoConductorSchema.default('activo'),
});
export type CrearConductor = z.infer<typeof CrearConductorSchema>;
