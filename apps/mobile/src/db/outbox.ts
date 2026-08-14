import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { generarUuidV7, type TipoEventoSync } from '@quivo/shared';

/**
 * Outbox local (RF-67..73, doc técnico §6): todo evento nace con `event_id` UUIDv7 +
 * `device_id` + `ts` de dispositivo, y se persiste ANTES de cualquier intento de red
 * (perder internet no debe perder evidencia, RNF-09). Estados:
 * - `pendiente`: recién creado, nunca se intentó enviar (o el intento anterior falló/venció).
 * - `enviado`: el lote que lo contiene salió por red, esperando el 202 de QUI-240.
 * - `acusado`: el servidor confirmó ese `event_id` puntual — sincronizado de verdad.
 * Reenviar un lote entero cuando solo algunos `event_id` fueron acusados no duplica nada
 * (idempotencia por UUIDv7 en el worker, QUI-241) — por eso el estado se actualiza por
 * `event_id`, no por lote completo.
 */
export interface EventoOutboxNuevo {
  deviceId: string;
  tipo: TipoEventoSync;
  payload: Record<string, unknown>;
}

export type EstadoOutbox = 'pendiente' | 'enviado' | 'acusado';

export interface EventoOutboxRow {
  eventId: string;
  deviceId: string;
  ts: string;
  tipo: TipoEventoSync;
  payload: Record<string, unknown>;
  estado: EstadoOutbox;
}

interface OutboxRowCruda {
  event_id: string;
  device_id: string;
  ts: string;
  tipo: string;
  payload: string;
  estado: string;
}

