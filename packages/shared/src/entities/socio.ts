import { z } from 'zod';
import { EstadoSocioSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const SocioSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  nombre: z.string().min(1).max(200),
  documentoIdentidad: z.string().min(1).max(50),
  estado: EstadoSocioSchema,
});
export type Socio = z.infer<typeof SocioSchema>;

export const CrearSocioSchema = SocioSchema.omit({ id: true, estado: true }).extend({
  estado: EstadoSocioSchema.default('activo'),
});
export type CrearSocio = z.infer<typeof CrearSocioSchema>;

// Sin `sindicatoId`: mover un socio entre sindicatos no es un PATCH simple, queda fuera de
// alcance (no hay caso de uso definido en el doc técnico).
export const ActualizarSocioSchema = SocioSchema.omit({ id: true, sindicatoId: true }).partial();
export type ActualizarSocio = z.infer<typeof ActualizarSocioSchema>;
