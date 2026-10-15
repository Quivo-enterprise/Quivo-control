import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import type { PaqueteDia } from '@quivo/shared';
import {
  interpretarFilaPaqueteDia,
  type FilaPaqueteDia,
  type PaqueteDiaLocal,
} from './paquete-dia-local';

export type { PaqueteDiaLocal } from './paquete-dia-local';

/**
 * Paquete del día (RF-68/73, QUI-236): una sola fila — el chofer solo tiene una asignación
 * operativa activa a la vez (QUI-235), así que cada descarga nueva reemplaza a la anterior,
 * no hace falta historial local.
 */
const PAQUETE_DIA_DB_PATH = 'quivo-paquete-dia.db';

/**
 * Mismo singleton a nivel de módulo que `abrirOutbox()` (`db/outbox.ts`) — mismo motivo:
 * la regresión de `expo-sqlite@16.0.10` mata el handle nativo compartido en el primer GC de
 * Hermes sobre un objeto JS viejo de esta base, y el cache del lado Kotlin
 * (`SQLiteModule.kt:110`) sigue sirviendo esa instancia zombi para siempre. Hoy
 * `abrirPaqueteDiaDb()` sobrevive por PURA CASUALIDAD (se llama una sola vez por proceso) —
 * este cambio es profilaxis, no una respuesta a un fallo observado acá.
 */
let paqueteDiaPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let paqueteDiaAbiertoAlgunaVez = false;

async function abrirPaqueteDiaDbNueva(): Promise<SQLite.SQLiteDatabase> {
  const esPrimeraApertura = !paqueteDiaAbiertoAlgunaVez;
  paqueteDiaAbiertoAlgunaVez = true;
  Sentry.addBreadcrumb({
    category: 'sqlite',
    message: `Apertura de ${PAQUETE_DIA_DB_PATH}`,
    level: 'info',
    data: { path: PAQUETE_DIA_DB_PATH, esPrimeraApertura },
  });

  const db = await SQLite.openDatabaseAsync(PAQUETE_DIA_DB_PATH);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS paquete_dia (
      asignacion_id TEXT PRIMARY KEY,
      vence_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      descargado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vuelta_actual_local (
      sesion_id TEXT PRIMARY KEY,
      estado TEXT NOT NULL,
      actualizado_en TEXT NOT NULL
    );
  `);
  return db;
}

export function abrirPaqueteDiaDb(): Promise<SQLite.SQLiteDatabase> {
  if (!paqueteDiaPromise) {
    // H8 (hallazgo de revisión, bajo — mismo fix que `db/outbox.ts`): capturamos la referencia
    // de ESTA promesa antes de instalarla, para que el `.catch` de abajo solo limpie
    // `paqueteDiaPromise` si sigue siendo la promesa vigente. Sin esto, un rechazo TARDÍO de
    // una apertura lenta en vuelo podría anular una conexión buena instalada mientras tanto.
    const promesaEnCurso: Promise<SQLite.SQLiteDatabase> = abrirPaqueteDiaDbNueva().catch((error) => {
      if (paqueteDiaPromise === promesaEnCurso) paqueteDiaPromise = null; // no cachear un rechazo: el próximo intento reintenta
      throw error;
    });
    paqueteDiaPromise = promesaEnCurso;
  }
  return paqueteDiaPromise;
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

/**
 * Lee la fila (única) de `paquete_dia` y la valida contra la asignación de la SESIÓN
 * ACTIVA. Ver `interpretarFilaPaqueteDia` (`db/paquete-dia-local.ts`) para el porqué del
 * parámetro `asignacionIdEsperado` — Hallazgo 1 CRÍTICO del piloto día 1
 * (`docs/plan-v2-app-y-mapa-en-vivo.md` §2.4).
 */
export async function obtenerPaqueteDiaLocal(
  db: SQLite.SQLiteDatabase,
  asignacionIdEsperado: string,
): Promise<PaqueteDiaLocal | null> {
  const row = await db.getFirstAsync<FilaPaqueteDia>(
    'SELECT asignacion_id, payload, vence_at, descargado_en FROM paquete_dia LIMIT 1',
  );
  return interpretarFilaPaqueteDia(row, asignacionIdEsperado);
}
