import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// Mismo motivo que `outbox.test.ts`: importar `./outbox` arrastra `expo-sqlite`/`expo-crypto`/
// `@sentry/react-native` a nivel de módulo, que rompen bajo vitest/Node si no se mockean —
// aunque este archivo no ejercite NINGUNA de esas tres (todo acá corre contra `node:sqlite`
// real, no contra `expo-sqlite`).
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('@sentry/react-native', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { DDL_OUTBOX, MIGRACIONES_COLUMNAS_OUTBOX, construirAgregarColumna, faltaColumna } from './outbox';

/**
 * Guard sistémico del Hallazgo 1 (CRÍTICO, code review): ejecuta el DDL REAL de
 * `abrirOutboxNueva` contra SQLite de verdad (`node:sqlite`, `DatabaseSync` — disponible desde
 * Node 24, que es lo que corre este repo, ver `node --version`), sin mockear nada del motor
 * SQL. Nada de esto pasa por `expo-sqlite` (no hay build nativo bajo vitest), pero el SQL que
 * SQLite ejecuta es exactamente el mismo — `DDL_OUTBOX`/`MIGRACIONES_COLUMNAS_OUTBOX` son las
 * mismas constantes que usa `abrirOutboxNueva` en producción.
 *
 * El bug de producción: `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS enviado_at TEXT;`
 * (sintaxis de Postgres) vivía en el MISMO `execAsync` que crea las tablas — contra SQLite
 * 3.45.1 tira `near "EXISTS": syntax error`, y como estaba en el bloque de creación, CADA
 * `abrirOutbox()` fallaba: `registrarPuntoGps` no escribía un solo punto GPS.
 */
describe('DDL real del outbox contra SQLite de verdad (Hallazgo 1, CRÍTICO)', () => {
  function columnasDe(db: DatabaseSync, tabla: string): string[] {
    const filas = db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[];
    return filas.map((fila) => fila.name);
  }

  function aplicarMigraciones(db: DatabaseSync): void {
    for (const migracion of MIGRACIONES_COLUMNAS_OUTBOX) {
      const columnas = columnasDe(db, migracion.tabla);
      if (faltaColumna(columnas, migracion.columna)) {
        db.exec(construirAgregarColumna(migracion.tabla, migracion.columna, migracion.tipo));
      }
    }
  }

  it('reproduce el bug: `ADD COLUMN IF NOT EXISTS` no es SQLite válido — `near "EXISTS": syntax error`', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(DDL_OUTBOX);
    // Este es el SQL VIEJO, textual, que vivía en `abrirOutboxNueva` antes del fix — reproduce
    // el error de producción letra por letra contra SQLite real, sin mocks.
    expect(() =>
      db.exec('ALTER TABLE outbox ADD COLUMN IF NOT EXISTS enviado_at TEXT;'),
    ).toThrow(/near "EXISTS": syntax error/i);
    db.close();
  });

  it('DDL_OUTBOX + agregarColumnasFaltantes (código nuevo) NO revienta — crea la tabla con la columna', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => {
      db.exec(DDL_OUTBOX);
      aplicarMigraciones(db);
    }).not.toThrow();
    expect(columnasDe(db, 'outbox')).toContain('enviado_at');
    expect(columnasDe(db, 'sync_lease')).toEqual(
      expect.arrayContaining(['id', 'owner', 'expira_at']),
    );
    db.close();
  });

  it('abre la base DOS VECES sobre el mismo archivo — idempotencia (no "duplicate column name")', () => {
    const archivo = join(tmpdir(), `quivo-outbox-ddl-test-${Date.now()}-${Math.random()}.db`);
    try {
      const primeraApertura = new DatabaseSync(archivo);
      primeraApertura.exec(DDL_OUTBOX);
      aplicarMigraciones(primeraApertura);
      expect(columnasDe(primeraApertura, 'outbox')).toContain('enviado_at');
      primeraApertura.close();

      // Segunda apertura sobre el MISMO archivo: `sacar el IF NOT EXISTS sin más` (el fix
      // insuficiente que el encargo advierte) rompería acá con "duplicate column name" —
      // `agregarColumnasFaltantes` no debe intentar el ALTER de nuevo.
      const segundaApertura = new DatabaseSync(archivo);
      expect(() => {
        segundaApertura.exec(DDL_OUTBOX);
        aplicarMigraciones(segundaApertura);
      }).not.toThrow();
      expect(columnasDe(segundaApertura, 'outbox')).toContain('enviado_at');
      segundaApertura.close();
    } finally {
      if (existsSync(archivo)) unlinkSync(archivo);
    }
  });

  it('actualiza una base con el esquema ANTERIOR a esta rama (sin enviado_at) sin perder datos', () => {
    const db = new DatabaseSync(':memory:');
    // Esquema pre-Entrega-2: `outbox` tal como la dejaba una instalación con una versión
    // anterior de la app — sin `enviado_at`, con una fila real ya escrita.
    db.exec(`
      CREATE TABLE outbox (
        event_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        tipo TEXT NOT NULL,
        payload TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente'
      );
      CREATE INDEX outbox_estado_idx ON outbox(estado);
    `);
    db.exec(
      "INSERT INTO outbox (event_id, device_id, ts, tipo, payload, estado) " +
        "VALUES ('e1', 'd1', '2026-01-01T00:00:00.000Z', 'gps_point', '{}', 'enviado')",
    );
    expect(columnasDe(db, 'outbox')).not.toContain('enviado_at');

    // El mismo camino que corre `abrirOutboxNueva` en una apertura posterior: `DDL_OUTBOX` es
    // todo `IF NOT EXISTS` (no toca la tabla existente) y la migración agrega la columna sola.
    db.exec(DDL_OUTBOX);
    aplicarMigraciones(db);

    expect(columnasDe(db, 'outbox')).toContain('enviado_at');
    const fila = db.prepare('SELECT event_id, enviado_at FROM outbox WHERE event_id = ?').get('e1') as {
      event_id: string;
      enviado_at: string | null;
    };
    // La fila preexistente sobrevive la migración — `ADD COLUMN` nunca borra datos, la columna
    // nueva llega NULL para las filas viejas (mismo criterio que `COALESCE(enviado_at, ts)` en
    // `construirRecuperarEnviadosHuerfanos` ya asume).
    expect(fila.event_id).toBe('e1');
    expect(fila.enviado_at).toBeNull();
    db.close();
  });

  it('no repite el ALTER si la columna ya existe — evita "duplicate column name"', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(DDL_OUTBOX);
    aplicarMigraciones(db);
    expect(() => aplicarMigraciones(db)).not.toThrow();
    db.close();
  });
});
