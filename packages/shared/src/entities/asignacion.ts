import { z } from 'zod';
import { EstadoAsignacionSchema } from '../enums/estados.js';
import { TurnoSchema } from '../enums/turno.js';
import { uuidSchema } from '../primitives.js';

export const AsignacionSchema = z.object({
  id: uuidSchema,
  rotacionId: uuidSchema,
  vehiculoId: uuidSchema,
  conductorId: uuidSchema.nullable(),
  rutaId: uuidSchema,
  fecha: z.coerce.date(),
  horario: TurnoSchema,
  // Hora exacta de despacho/presentación (modelo operativo Línea 120, piloto Tiquipaya) —
  // `null` salvo que la generación haya recibido `configHorarios` para este `horario` (ver
  // GenerarRotacionSchema). `horario` sigue siendo el dato obligatorio.
  horaSalida: z.coerce.date().nullable(),
  horaPresentacion: z.coerce.date().nullable(),
  orden: z.number().int().positive(),
  venceAt: z.coerce.date(),
  // La marca un job BullMQ repeatable (RF-57, QUI-234), no el request que crea/edita la
  // asignación — ver rotaciones.service.ts `marcarVencidas`.
  estado: EstadoAsignacionSchema,
});
export type Asignacion = z.infer<typeof AsignacionSchema>;

/** Alta manual de una asignación dentro de una rotación en borrador (RF-54..55) — para
 * cubrir a mano un slot que el reparto automático dejó sin vehículo disponible. */
export const CrearAsignacionManualSchema = z.object({
  vehiculoId: uuidSchema,
  conductorId: uuidSchema.nullable().optional(),
  rutaId: uuidSchema,
  fecha: z.coerce.date(),
  horario: TurnoSchema,
  orden: z.number().int().positive(),
});
export type CrearAsignacionManual = z.infer<typeof CrearAsignacionManualSchema>;

/** Edición manual de una asignación dentro de una rotación en borrador (RF-54..55) — sin
 * `fecha`/`venceAt` (vence al fin de esa jornada, se recalcula server-side, no es un campo
 * de edición libre) ni `rotacionId` (mover de rotación no es un caso de uso). */
export const ActualizarAsignacionSchema = z.object({
  vehiculoId: uuidSchema.optional(),
  conductorId: uuidSchema.nullable().optional(),
  rutaId: uuidSchema.optional(),
  horario: TurnoSchema.optional(),
  orden: z.number().int().positive().optional(),
});
export type ActualizarAsignacion = z.infer<typeof ActualizarAsignacionSchema>;
