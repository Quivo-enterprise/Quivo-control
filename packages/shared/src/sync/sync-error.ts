import { z } from 'zod';
import { uuidSchema } from '../primitives.js';

/** Fila de `sync_errors` (RNF-35, QUI-241/242) — lotes/eventos que el worker de ingesta
 * rechazó. Nada se descarta en silencio: queda visible en el admin con motivo. */
export const SyncErrorEntrySchema = z.object({
  id: uuidSchema,
  sindicatoId: uuidSchema,
  deviceId: z.string().min(1),
  sesionId: uuidSchema.nullable(),
  eventId: uuidSchema.nullable(),
  payload: z.unknown(),
  error: z.string().min(1),
  ts: z.coerce.date(),
});
export type SyncErrorEntry = z.infer<typeof SyncErrorEntrySchema>;

/** Filtros de `GET /v1/sync-errores` — todos opcionales, mismo criterio que `AuditoriaQuerySchema`. */
export const SyncErroresQuerySchema = z.object({
  deviceId: z.string().min(1).optional(),
  sesionId: uuidSchema.optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});
export type SyncErroresQuery = z.infer<typeof SyncErroresQuerySchema>;
