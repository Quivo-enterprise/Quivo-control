import { z } from 'zod';
import { uuidV7Schema } from '../primitives.js';

/**
 * Tipos de evento que la app móvil produce en el outbox local y sincroniza por lotes
 * (RF-67..73, doc técnico §6/§7). Se consume recién en M3, pero el contrato se fija ahora.
 */
export const TipoEventoSyncSchema = z.enum([
  'gps_point',
  'inicio_recorrido',
  'fin_recorrido',
  'cumplimiento_punto_control',
  'observacion',
]);
export type TipoEventoSync = z.infer<typeof TipoEventoSyncSchema>;

/**
 * Evento idempotente de sync: `eventId` es un UUIDv7 generado en el dispositivo.
 * El worker inserta con `ON CONFLICT (event_id) DO NOTHING` — reenviar el mismo evento
 * N veces no produce duplicados (RF-72, RNF-33/34).
 */
export const EventoSyncSchema = z.object({
  eventId: uuidV7Schema,
  deviceId: z.string().min(1),
  ts: z.string().datetime({ offset: true }),
  tipo: TipoEventoSyncSchema,
  payload: z.record(z.unknown()),
});
export type EventoSync = z.infer<typeof EventoSyncSchema>;

/** Payload de `POST /v1/sync/batches` (hasta ~500 eventos por request, doc técnico §7). */
export const SyncBatchSchema = z.object({
  eventos: z.array(EventoSyncSchema).min(1).max(500),
});
export type SyncBatch = z.infer<typeof SyncBatchSchema>;

/**
 * Respuesta de `POST /v1/sync/batches` (RF-69..72, RNF-33/34, QUI-240): `aceptados` son los
 * `eventId` que quedaron encolados para el worker de ingesta (QUI-241) — el cliente móvil
 * SOLO debe marcar como sincronizado (`acusado`, QUI-238) lo que aparezca acá. Reenviar el
 * mismo lote N veces no duplica nada (idempotencia por UUIDv7 en el worker).
 */
export const SyncBatchResponseSchema = z.object({
  aceptados: z.array(uuidV7Schema),
});
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;
