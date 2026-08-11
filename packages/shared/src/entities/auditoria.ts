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

/** Filtros de `GET /v1/auditoria` — todos opcionales (RF-81..84, UI completa en QUI-248).
 * `skip` pagina por offset sobre el resultado ordenado por `ts desc` (mismo límite fijo de
 * 200 filas por página que ya tenía el service, ver auditoria.service.ts). */
export const AuditoriaQuerySchema = z.object({
  entidad: z.string().min(1).optional(),
  accion: z.string().min(1).optional(),
  usuarioId: z.string().min(1).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).optional(),
});
export type AuditoriaQuery = z.infer<typeof AuditoriaQuerySchema>;
