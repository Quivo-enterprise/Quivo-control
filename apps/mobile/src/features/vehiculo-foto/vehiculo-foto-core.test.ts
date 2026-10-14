import { describe, expect, it, vi } from 'vitest';
import {
  backoffMs,
  bytesDecodificados,
  claveDiaBolivia,
  debeMostrarAviso,
  esReintentable,
  excedeTopeFoto,
  formatearFechaBolivia,
  mensajeErrorSubida,
  subirConReintentos,
  type ErrorSubida,
} from './vehiculo-foto-core';

const clasificar = (e: unknown): ErrorSubida => e as ErrorSubida;

describe('tamaño', () => {
  it('calcula bytes decodificados con padding', () => {
    expect(bytesDecodificados('')).toBe(0);
    expect(bytesDecodificados('TWFu')).toBe(3);
    expect(bytesDecodificados('TWE=')).toBe(2);
    expect(bytesDecodificados('TQ==')).toBe(1);
  });
  it('rechaza más de 2 MB decodificados', () => {
    expect(excedeTopeFoto('A'.repeat(2_000_000))).toBe(false);
    expect(excedeTopeFoto('A'.repeat(2_900_000))).toBe(true);
  });
});

describe('mensajes y reintentabilidad', () => {
  it('traduce 409/422/429 a español', () => {
    expect(mensajeErrorSubida({ red: false, status: 409 })).toMatch(/recorrido o vehículo activo/);
    expect(mensajeErrorSubida({ red: false, status: 422 })).toMatch(/no es válida/);
    expect(mensajeErrorSubida({ red: false, status: 429 })).toMatch(/una hora/);
    expect(mensajeErrorSubida({ red: true })).toBe('Se enviará al reconectar.');
  });
  it('solo reintenta red y 5xx', () => {
    expect(esReintentable({ red: true })).toBe(true);
    expect(esReintentable({ red: false, status: 503 })).toBe(true);
    for (const status of [401, 409, 422, 429]) {
      expect(esReintentable({ red: false, status })).toBe(false);
    }
  });
  it('backoff exponencial', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([1000, 2000, 4000]);
  });
});

describe('subirConReintentos', () => {
  it('devuelve ok al primer intento sin dormir', async () => {
    const dormir = vi.fn(async () => undefined);
    const r = await subirConReintentos({ intentar: async () => 'x', clasificar, dormir });
    expect(r).toEqual({ tipo: 'ok', valor: 'x' });
    expect(dormir).not.toHaveBeenCalled();
  });
  it('reintenta la red con backoff y termina ok', async () => {
    const dormir = vi.fn(async (_ms: number) => undefined);
    const intentar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ red: true })
      .mockRejectedValueOnce({ red: false, status: 502 })
      .mockResolvedValue('ok');
    const r = await subirConReintentos({ intentar, clasificar, dormir });
    expect(r).toEqual({ tipo: 'ok', valor: 'ok' });
    expect(dormir.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });
  it('sin red tras 3 intentos queda pendiente', async () => {
    const intentar = vi.fn(async () => {
      throw { red: true };
    });
    const r = await subirConReintentos({ intentar, clasificar, dormir: async () => undefined });
    expect(intentar).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ tipo: 'pendiente', mensaje: 'Se enviará al reconectar.' });
  });
  it('no reintenta 422 ni 429', async () => {
    for (const status of [422, 429, 409]) {
      const intentar = vi.fn(async () => {
        throw { red: false, status };
      });
      const r = await subirConReintentos({ intentar, clasificar, dormir: async () => undefined });
      expect(intentar).toHaveBeenCalledTimes(1);
      expect(r.tipo).toBe('error');
    }
  });
  it('5xx agotado es error, no pendiente', async () => {
    const r = await subirConReintentos({
      intentar: async () => {
        throw { red: false, status: 500 };
      },
      clasificar,
      dormir: async () => undefined,
    });
    expect(r.tipo).toBe('error');
  });
  it('respeta cancelado', async () => {
    const intentar = vi.fn(async () => {
      throw { red: true };
    });
    await subirConReintentos({
      intentar,
      clasificar,
      dormir: async () => undefined,
      cancelado: () => true,
    });
    expect(intentar).toHaveBeenCalledTimes(1);
  });
});

describe('fechas Bolivia (UTC-4)', () => {
  it('cambia de día según hora de La Paz, no UTC', () => {
    // 02:00Z = 22:00 del día anterior en Bolivia
    expect(claveDiaBolivia(new Date('2026-10-14T02:00:00Z'))).toBe('2026-10-13');
    expect(claveDiaBolivia(new Date('2026-10-14T04:00:00Z'))).toBe('2026-10-14');
  });
  it('formatea dd/mm/aaaa hh:mm', () => {
    expect(formatearFechaBolivia('2026-10-14T13:05:00.000Z')).toBe('14/10/2026 09:05');
    expect(formatearFechaBolivia('basura')).toBeNull();
  });
});

describe('debeMostrarAviso', () => {
  const base = {
    cargando: false,
    tieneFoto: false,
    descartadoDia: null,
    tracking: false,
    ahora: new Date('2026-10-14T15:00:00Z'),
  };
  it('muestra sin foto antes de iniciar', () => expect(debeMostrarAviso(base)).toBe(true));
  it('oculta con foto, cargando o recorrido activo', () => {
    expect(debeMostrarAviso({ ...base, tieneFoto: true })).toBe(false);
    expect(debeMostrarAviso({ ...base, cargando: true })).toBe(false);
    expect(debeMostrarAviso({ ...base, tracking: true })).toBe(false);
  });
  it('descartado hoy se oculta; ayer vuelve', () => {
    expect(debeMostrarAviso({ ...base, descartadoDia: '2026-10-14' })).toBe(false);
    expect(debeMostrarAviso({ ...base, descartadoDia: '2026-10-13' })).toBe(true);
  });
});
