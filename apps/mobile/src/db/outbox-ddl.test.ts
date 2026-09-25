import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { OUTBOX_DDL_SQL } from './outbox-ddl';

/**
 * FIX POST-REVISIÓN (bug 5, requisito explícito del brief — "SQL de SQLite"): otra rama tuvo
 * un bug CRÍTICO por usar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, que no es SQLite válido
 * (SQLite no soporta `IF NOT EXISTS` en `ADD COLUMN`) — un mock de `expo-sqlite` (como el que
 * usan `headless-task.test.ts`/`use-gps-operativo` para no depender del motor nativo) NUNCA
 * habría detectado eso: un mock no valida sintaxis SQL, solo registra la llamada. La única
 * forma de garantizar que el DDL nuevo (`visitas_pendientes`, bug 5) es SQLite válido e
 * IDEMPOTENTE es correrlo contra un motor SQLite real.
 *
 * `node:sqlite` (estable desde Node 22.5, sin flag en Node 24 — ver `node --version` en CI)
 * en vez de `better-sqlite3`: mismo motor SQLite de fondo, cero dependencia nueva que
 * instalar/buildear (aunque `better-sqlite3` ya está en `allowBuilds` de
 * `pnpm-workspace.yaml` como fallback si `node:sqlite` alguna vez no estuviera disponible en
 * el runner de CI).
 *
 * Importa `OUTBOX_DDL_SQL` desde `outbox-ddl.ts` (no desde `outbox.ts`) en vez de copiar el SQL
 * a mano: así este test corre EXACTAMENTE el DDL que `abrirOutboxNueva` (`outbox.ts`, que
 * reimporta la misma constante) ejecuta en el dispositivo — sin una copia que pueda
 * desincronizarse silenciosamente de la real. `outbox-ddl.ts` es un módulo APARTE, sin ningún
 * `import`, a propósito: `outbox.ts` arrastra `expo-sqlite`/`@sentry/react-native`, que a su vez
 * arrastran `react-native` de forma transitiva — un paquete con sintaxis Flow
 * (`import typeof * as ...`) que el parser de vitest no puede procesar. Importar `outbox.ts`
 * directo desde un test rompe la recolección ANTES de correr un solo test (falla el archivo
 * entero, no un test puntual) — confirmado corriendo este archivo contra `outbox.ts` antes del
 * split.
 */
describe('OUTBOX_DDL_SQL — DDL contra SQLite real (node:sqlite)', () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function abrirEnMemoria(): DatabaseSync {
    const nueva = new DatabaseSync(':memory:');
    nueva.exec(OUTBOX_DDL_SQL);
    return nueva;
  }

  it('es SQL válido: corre sin lanzar contra un motor SQLite real', () => {
    expect(() => {
      db = abrirEnMemoria();
    }).not.toThrow();
  });

  it('es IDEMPOTENTE: ejecutarlo una SEGUNDA vez sobre la MISMA conexión no lanza (abriendo dos veces, como pide el brief)', () => {
    db = abrirEnMemoria();
    // Segunda "apertura" contra la misma base — simula un segundo `abrirOutboxNueva` del
    // proceso (reinicio de la app, o el escape hatch `reabrirOutboxTrasFalloNativo`) corriendo
    // el mismo DDL sobre un archivo que YA tiene las tablas.
    expect(() => db!.exec(OUTBOX_DDL_SQL)).not.toThrow();
  });

  it('es idempotente también entre conexiones DISTINTAS al MISMO archivo (dos procesos/reaperturas reales)', () => {
    const path = ':memory:'; // node:sqlite no comparte :memory: entre conexiones — ver el test siguiente para el caso de archivo real
    const primera = new DatabaseSync(path);
    primera.exec(OUTBOX_DDL_SQL);
    primera.close();

    // Un archivo real (no :memory:) SÍ persiste entre aperturas — es el caso que importa en
    // producción (`quivo-outbox.db` en disco). Se usa un archivo temporal para reproducirlo de
    // verdad, no solo simularlo.
    const archivoTemp = join(tmpdir(), `quivo-outbox-ddl-test-${Date.now()}.db`);
    try {
      const conexion1 = new DatabaseSync(archivoTemp);
      conexion1.exec(OUTBOX_DDL_SQL);
      conexion1.close();

      // Segunda apertura del MISMO archivo, DDL corrido de nuevo — el escenario real de
      // `abrirOutbox()` en cada arranque de la app.
      const conexion2 = new DatabaseSync(archivoTemp);
      expect(() => conexion2.exec(OUTBOX_DDL_SQL)).not.toThrow();
      conexion2.close();
    } finally {
      rmSync(archivoTemp, { force: true });
    }
  });

  it('crea las tres tablas esperadas (outbox, anuncios_punto_control, visitas_pendientes)', () => {
    db = abrirEnMemoria();
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((fila) => (fila as { name: string }).name);
    expect(tablas).toEqual(
      expect.arrayContaining(['outbox', 'anuncios_punto_control', 'visitas_pendientes']),
    );
  });

  it('crea los índices esperados (outbox_estado_idx, anuncios_punto_control_estado_idx, visitas_pendientes_sesion_idx)', () => {
    db = abrirEnMemoria();
    const indices = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((fila) => (fila as { name: string }).name);
    expect(indices).toEqual(
      expect.arrayContaining([
        'outbox_estado_idx',
        'anuncios_punto_control_estado_idx',
        'visitas_pendientes_sesion_idx',
      ]),
    );
  });

  it('visitas_pendientes tiene exactamente las columnas que db/outbox.ts espera (VisitaPendienteRow espejado en snake_case)', () => {
    db = abrirEnMemoria();
    const columnas = db
      .prepare('PRAGMA table_info(visitas_pendientes)')
      .all()
      .map((fila) => (fila as { name: string }).name)
      .sort();
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
  });

  it('visitas_pendientes: clave es PRIMARY KEY (un INSERT con clave duplicada choca, no se duplica silenciosamente)', () => {
    db = abrirEnMemoria();
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
  });
});
