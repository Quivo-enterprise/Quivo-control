import { z } from 'zod';
import { uuidSchema } from '../primitives.js';

/** Fila de `audit_log` (RF-81..84, QUI-230) — `diff` es JSONB libre (el body de la request
 * que originó la acción), sin un shape fijo por entidad. */
export const AuditLogEntrySchema = z.object({
  id: uuidSchema,
  sindicatoId: uuidSchema.nullable(),
  usuarioId: z.string().min(1),
  entidad: z.string().min(1),
  entidadId: z.string().min(1),
  accion: z.string().min(1),
  diff: z.unknown(),
  ts: z.coerce.date(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/** Filtros de `GET /v1/auditoria` — todos opcionales, la UI completa llega en QUI-248 (M4). */
export const AuditoriaQuerySchema = z.object({
  entidad: z.string().min(1).optional(),
  accion: z.string().min(1).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});
export type AuditoriaQuery = z.infer<typeof AuditoriaQuerySchema>;
