import * as Sentry from '@sentry/react-native';
import * as SQLite from 'expo-sqlite';

const MKDIRS_RACE = "Couldn't create directory";

/**
 * `SQLite.openDatabaseAsync` con un reintento. expo-sqlite 16.0.10 crea el directorio `SQLite/`
 * con un check-then-mkdirs sin lock sobre Dispatchers.IO: en el primer arranque tras instalar,
 * dos aperturas concurrentes (outbox + paquete del día) pueden pisarse y una rechaza con
 * "Couldn't create directory ... Path already points to a non-normal file". Al reintentar el
 * directorio ya existe. El reintento es estrecho a propósito: el Constructor nativo cachea la
 * NativeDatabase antes de `initAsync`, así que reintentar tras un fallo de init/sqlite3_open
 * devolvería el handle zombi cacheado; cualquier otro error se propaga sin reintentar.
 */
export async function abrirSqlite(
  path: string,
  options?: SQLite.SQLiteOpenOptions,
): Promise<SQLite.SQLiteDatabase> {
  try {
    return await SQLite.openDatabaseAsync(path, options);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(MKDIRS_RACE)) throw error;
    Sentry.addBreadcrumb({
      category: 'sqlite',
      level: 'warning',
      message: 'Reintento por la carrera de mkdirs del primer arranque',
      data: { path },
    });
    return await SQLite.openDatabaseAsync(path, options);
  }
}
