import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { esErrorColumnaDuplicada, MIGRACIONES_ANUNCIOS_PUNTO_CONTROL_SQL } from './outbox-migraciones';

/**
 * Igual que `outbox-ddl.test.ts`: corre las migraciones contra un motor SQLite real
 * (`node:sqlite`) en vez de mockear `expo-sqlite` — un mock no valida sintaxis SQL ni el mensaje
 * real de "duplicate column name" que `esErrorColumnaDuplicada` necesita reconocer.
 */
describe('MIGRACIONES_ANUNCIOS_PUNTO_CONTROL_SQL — contra SQLite real (node:sqlite)', () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  /** Simula una instalación YA EN PRODUCCIÓN: la tabla vieja, de 2 columnas (Entrega 7), sin
   * ninguna de las columnas nuevas del rediseño. */
  function abrirConTablaVieja(): DatabaseSync {
    const nueva = new DatabaseSync(':memory:');
    nueva.exec('CREATE TABLE anuncios_punto_control (clave TEXT PRIMARY KEY, ts TEXT NOT NULL)');
    return nueva;
  }

  function correrMigraciones(conexion: DatabaseSync): void {
    for (const sql of MIGRACIONES_ANUNCIOS_PUNTO_CONTROL_SQL) {
      try {
        conexion.exec(sql);
      } catch (error) {
        if (!esErrorColumnaDuplicada(error)) throw error;
      }
    }
  }

  function columnas(conexion: DatabaseSync): string[] {
    return conexion
      .prepare('PRAGMA table_info(anuncios_punto_control)')
      .all()
      .map((fila) => (fila as { name: string }).name)
      .sort();
  }

  it('agrega las 7 columnas nuevas a la tabla VIEJA (2 columnas) sin lanzar', () => {
    db = abrirConTablaVieja();
    expect(() => correrMigraciones(db!)).not.toThrow();
    expect(columnas(db)).toEqual(
      [
        'clave',
        'estado',
        'intentos',
        'motivo',
        'pasada',
        'punto_control_id',
        'sesion_id',
        'ts',
        'ultimo_intento_ts',
      ].sort(),
    );
  });

  it('es IDEMPOTENTE: correrlas una SEGUNDA vez sobre la misma conexión ya migrada no lanza', () => {
    db = abrirConTablaVieja();
    correrMigraciones(db);
    expect(() => correrMigraciones(db!)).not.toThrow();
    expect(columnas(db)).toEqual(
      [
        'clave',
        'estado',
        'intentos',
        'motivo',
        'pasada',
        'punto_control_id',
        'sesion_id',
        'ts',
        'ultimo_intento_ts',
      ].sort(),
    );
  });

  it('sobre una tabla NUEVA (ya creada con las 9 columnas del DDL) también es un no-op seguro', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anuncios_punto_control (
        clave TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'programado',
        motivo TEXT,
        sesion_id TEXT,
        punto_control_id TEXT,
        pasada INTEGER,
        intentos INTEGER NOT NULL DEFAULT 0,
        ultimo_intento_ts TEXT
      )
    `);
    expect(() => correrMigraciones(db!)).not.toThrow();
    expect(columnas(db)).toEqual(
      [
        'clave',
        'estado',
        'intentos',
        'motivo',
        'pasada',
        'punto_control_id',
        'sesion_id',
        'ts',
        'ultimo_intento_ts',
      ].sort(),
    );
  });

  it('filas viejas (solo clave/ts) sobreviven la migración con las columnas nuevas en NULL/default', () => {
    db = abrirConTablaVieja();
    db.prepare('INSERT INTO anuncios_punto_control (clave, ts) VALUES (?, ?)').run(
      'sesion-vieja:pc-1:1',
      '2026-09-01T00:00:00.000Z',
    );
    correrMigraciones(db);
    const fila = db
      .prepare('SELECT * FROM anuncios_punto_control WHERE clave = ?')
      .get('sesion-vieja:pc-1:1') as Record<string, unknown>;
    expect(fila.estado).toBe('programado'); // default: nunca debe volver a "reintentarse" como pendiente
    expect(fila.sesion_id).toBeNull();
    expect(fila.punto_control_id).toBeNull();
    expect(fila.pasada).toBeNull();
    expect(fila.intentos).toBe(0);
    expect(fila.ultimo_intento_ts).toBeNull();
  });

  it('reclamar una intención (INSERT OR IGNORE) tras migrar deja la fila en estado "pendiente" con identidad completa', () => {
    db = abrirConTablaVieja();
    correrMigraciones(db);
    db.prepare(
      `INSERT OR IGNORE INTO anuncios_punto_control
         (clave, ts, estado, motivo, sesion_id, punto_control_id, pasada)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?)`,
    ).run('sesion-1:pc-1:1', new Date().toISOString(), 'proximidad', 'sesion-1', 'pc-1', 1);
    const fila = db
      .prepare('SELECT * FROM anuncios_punto_control WHERE clave = ?')
      .get('sesion-1:pc-1:1') as Record<string, unknown>;
    expect(fila).toMatchObject({
      estado: 'pendiente',
      motivo: 'proximidad',
      sesion_id: 'sesion-1',
      punto_control_id: 'pc-1',
      pasada: 1,
    });
  });
});

describe('esErrorColumnaDuplicada', () => {
  it('reconoce el mensaje real de SQLite para ADD COLUMN sobre una columna existente', () => {
    expect(esErrorColumnaDuplicada(new Error('duplicate column name: estado'))).toBe(true);
    expect(esErrorColumnaDuplicada({ message: 'SQLITE_ERROR: duplicate column name: motivo' })).toBe(
      true,
    );
  });

  it('NO confunde otros errores de SQLite con una columna duplicada', () => {
    expect(esErrorColumnaDuplicada(new Error('no such table: anuncios_punto_control'))).toBe(false);
    expect(esErrorColumnaDuplicada(new Error('syntax error'))).toBe(false);
    expect(esErrorColumnaDuplicada('mensaje suelto sin la palabra clave')).toBe(false);
  });
});
