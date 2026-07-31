import { z } from 'zod';
import { EstadoRotacionSchema } from '../enums/estados.js';
import { TurnoSchema } from '../enums/turno.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const RotacionSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  periodo: z.string().min(1).max(20),
  estado: EstadoRotacionSchema,
});
export type Rotacion = z.infer<typeof RotacionSchema>;

/**
 * `POST /v1/rotaciones` (RF-51..53) — genera un borrador repartiendo round-robin los
 * vehículos/conductores activos del sindicato entre las rutas/fechas/horarios pedidos. El
 * doc técnico no detalla una "regla de reparto" más allá de mencionarla — round-robin con
 * mejor esfuerzo (un slot sin vehículo libre queda sin cubrir, no rompe el resto) es una
 * asunción de este equipo, no una decisión de Producto confirmada. Ver rotaciones.service.ts.
 */
export const GenerarRotacionSchema = z.object({
  sindicatoId: uuidSchema.optional(),
  periodo: z.string().min(1).max(20),
  rutaIds: z.array(uuidSchema).min(1),
  fechas: z.array(z.coerce.date()).min(1),
  horarios: z.array(TurnoSchema).min(1),
});
export type GenerarRotacion = z.infer<typeof GenerarRotacionSchema>;
