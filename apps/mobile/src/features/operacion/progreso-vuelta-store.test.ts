import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('../../db/outbox', () => ({
  conReintentoSiHandleMuerto: async (db: unknown, op: (d: unknown) => Promise<unknown>) => op(db),
}));
vi.mock('../../db/vuelta-actual-local', () => ({
  leerDesignacionOrdenLocal: vi.fn().mockResolvedValue(null),
}));

import { leerProgresoVuelta, puntosDeLaFaseActual, registrarPasoEnVuelta, rumboConfiable } from './progreso-vuelta-store';
import { faseDe, FIXES_FALLBACK_REGRESO } from './fase-vuelta';

// SQLite mínima en memoria: una fila por clave con `estado_json` y `version` (lo que usa el almacén).
function dbFalsa() {
  const filas = new Map<string, { estado_json: string; version: number; actualizado_ms?: number }>();
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
const sobreIda = { lng: 0.001, lat: 0, heading: 90 };
const sobreRegreso = { lng: 0.001, lat: 0.001, heading: 270 };

describe('puntosDeLaFaseActual', () => {
  let db: ReturnType<typeof dbFalsa>;
  beforeEach(() => {
    db = dbFalsa();
  });
  // `heading` = rumbo GPS del vehículo (10 m/s); `undefined` = detenido, sin rumbo confiable.
  const consultar = (
    fix: { lng: number; lat: number; accuracy?: number; heading?: number },
    lista = puntos,
    velocidad = 10,
  ) =>
    puntosDeLaFaseActual(db as never, 's1', lista, geometria, fix, {
      lat: fix.lat,
      lng: fix.lng,
      ts: 0,
      speed: velocidad,
      heading: fix.heading ?? -1,
      accuracy: fix.accuracy ?? 5,
    });

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
      // En fase ida pero yendo en sentido de regreso: la compuerta deja terminal y retorno (exento).
      expect(ids(await consultar(sobreRegreso))).toEqual(['sr', 'h']);
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
    expect(ids(await consultar(sobreRegreso))).toEqual(['sr', 'h']);
  });

  it('rumbo opuesto al de la calle compartida (o sin velocidad) no cambia la fase', async () => {
    const contraMano = { ...sobreRegreso, heading: 90 };
    for (let i = 0; i < 2 * FIXES_FALLBACK_REGRESO; i++) await consultar(contraMano);
    for (let i = 0; i < 2 * FIXES_FALLBACK_REGRESO; i++) await consultar(sobreRegreso, puntos, 0.5);
    expect(ids(await consultar(sobreRegreso, puntos, 0.5))).toEqual(['sr', 'i1', 'h']);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('compuerta de sentido: yendo en contra del trazado de un PC de ida no se detecta; lento sí', async () => {
    // i1 está sobre la ida (hacia el este): con rumbo oeste se descarta (terminal y retorno quedan exentos).
    const oesteSobreIda = { ...sobreIda, heading: 270 };
    expect(ids(await consultar(oesteSobreIda))).toEqual(['sr', 'h']);
    expect(ids(await consultar(oesteSobreIda, puntos, 0.5))).toEqual(['sr', 'i1', 'h']);
  });

  it('regreso con el retorno ya pasado: fixes sobre la ida exclusiva NO devuelven a ida', async () => {
    await registrarPasoEnVuelta(db as never, 's1', 'sr', 'k1', puntos);
    await registrarPasoEnVuelta(db as never, 's1', 'h', 'k2', puntos);
    for (let i = 0; i < 2 * FIXES_FALLBACK_REGRESO; i++) {
      expect(ids(await consultar(sobreIda))).toEqual(['sr', 'r1']);
    }
  });

  it('regreso por fallback (retorno sin pasar): fixes sobre la ida exclusiva y en su sentido devuelven a ida', async () => {
    for (let i = 0; i < FIXES_FALLBACK_REGRESO; i++) await consultar(sobreRegreso);
    expect(ids(await consultar(sobreRegreso))).toEqual(['sr', 'r1']);
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      expect(ids(await consultar(sobreIda))).toEqual(['sr', 'r1']);
    }
    expect(ids(await consultar(sobreIda))).toEqual(['sr', 'i1', 'h']);
  });
});

describe('fase a medianoche', () => {
  const filaAyer = (hace: number) => ({
    estado_json: JSON.stringify({ pasados: ['sr'], vueltasCompletadas: 3, fase: 'regreso' }),
    version: 4,
    actualizado_ms: Date.now() - hace,
  });

  it('sin fila del día hereda la fase del día anterior si se escribió hace menos de 2 h (solo la fase)', async () => {
    const db = dbFalsa();
    db.filas.set('s1:2026-10-14', filaAyer(60 * 60 * 1000));
    const hoy = await leerProgresoVuelta(db as never, 's1', '2026-10-15');
    expect(faseDe(hoy)).toBe('regreso');
    expect(hoy.vueltasCompletadas).toBe(0);
    expect(hoy.pasados).toEqual([]);
    // Con fila propia del día, manda la suya.
    db.filas.set('s1:2026-10-15', { estado_json: JSON.stringify({ pasados: [] }), version: 1 });
    expect(faseDe(await leerProgresoVuelta(db as never, 's1', '2026-10-15'))).toBe('ida');
  });

  it('sesión olvidada de ayer (fila previa de hace más de 2 h): arranca en ida', async () => {
    const db = dbFalsa();
    db.filas.set('s1:2026-10-14', filaAyer(3 * 60 * 60 * 1000));
    expect(faseDe(await leerProgresoVuelta(db as never, 's1', '2026-10-15'))).toBe('ida');
  });
});

describe('rumboConfiable', () => {
  const f = (ts: number, lng: number) => ({ lat: 0, lng, ts, speed: 10, heading: -1, accuracy: 5 });

  it('calcula bearing entre fixes cercanos en el tiempo; pasados 30 s descarta la referencia', () => {
    rumboConfiable('r1', f(0, 0));
    expect(rumboConfiable('r1', f(1000, 0.001))).toBeCloseTo(90, 0);
    rumboConfiable('r1', f(2000, 0.002));
    expect(rumboConfiable('r1', f(2000 + 31_000, 0.01))).toBeNull();
  });

  it('solo conserva la sesión vigente: al ver otra sesión descarta el estado de la anterior', () => {
    rumboConfiable('a', f(0, 0));
    rumboConfiable('b', f(500, 0));
    expect(rumboConfiable('a', f(1000, 0.001))).toBeNull(); // estado de "a" podado: primer fix otra vez
  });
});
