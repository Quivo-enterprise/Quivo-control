import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  fila: null as string | null,
  lectura: { ok: true, recorridoId: 'rec-1' } as { ok: true; recorridoId: string | null } | { ok: false },
  run: vi.fn(),
}));
vi.mock('./paquete-dia', () => ({
  abrirPaqueteDiaDb: async () => ({
    getFirstAsync: async () => (m.fila === null ? null : { estado: m.fila }),
    runAsync: m.run,
  }),
}));
vi.mock('./recorrido-actual', () => ({ leerRecorridoActual: async () => m.lectura }));

import {
  interpretarEstadoLocal,
  leerDesignacionOrdenLocal,
  leerEstadoVueltaVigente,
} from './vuelta-actual-local';
import { ESTADO_LOCAL_INICIAL } from '../features/vuelta-actual/vuelta-actual-core';

const V1 = '3f8d3c1e-7a52-4f0b-9a3e-1c2d4e5f6a7b';
const ESPERA = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

function ultimoConDesignacion() {
  return {
    vueltaId: V1,
    numero: 1,
    enEspera: null,
    designacion: {
      varianteId: '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d',
      nombre: 'Vía Molinos',
      designadaEn: '2026-10-14T13:05:00.000Z',
      acuseEn: null,
      tramo: null,
      puntoEspera: {
        id: ESPERA,
        coord: { type: 'Point', coordinates: [-66.15, -17.38] },
        esperaMin: 30,
      },
    },
  };
}

function fila(extra: Record<string, unknown>): string {
  return JSON.stringify({ ultimo: ultimoConDesignacion(), anunciadas: ['a'], ...extra });
}

describe('lectura del cache atada al recorrido (solo lectura)', () => {
  beforeEach(() => {
    m.run.mockReset();
    m.lectura = { ok: true, recorridoId: 'rec-1' };
  });

  it('cache de otro recorrido: se trata como vacío pero NO escribe ni borra', async () => {
    m.fila = fila({ recorridoId: 'rec-viejo' });
    const e = (await leerEstadoVueltaVigente('s'))!;
    expect(e.ultimo).toBeNull();
    expect(e.anunciadas).toEqual(['a']);
    expect(await leerDesignacionOrdenLocal('s')).toBeNull();
    expect(m.run).not.toHaveBeenCalled();
  });

  it('sin recorrido activo: vacío y sin escribir', async () => {
    m.fila = fila({ recorridoId: 'rec-1' });
    m.lectura = { ok: true, recorridoId: null };
    expect((await leerEstadoVueltaVigente('s'))?.ultimo).toBeNull();
    expect(m.run).not.toHaveBeenCalled();
  });

  it('error de lectura del recorrido (ok:false): sin estado ni designación, aunque el cache sea de otro recorrido', async () => {
    m.fila = fila({ recorridoId: 'rec-viejo' });
    m.lectura = { ok: false };
    expect(await leerEstadoVueltaVigente('s')).toBeNull();
    expect(await leerDesignacionOrdenLocal('s')).toBeNull();
    expect(m.run).not.toHaveBeenCalled();
  });

  it('fila vieja sin recorridoId: se adopta como del recorrido actual (sin escribir)', async () => {
    m.fila = fila({});
    const e = (await leerEstadoVueltaVigente('s'))!;
    expect(e.recorridoId).toBe('rec-1');
    expect(e.ultimo?.vueltaId).toBe(V1);
    expect(await leerDesignacionOrdenLocal('s')).toEqual({ puntoEspera: { id: ESPERA } });
    expect(m.run).not.toHaveBeenCalled();
  });
});

describe('interpretarEstadoLocal', () => {
  it('vacío o corrupto -> estado inicial', () => {
    expect(interpretarEstadoLocal(null)).toEqual(ESTADO_LOCAL_INICIAL);
    expect(interpretarEstadoLocal('{no es json')).toEqual(ESTADO_LOCAL_INICIAL);
  });

  it('conserva las claves y descarta un "ultimo" con forma inválida', () => {
    const e = interpretarEstadoLocal(
      JSON.stringify({ ultimo: { x: 1 }, anunciadas: ['a', 5], cerradas: ['b'], cancelacionPendiente: 'c' }),
    );
    expect(e).toEqual({
      ...ESTADO_LOCAL_INICIAL,
      anunciadas: ['a'],
      cerradas: ['b'],
      cancelacionPendiente: 'c',
    });
  });

  it('lee los campos nuevos y descarta valores de tipo inválido', () => {
    const e = interpretarEstadoLocal(
      JSON.stringify({
        actualizadoEn: 123,
        intentosAnuncio: { x: 2, y: 'z' },
        acusesAbandonados: ['k', 9],
      }),
    );
    expect(e.actualizadoEn).toBe(123);
    expect(e.intentosAnuncio).toEqual({ x: 2 });
    expect(e.acusesAbandonados).toEqual(['k']);
    expect(interpretarEstadoLocal(JSON.stringify({ actualizadoEn: 'x' }))).toEqual(
      ESTADO_LOCAL_INICIAL,
    );
  });
});