export async function abrirOutbox(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('quivo-outbox.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS outbox (
      event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      tipo TEXT NOT NULL,
      payload TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente'
    );
    CREATE INDEX IF NOT EXISTS outbox_estado_idx ON outbox(estado);
  `);
  return db;
}

async function generarEventId(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(10);
  return generarUuidV7(bytes);
}

/** Persiste un evento nuevo en estado `pendiente` — ver el contrato en el comentario de
 * arriba: esto debe ocurrir antes de cualquier intento de red, nunca después. */
export async function encolarEvento(
  db: SQLite.SQLiteDatabase,
  evento: EventoOutboxNuevo,
): Promise<string> {
  const eventId = await generarEventId();
  await db.runAsync(
    "INSERT INTO outbox (event_id, device_id, ts, tipo, payload, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')",
    [eventId, evento.deviceId, new Date().toISOString(), evento.tipo, JSON.stringify(evento.payload)],
  );
  return eventId;
}

export async function contarEventosPendientes(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) as total FROM outbox WHERE estado != 'acusado'",
  );
  return row?.total ?? 0;
}

/** Toma hasta `limite` eventos `pendiente` (los más viejos primero) para armar el próximo
 * lote de `POST /v1/sync/batches` (QUI-240, hasta ~500 eventos por request). */
export async function obtenerLotePendiente(
  db: SQLite.SQLiteDatabase,
  limite = 500,
): Promise<EventoOutboxRow[]> {
  const rows = await db.getAllAsync<OutboxRowCruda>(
    "SELECT event_id, device_id, ts, tipo, payload, estado FROM outbox WHERE estado = 'pendiente' ORDER BY ts ASC LIMIT ?",
    [limite],
  );
  return rows.map(toEventoOutboxRow);
}

/**
 * Payloads de todos los eventos de un tipo que siguen en el outbox (en cualquier estado, no
 * solo `pendiente`). Lo usa el headless task para sembrar su Set de cumplimientos ya
 * emitidos cuando Android recicla el contexto JS a mitad de turno — sin eso, el Set arranca
 * vacío y se reemite un `cumplimiento_punto_control` que el worker ya no puede deduplicar
 * (lo hace por `eventId`, y la re-emisión lleva un UUIDv7 nuevo). Ignora filas con payload
 * corrupto en vez de romper el tick entero.
 */
export async function obtenerPayloadsPorTipo(
  db: SQLite.SQLiteDatabase,
  tipo: TipoEventoSync,
): Promise<Record<string, unknown>[]> {
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM outbox WHERE tipo = ?',
    [tipo],
  );
  const payloads: Record<string, unknown>[] = [];
  for (const row of rows) {
    try {
      payloads.push(JSON.parse(row.payload) as Record<string, unknown>);
    } catch {
      // Fila ilegible: se ignora — la semilla es best-effort, no una fuente de verdad.
    }
  }
  return payloads;
}

export interface EventoOutboxTsPayload {
  ts: string;
  payload: Record<string, unknown>;
}

/**
 * `ts` del sobre + payload de todos los eventos de un tipo que siguen en el outbox (en
 * cualquier estado, no solo `pendiente`) — variante de `obtenerPayloadsPorTipo` que además
 * expone el `ts` de encolado. Lo usa el detector de huecos del spike (`use-gps-operativo.ts`,
 * hallazgo de revisión A1) para reconstruir la ventana MEDIDA desde lo persistido en vez de
 * un `useRef` en memoria que el headless task nunca alimenta (no hay hook, no hay React): sin
 * esto, un chofer que mata la app a mitad de turno y la reabre deja `detectarHuecos`
 * evaluando solo el tramo en vivo final, reportando "0 huecos" sobre una ventana que en
 * realidad no se midió. El `ts` del sobre sirve de fallback cuando el payload no trae
 * `tsFix` (ver `resolverTsFix`, `@quivo/shared`). Ignora filas con payload corrupto en vez de
 * romper la lectura entera.
 */
export async function obtenerEventosPorTipo(
  db: SQLite.SQLiteDatabase,
  tipo: TipoEventoSync,
): Promise<EventoOutboxTsPayload[]> {
  const rows = await db.getAllAsync<{ ts: string; payload: string }>(
    'SELECT ts, payload FROM outbox WHERE tipo = ?',
    [tipo],
  );
  const eventos: EventoOutboxTsPayload[] = [];
  for (const row of rows) {
    try {
      eventos.push({ ts: row.ts, payload: JSON.parse(row.payload) as Record<string, unknown> });
    } catch {
      // Fila ilegible: se ignora, igual que `obtenerPayloadsPorTipo`.
    }
  }
  return eventos;
}

export async function marcarEnviados(db: SQLite.SQLiteDatabase, eventIds: string[]): Promise<void> {
  await actualizarEstado(db, eventIds, 'enviado');
}

/** El servidor acusó estos `event_id` puntuales (202 de QUI-240) — quedan sincronizados de
 * verdad. Los que no vengan en el acuse (rechazados o simplemente no llegaron a procesarse)
 * quedan como estaban para reintentar en el próximo lote. */
export async function marcarAcusados(db: SQLite.SQLiteDatabase, eventIds: string[]): Promise<void> {
  await actualizarEstado(db, eventIds, 'acusado');
}

/** Reintento tras fallo de red/timeout del lote completo: vuelve `enviado` -> `pendiente`
 * para que el próximo ciclo de sync los tome de nuevo (con backoff, ver QUI-240). */
export async function revertirAPendiente(
  db: SQLite.SQLiteDatabase,
  eventIds: string[],
): Promise<void> {
  await actualizarEstado(db, eventIds, 'pendiente');
}

/** Limpieza de eventos ya acusados y viejos — evita que el outbox crezca sin límite en un
 * dispositivo que queda encendido semanas. No borra nada que no esté `acusado`. */
export async function purgarAcusadosAntesDe(
  db: SQLite.SQLiteDatabase,
  antesDe: Date,
): Promise<number> {
  const result = await db.runAsync("DELETE FROM outbox WHERE estado = 'acusado' AND ts < ?", [
    antesDe.toISOString(),
  ]);
  return result.changes;
}

async function actualizarEstado(
  db: SQLite.SQLiteDatabase,
  eventIds: string[],
  estado: EstadoOutbox,
): Promise<void> {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => '?').join(',');
  await db.runAsync(`UPDATE outbox SET estado = ? WHERE event_id IN (${placeholders})`, [
    estado,
    ...eventIds,
  ]);
}

function toEventoOutboxRow(row: OutboxRowCruda): EventoOutboxRow {
  return {
    eventId: row.event_id,
    deviceId: row.device_id,
    ts: row.ts,
    tipo: row.tipo as TipoEventoSync,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    estado: row.estado as EstadoOutbox,
  };
}
