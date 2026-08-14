import * as SQLite from 'expo-sqlite';
import { PaqueteDiaSchema, type PaqueteDia } from '@quivo/shared';

/**
 * Paquete del día (RF-68/73, QUI-236): una sola fila — el chofer solo tiene una asignación
 * operativa activa a la vez (QUI-235), así que cada descarga nueva reemplaza a la anterior,
 * no hace falta historial local.
 */
export async function abrirPaqueteDiaDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('quivo-paquete-dia.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS paquete_dia (
      asignacion_id TEXT PRIMARY KEY,
      vence_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      descargado_en TEXT NOT NULL
    );
  `);
  return db;
}

export async function guardarPaqueteDia(
  db: SQLite.SQLiteDatabase,
  paquete: PaqueteDia,
): Promise<void> {
  // DELETE + INSERT en una transacción (hallazgo de revisión A2): sin esto, un crash o kill
  // del proceso justo entre las dos sentencias podía dejar la tabla vacía o con un payload a
  // medio escribir — y ese payload corrupto tumbaba, antes de este fix, el `JSON.parse` sin
  // protección de `obtenerPaqueteDiaLocal` de abajo.
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM paquete_dia');
    await db.runAsync(
      'INSERT INTO paquete_dia (asignacion_id, vence_at, payload, descargado_en) VALUES (?, ?, ?, ?)',
      [paquete.asignacion.id, paquete.asignacion.venceAt, JSON.stringify(paquete), new Date().toISOString()],
    );
  });
}

export interface PaqueteDiaLocal {
  paquete: PaqueteDia;
  vencido: boolean;
  descargadoEn: string;
}

export async function obtenerPaqueteDiaLocal(
  db: SQLite.SQLiteDatabase,
): Promise<PaqueteDiaLocal | null> {
  const row = await db.getFirstAsync<{
    payload: string;
    vence_at: string;
    descargado_en: string;
  }>('SELECT payload, vence_at, descargado_en FROM paquete_dia LIMIT 1');
  if (!row) return null;

  // `JSON.parse` sin protección tumbaba TODO el tick headless del turno (hallazgo de revisión
  // A2): un `throw` acá lo come el `try/catch` de `tareaHeadlessUbicacion`
  // (`gps/headless-task.ts`), y con la app terminada nadie ve el `console.error` — cada punto
  // GPS del resto del turno se perdía en silencio. Un payload corrupto ahora cae al mismo
  // camino ya soportado que un paquete ausente: `obtenerContextoUbicacionPersistido` sigue
  // registrando `gps_point` sin puntos de control (ver su comentario en `headless-task.ts`).
  let payloadCrudo: unknown;
  try {
    payloadCrudo = JSON.parse(row.payload);
  } catch {
    return null;
  }

  const parsed = PaqueteDiaSchema.safeParse(payloadCrudo);
  if (!parsed.success) return null;

  return {
    paquete: parsed.data,
    vencido: new Date(row.vence_at).getTime() <= Date.now(),
    descargadoEn: row.descargado_en,
  };
}
