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

import {
  COTA_SANIDAD_LEASE_MS,
  DDL_OUTBOX,
  MIGRACIONES_COLUMNAS_OUTBOX,
  TTL_LEASE_DRENAJE_MS,
  construirAdquirirLease,
  construirAgregarColumna,
  esErrorColumnaDuplicada,
  faltaColumna,
} from './outbox';

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

  /**
   * R2 (hallazgo de `/codex-debug verify-fix` sobre `757af20`, ALTO): `PRAGMA table_info` +
   * `ALTER TABLE` no son atómicos ENTRE SÍ, y `abrirOutbox()` puede correr en dos contextos JS
   * a la vez (headless vs. foreground) sobre el MISMO archivo `quivo-outbox.db`. Si los dos
   * leen el `PRAGMA` (ven la columna ausente) ANTES de que cualquiera corra su `ALTER TABLE`,
   * el segundo `ALTER TABLE` en llegar choca con "duplicate column name" — aunque el guard de
   * `faltaColumna` sea correcto en el instante en que cada uno lo consultó. Reproduce esa
   * ventana contra SQLite REAL (no una simulación en JS del predicado) intercalando dos
   * "aperturas": ambas leen el PRAGMA primero, y recién después la primera corre su ALTER y la
   * segunda el suyo — el mismo orden de eventos que produce el bug en producción.
   */
  it('dos aperturas "concurrentes" (la segunda ALTER llega tras el PRAGMA de la primera): ninguna falla, la columna queda una sola vez', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(DDL_OUTBOX); // DDL base — `enviado_at` NO está acá, viene de la migración aparte.
    const migracion = MIGRACIONES_COLUMNAS_OUTBOX[0]!;

    // Los dos contextos leen el PRAGMA ANTES de que cualquiera intente el ALTER — la ventana de
    // no-atomicidad que R2 describe. Los dos ven la columna ausente.
    const columnasContexto1 = columnasDe(db, migracion.tabla);
    const columnasContexto2 = columnasDe(db, migracion.tabla);
    expect(faltaColumna(columnasContexto1, migracion.columna)).toBe(true);
    expect(faltaColumna(columnasContexto2, migracion.columna)).toBe(true);

    // Contexto 1 gana la carrera y agrega la columna — sin el try/catch, esto no es el punto
    // bajo prueba, así que corre directo.
    db.exec(construirAgregarColumna(migracion.tabla, migracion.columna, migracion.tipo));

    // Contexto 2 corre SU `ALTER TABLE` sobre la misma columna que el contexto 1 ya agregó —
    // reproduce EXACTAMENTE el `try { execAsync(...) } catch { if (!esErrorColumnaDuplicada)
    // throw }` de `agregarColumnasFaltantes` en `outbox.ts` (código de producción, no
    // reimplementado acá: la función interna no es exportable porque toma un
    // `SQLite.SQLiteDatabase` de `expo-sqlite`, no un `DatabaseSync` de `node:sqlite` — mismo
    // motivo que el resto de este archivo prueba el SQL puro contra el motor real en vez de
    // `abrirOutboxNueva` completa).
    expect(() => {
      try {
        db.exec(construirAgregarColumna(migracion.tabla, migracion.columna, migracion.tipo));
      } catch (error) {
        if (!esErrorColumnaDuplicada(error)) throw error;
      }
    }).not.toThrow();

    const columnasFinal = columnasDe(db, 'outbox');
    expect(columnasFinal.filter((columna) => columna === migracion.columna)).toHaveLength(1);
    db.close();
  });
});

/**
 * Guard sistémico del Hallazgo 4 (code review, BAJO — reloj de pared sin cota superior en
 * `adquirirLease`): corre el UPSERT REAL de `construirAdquirirLease` contra SQLite de verdad
 * (`node:sqlite`), no una simulación en JS del predicado — el `ON CONFLICT ... DO UPDATE ...
 * WHERE` con dos condiciones (`<=` y `>`) es sintaxis delicada, vale la pena probarla contra el
 * motor real, no solo contra `outbox.test.ts` (que sí prueba la semántica con una tabla en
 * memoria).
 */
