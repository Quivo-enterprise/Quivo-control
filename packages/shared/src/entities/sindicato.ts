import { z } from 'zod';
import { EstadoSindicatoSchema } from '../enums/estados.js';
import { uuidSchema } from '../primitives.js';

export const SindicatoSchema = z.object({
  id: uuidSchema,
  nombre: z.string().min(1).max(200),
  estado: EstadoSindicatoSchema,
});
export type Sindicato = z.infer<typeof SindicatoSchema>;

export const CrearSindicatoSchema = SindicatoSchema.omit({ id: true, estado: true }).extend({
  estado: EstadoSindicatoSchema.default('activo'),
});
export type CrearSindicato = z.infer<typeof CrearSindicatoSchema>;
