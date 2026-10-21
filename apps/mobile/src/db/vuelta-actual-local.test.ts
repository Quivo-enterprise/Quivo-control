import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  fila: null as string | null,
  run: vi.fn(),
}));
vi.mock('./paquete-dia', () => ({
  abrirPaqueteDiaDb: async () => ({
    getFirstAsync: async () => (m.fila === null ? null : { estado: m.fila }),
    runAsync: m.run,
  }),
}));

import {
  interpretarEstadoLocal,
  leerDesignacionOrdenLocal,
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

describe('leerDesignacionOrdenLocal', () => {
  beforeEach(() => {
    m.run.mockReset();
  });

  it('devuelve el punto de espera del cache de la sesión, sin escribir', async () => {
    m.fila = fila({});
    expect(await leerDesignacionOrdenLocal('s')).toEqual({ puntoEspera: { id: ESPERA } });
    expect(m.run).not.toHaveBeenCalled();
  });

  it('sin cache: null', async () => {
    m.fila = null;
    expect(await leerDesignacionOrdenLocal('s')).toBeNull();
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

  it('persiste desfaseFilaMs solo si es un número finito', () => {
    expect(interpretarEstadoLocal(JSON.stringify({ desfaseFilaMs: -4200 })).desfaseFilaMs).toBe(
      -4200,
    );
    expect(interpretarEstadoLocal(JSON.stringify({ desfaseFilaMs: 'x' }))).toEqual(
      ESTADO_LOCAL_INICIAL,
    );
  });
});
