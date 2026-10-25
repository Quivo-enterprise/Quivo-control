import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/http-client';

const mocks = vi.hoisted(() => ({
  salida: vi.fn(),
  llegada: vi.fn(),
  refresco: vi.fn(),
  incorporar: vi.fn(),
}));

vi.mock('../../shared/api/fila-api', () => ({
  filaApi: { salida: mocks.salida, llegada: mocks.llegada },
}));
vi.mock('../vuelta-actual/vuelta-actual-oportunista', () => ({
  solicitarRefresco: mocks.refresco,
  incorporarFilaDeAccion: mocks.incorporar,
}));

import { registrarLlegada, registrarSalida } from './fila-salida-acciones';

const token = async () => 'tok';
const http = (status: number, mensaje: string) => new ApiError('http', mensaje, status);

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.refresco.mockResolvedValue(undefined);
  mocks.incorporar.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('registrarSalida', () => {
  it('un 409 hace UN solo intento y devuelve el mensaje del servidor', async () => {
    mocks.salida.mockRejectedValue(http(409, 'El recorrido ya finalizó'));
    const r = await registrarSalida(token, 'boton');
    expect(r).toEqual({ ok: false, mensaje: 'El recorrido ya finalizó' });
    expect(mocks.salida).toHaveBeenCalledTimes(1);
    expect(mocks.refresco).not.toHaveBeenCalled();
  });

  it('un error de red reintenta hasta `intentos` y devuelve el mensaje de conexión', async () => {
    mocks.salida.mockRejectedValue(new ApiError('network', 'sin red'));
    const p = registrarSalida(token, 'boton', 3);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(mocks.salida).toHaveBeenCalledTimes(3);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.mensaje).toMatch(/No se pudo conectar/);
  });

  it('éxito: incorpora la fila del POST y pide refresco', async () => {
    mocks.salida.mockResolvedValue({ fila: null, anticipada: false });
    expect(await registrarSalida(token, 'geocerca', 1)).toEqual({ ok: true });
    expect(mocks.incorporar).toHaveBeenCalledWith(null);
    expect(mocks.refresco).toHaveBeenCalledTimes(1);
  });
});

describe('registrarLlegada', () => {
  it('un solo intento aunque falle la red', async () => {
    mocks.llegada.mockRejectedValue(new ApiError('network', 'sin red'));
    const r = await registrarLlegada(token, {
      lat: 1,
      lng: 2,
      accuracy: 5,
      ts: '2026-10-20T11:00:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect(mocks.llegada).toHaveBeenCalledTimes(1);
  });

  it('confirma la llegada antes del POST', async () => {
    const orden: string[] = [];
    mocks.llegada.mockImplementation(async () => {
      orden.push('post');
      return { fila: null };
    });
    const fix = { lat: 1, lng: 2, accuracy: 5, ts: '2026-10-20T11:00:00.000Z' };
    await registrarLlegada(token, fix, async () => {
      orden.push('confirmar');
    });
    expect(orden).toEqual(['confirmar', 'post']);
  });
});
