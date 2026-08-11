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
 *
 * Al elegir vehículo para cada slot se prioriza el que todavía no cubrió esa ruta en el
 * período (modelo operativo Línea 120, piloto Tiquipaya): "variante de línea" en la
 * terminología del sindicato — cae al round-robin ciego solo si todos los vehículos libres
 * ya la cubrieron. Con suficiente capacidad de slots, todo vehículo activo termina cubriendo
 * cada `rutaId` pedido al menos una vez. Los pares vehículo×ruta que igual queden sin cubrir
 * (agenda sin slots libres) se reportan en `sinCobertura` de la respuesta, sin abortar la
 * generación.
 */
const horaHHmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato de hora inválido, usar HH:mm');

/** Config de horario pico por `horario` (RF-ROT-007 del modelo Línea 120: frecuencia y
 * horario de servicio no deben hardcodearse). Cuando se manda para un `horario`, la
 * generación reparte múltiples salidas espaciadas por `headwayMinutos` entre `horaInicio` y
 * `horaFin` — en vez de una sola asignación por ruta — cicladas entre `rutaIds` (modo
 * "frecuencia combinada de línea"). `headwayMinutos` chico = más trufis seguidos, para horas
 * pico. Sin esta config para un `horario`, ese `horario` sigue con el comportamiento previo
 * (una asignación por ruta, sin hora exacta). Los números reales de hora pico son "NO
 * CONFIRMADO" en el doc del piloto Línea 120 — quedan a criterio de quien genera, no
 * hardcodeados acá. */
export const ConfigHorarioSchema = z
  .object({
    horaInicio: horaHHmmSchema,
    horaFin: horaHHmmSchema,
    headwayMinutos: z.number().int().positive(),
    bufferPresentacionMinutos: z.number().int().nonnegative(),
  })
  .refine((c) => c.horaInicio < c.horaFin, {
    message: 'horaInicio debe ser anterior a horaFin',
    path: ['horaFin'],
  });
export type ConfigHorario = z.infer<typeof ConfigHorarioSchema>;

export const GenerarRotacionSchema = z.object({
  sindicatoId: uuidSchema.optional(),
  periodo: z.string().min(1).max(20),
  rutaIds: z.array(uuidSchema).min(1),
  fechas: z.array(z.coerce.date()).min(1),
  horarios: z.array(TurnoSchema).min(1),
  configHorarios: z.record(TurnoSchema, ConfigHorarioSchema).optional(),
});
export type GenerarRotacion = z.infer<typeof GenerarRotacionSchema>;