describe('DDL real del lease (`sync_lease`) contra SQLite de verdad (Hallazgo 4, BAJO)', () => {
  function crearTablaLease(db: DatabaseSync): void {
    db.exec(DDL_OUTBOX); // incluye `CREATE TABLE IF NOT EXISTS sync_lease`
  }

  function adquirir(db: DatabaseSync, token: string, ahoraMs: number, ttlMs: number): boolean {
    const { sql, params } = construirAdquirirLease('drenaje-outbox', token, ahoraMs, ahoraMs + ttlMs);
    db.prepare(sql).run(...params);
    const fila = db.prepare('SELECT owner FROM sync_lease WHERE id = ?').get('drenaje-outbox') as
      | { owner: string }
      | undefined;
    return fila?.owner === token;
  }

  it('un lease vigente (reloj estable) NO se libera de más — el UPSERT real respeta el `<=`', () => {
    const db = new DatabaseSync(':memory:');
    crearTablaLease(db);

    expect(adquirir(db, 'contexto-vivo', 0, TTL_LEASE_DRENAJE_MS)).toBe(true);
    // 5s después, reloj estable: sigue tomado.
    expect(adquirir(db, 'otro-contexto', 5_000, TTL_LEASE_DRENAJE_MS)).toBe(false);
    db.close();
  });

  it('salto de reloj hacia atrás mayor a la cota → el UPSERT real libera el lease "del futuro"', () => {
    const db = new DatabaseSync(':memory:');
    crearTablaLease(db);

    // Reloj adelantado 10 minutos al adquirir.
    const relojAdelantadoMs = 10 * 60_000;
    expect(adquirir(db, 'contexto-con-reloj-adelantado', relojAdelantadoMs, TTL_LEASE_DRENAJE_MS)).toBe(
      true,
    );

    // Salta hacia atrás a t=0 real: sin el fix, `WHERE expira_at <= ?` solo (sin la segunda
    // condición) dejaría el lease "tomado" ~10 minutos enteros pese a que nadie lo tiene de
    // verdad. Con la cota (`COTA_SANIDAD_LEASE_MS` = TTL + 60s = 120s), el UPSERT real lo
    // libera igual.
    expect(adquirir(db, 'contexto-nuevo', 0, TTL_LEASE_DRENAJE_MS)).toBe(true);
    db.close();
  });

  it('un salto de reloj CHICO (dentro de la cota) sigue respetando el lease vigente', () => {
    const db = new DatabaseSync(':memory:');
    crearTablaLease(db);

    // Reloj apenas adelantado (30s) al adquirir — `expira_at` = 30_000 + TTL (60s) = 90_000.
    const relojLevementeAdelantadoMs = 30_000;
    expect(
      adquirir(db, 'contexto-vivo', relojLevementeAdelantadoMs, TTL_LEASE_DRENAJE_MS),
    ).toBe(true);

    // Reloj corregido a t=0: `expira_at` (90_000) sigue dentro de la cota de sanidad
    // (0 + COTA_SANIDAD_LEASE_MS = 120_000) — un lease legítimo recién adquirido no debe
    // liberarse de más solo porque el reloj se corrigió un poco.
    expect(90_000).toBeLessThan(COTA_SANIDAD_LEASE_MS);
    expect(adquirir(db, 'otro-contexto', 0, TTL_LEASE_DRENAJE_MS)).toBe(false);
    db.close();
  });
});

/**
 * REDISEÑO (anuncio de puntos de control, code review 2026-09-25): `DDL_OUTBOX` también crea
 * `anuncios_punto_control` (intención durable del anuncio de "llegaste") y `visitas_pendientes`
 * (copia durable del candidato de una visita en curso, bug 5) — antes vivían en un módulo
 * separado (`outbox-ddl.ts`), fusionado acá con el DDL del outbox al integrar la rama de
 * drenado en background. Mismo motivo que el resto del archivo: correrlo contra SQLite real
 * (`node:sqlite`), no contra un mock.
 */
