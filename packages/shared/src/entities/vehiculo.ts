import { z } from 'zod';
import { EstadoVehiculoSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const VehiculoSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  socioId: uuidSchema.nullable(),
  placa: z.string().min(1).max(20),
  tipo: z.string().min(1).max(50),
  marca: z.string().min(1).max(50),
  modelo: z.string().min(1).max(50),
  color: z.string().min(1).max(30),
  capacidad: z.number().int().positive(),
  estado: EstadoVehiculoSchema,
});
export type Vehiculo = z.infer<typeof VehiculoSchema>;

export const CrearVehiculoSchema = VehiculoSchema.omit({ id: true, estado: true }).extend({
  estado: EstadoVehiculoSchema.default('activo'),
});
export type CrearVehiculo = z.infer<typeof CrearVehiculoSchema>;
