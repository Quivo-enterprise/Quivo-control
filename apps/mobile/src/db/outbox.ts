import * as SQLite from 'expo-sqlite';

/**
 * Outbox local (RF-67..73, doc técnico §6): estructura alineada con `EventoSyncSchema`
 * de `@quivo/shared`. En este spike solo se usa para persistir los puntos GPS medidos —
 * el envío real por lotes contra la API es QUI-240.
 */
export interface OutboxRow {
  eventId: string;
  deviceId: string;
  ts: string;
  tipo: string;
  payload: string;
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
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

export async function insertarEventoOutbox(
  db: SQLite.SQLiteDatabase,
  fila: OutboxRow,
): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO outbox (event_id, device_id, ts, tipo, payload, synced) VALUES (?, ?, ?, ?, ?, 0)',
    [fila.eventId, fila.deviceId, fila.ts, fila.tipo, fila.payload],
  );
}

export async function contarEventosOutbox(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) as total FROM outbox');
  return row?.total ?? 0;
}