describe('DDL real de anuncios_punto_control y visitas_pendientes contra SQLite de verdad', () => {
  function columnasDe(db: DatabaseSync, tabla: string): string[] {
    const filas = db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[];
    return filas.map((fila) => fila.name);
  }

  function abrirEnMemoria(): DatabaseSync {
    const nueva = new DatabaseSync(':memory:');
    nueva.exec(DDL_OUTBOX);
    return nueva;
  }

  it('crea las cinco tablas esperadas (outbox, sync_lease, anuncios_punto_control, visitas_pendientes)', () => {
    const db = abrirEnMemoria();
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((fila) => (fila as { name: string }).name);
    expect(tablas).toEqual(
      expect.arrayContaining(['outbox', 'sync_lease', 'anuncios_punto_control', 'visitas_pendientes']),
    );
    db.close();
  });

  it('crea los índices esperados (anuncios_punto_control_estado_idx, visitas_pendientes_sesion_idx)', () => {
    const db = abrirEnMemoria();
    const indices = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((fila) => (fila as { name: string }).name);
    expect(indices).toEqual(
      expect.arrayContaining(['anuncios_punto_control_estado_idx', 'visitas_pendientes_sesion_idx']),
    );
    db.close();
  });

  it('visitas_pendientes tiene exactamente las columnas que db/outbox.ts espera (VisitaPendienteRow espejado en snake_case)', () => {
    const db = abrirEnMemoria();
    const columnas = columnasDe(db, 'visitas_pendientes').sort();
    expect(columnas).toEqual(
      [
        'actualizado_ts',
        'candidato_lat',
        'candidato_lng',
        'candidato_ts_fix_ms',
        'clave',
        'distancia_entrada_m',
        'fixes_dentro_sin_confirmar',
        'min_distancia_m',
        'pasadas_previas',
        'punto_control_id',
        'radio_tolerancia_m',
        'sesion_id',
        'ultimo_emitido_ms',
      ].sort(),
    );
    db.close();
  });

  it('visitas_pendientes: clave es PRIMARY KEY (un INSERT con clave duplicada choca, no se duplica silenciosamente)', () => {
    const db = abrirEnMemoria();
    const insertar = db.prepare(`
      INSERT INTO visitas_pendientes (
        clave, sesion_id, punto_control_id, pasadas_previas, radio_tolerancia_m,
        min_distancia_m, distancia_entrada_m, candidato_lat, candidato_lng,
        candidato_ts_fix_ms, ultimo_emitido_ms, fixes_dentro_sin_confirmar, actualizado_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const fila = ['sesion-1:pc-1', 'sesion-1', 'pc-1', 0, 150, 10, 10, -17.78, -63.18, 1000, 0, 0, '2026-09-11T00:00:00.000Z'];
    insertar.run(...fila);
    expect(() => insertar.run(...fila)).toThrow();
    db.close();
  });

  it('anuncios_punto_control nace con estado por default "programado" (nunca "pendiente" sin reclamo explícito)', () => {
    const db = abrirEnMemoria();
    db.exec("INSERT INTO anuncios_punto_control (clave, ts) VALUES ('c1', '2026-09-25T00:00:00.000Z')");
    const fila = db.prepare('SELECT estado, intentos, ultimo_intento_ts FROM anuncios_punto_control WHERE clave = ?')
      .get('c1') as { estado: string; intentos: number; ultimo_intento_ts: string | null };
    expect(fila).toEqual({ estado: 'programado', intentos: 0, ultimo_intento_ts: null });
    db.close();
  });

  /**
   * FIX POST-REVISIÓN (hallazgo 1, code review del anuncio de puntos de control): las 7
   * columnas nuevas de `anuncios_punto_control` (estado/motivo/sesion_id/punto_control_id/
   * pasada/intentos/ultimo_intento_ts) llegan por `MIGRACIONES_COLUMNAS_OUTBOX` — instalaciones
   * ya en producción con la tabla vieja (2 columnas: clave, ts) las reciben vía el mismo
   * mecanismo genérico `faltaColumna`/`construirAgregarColumna` que usa `enviado_at`.
   */
  it('agrega las 7 columnas nuevas de anuncios_punto_control a una tabla VIEJA (2 columnas) sin lanzar', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE anuncios_punto_control (clave TEXT PRIMARY KEY, ts TEXT NOT NULL)');
    for (const migracion of MIGRACIONES_COLUMNAS_OUTBOX) {
      if (migracion.tabla !== 'anuncios_punto_control') continue;
      const columnas = columnasDe(db, migracion.tabla);
      if (faltaColumna(columnas, migracion.columna)) {
        expect(() =>
          db.exec(construirAgregarColumna(migracion.tabla, migracion.columna, migracion.tipo)),
        ).not.toThrow();
      }
    }
    expect(columnasDe(db, 'anuncios_punto_control').sort()).toEqual(
      ['clave', 'estado', 'intentos', 'motivo', 'pasada', 'punto_control_id', 'sesion_id', 'ts', 'ultimo_intento_ts'].sort(),
    );
    // Fila vieja sobrevive con los defaults correctos — nunca "pendiente" fantasma tras migrar.
    db.exec("INSERT INTO anuncios_punto_control (clave, ts) VALUES ('vieja:pc-1:1', '2026-09-01T00:00:00.000Z')");
    const fila = db.prepare('SELECT estado, intentos FROM anuncios_punto_control WHERE clave = ?')
      .get('vieja:pc-1:1') as { estado: string; intentos: number };
    expect(fila).toEqual({ estado: 'programado', intentos: 0 });
    db.close();
  });
});
