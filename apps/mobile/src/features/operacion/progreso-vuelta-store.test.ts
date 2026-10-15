import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('../../db/outbox', () => ({
  conReintentoSiHandleMuerto: async (db: unknown, op: (d: unknown) => Promise<unknown>) => op(db),
}));
vi.mock('../../db/vuelta-actual-local', () => ({
  leerDesignacionOrdenLocal: vi.fn().mockResolvedValue(null),
}));

import { leerProgresoVuelta, puntosDeLaFaseActual, registrarPasoEnVuelta } from './progreso-vuelta-store';
import { faseDe, FIXES_FALLBACK_REGRESO } from './fase-vuelta';

// SQLite mínima en memoria: una fila por clave con `estado_json` y `version` (lo que usa el almacén).
function dbFalsa() {
  const filas = new Map<string, { estado_json: string; version: number }>();
  const db = {
    filas,
    getFirstAsync: vi.fn(async (_sql: string, [clave]: [string]) => filas.get(clave) ?? null),
    runAsync: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('INSERT')) {
        const [clave, estado_json, version] = params as [string, string, number];
        filas.set(clave, { estado_json, version });
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE')) {
        const [estado_json, version, , clave] = params as [string, number, number, string];
        filas.set(clave, { estado_json, version });
        return { changes: 1 };
      }
      return { changes: 0 };
    }),
  };
  return db;
}

type Rol = NonNullable<PuntoControlPaquete['rol']>;
const pc = (id: string, orden: number, rol: Rol | null = null): PuntoControlPaquete => ({
  id,
  orden,
  coord: { type: 'Point', coordinates: [orden * 0.001, 0] },
  radioToleranciaM: 30,
  obligatorio: true,
  rol,
});
const puntos = [pc('sr', 0, 'terminal'), pc('i1', 1), pc('h', 2, 'retorno'), pc('r1', 3)];
const ids = (l: PuntoControlPaquete[]) => l.map((p) => p.id);

// Ida por y=0 hacia el este; regreso por y=0.001 (≈111 m al norte) hacia el oeste.
const geometria: [number, number][] = [[0, 0], [0.002, 0], [0.002, 0.001], [0, 0.001], [0, 0]];
const sobreIda = { lng: 0.001, lat: 0 };
const sobreRegreso = { lng: 0.001, lat: 0.001 };

describe('puntosDeLaFaseActual', () => {
  let db: ReturnType<typeof dbFalsa>;
  beforeEach(() => {
    db = dbFalsa();
  });
  const consultar = (fix: { lng: number; lat: number; accuracy?: number }, lista = puntos) =>
    puntosDeLaFaseActual(db as never, 's1', lista, geometria, fix);

  it('sin PC retorno devuelve la misma lista sin tocar SQLite', async () => {
    const sinRoles = [pc('a', 0), pc('b', 1)];
    expect(await consultar(sobreRegreso, sinRoles)).toBe(sinRoles);
    expect(db.getFirstAsync).not.toHaveBeenCalled();
  });

  it('en ida detecta solo la ida (terminal + intermedios + retorno)', async () => {
    expect(ids(await consultar(sobreIda))).toEqual(['sr', 'i1', 'h']);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('pasar el retorno (registrarPasoEnVuelta) persiste el regreso y lo ven los siguientes fixes', async () => {
    await registrarPasoEnVuelta(db as never, 's1', 'sr', 'k1', puntos);
    await registrarPasoEnVuelta(db as never, 's1', 'h', 'k2', puntos);
    expect(ids(await consultar(sobreIda))).toEqual(['sr', 'r1']);
  });

  it('fallback: FIXES_FALLBACK_REGRESO fixes sobre el regreso (lejos de la ida) lo persisten', async () => {
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      expect(ids(await consultar(sobreRegreso))).toEqual(['sr', 'i1', 'h']);
    }
    expect(ids(await consultar(sobreRegreso))).toEqual(['sr', 'r1']);
    const fila = [...db.filas.values()][0]!;
    expect(faseDe(JSON.parse(fila.estado_json))).toBe('regreso');
    // Otro contexto (headless) lee el mismo estado persistido y coincide.
    expect(ids(await consultar(sobreIda))).toEqual(['sr', 'r1']);
  });

  it('fixes sobre la ida entre medio reinician el contador', async () => {
    await consultar(sobreRegreso);
    await consultar(sobreRegreso);
    await consultar(sobreIda);
    expect(ids(await consultar(sobreRegreso))).toEqual(['sr', 'i1', 'h']);
  });

  it('regreso: fixes sobre la ida exclusiva (lejos del regreso) devuelven a ida', async () => {
    await registrarPasoEnVuelta(db as never, 's1', 'sr', 'k1', puntos);
    await registrarPasoEnVuelta(db as never, 's1', 'h', 'k2', puntos);
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      expect(ids(await consultar(sobreIda))).toEqual(['sr', 'r1']);
    }
    expect(ids(await consultar(sobreIda))).toEqual(['sr', 'i1', 'h']);
  });
});

describe('fase a medianoche', () => {
  it('sin fila del día hereda la fase del día anterior (solo la fase, no las vueltas)', async () => {
    const db = dbFalsa();
    db.filas.set('s1:2026-10-14', {
      estado_json: JSON.stringify({ pasados: ['sr'], vueltasCompletadas: 3, fase: 'regreso' }),
      version: 4,
    });
    const hoy = await leerProgresoVuelta(db as never, 's1', '2026-10-15');
    expect(faseDe(hoy)).toBe('regreso');
    expect(hoy.vueltasCompletadas).toBe(0);
    expect(hoy.pasados).toEqual([]);
    // Con fila propia del día, manda la suya.
    db.filas.set('s1:2026-10-15', { estado_json: JSON.stringify({ pasados: [] }), version: 1 });
    expect(faseDe(await leerProgresoVuelta(db as never, 's1', '2026-10-15'))).toBe('ida');
  });
});
