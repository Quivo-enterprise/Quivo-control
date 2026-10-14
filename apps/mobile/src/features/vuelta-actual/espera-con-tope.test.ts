import { afterEach, describe, expect, it, vi } from 'vitest';
import { esperarConTope } from './espera-con-tope';

describe('esperarConTope', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resuelve true apenas termina la promesa, sin esperar el tope', async () => {
    vi.useFakeTimers();
    await expect(esperarConTope(Promise.resolve('x'), 8_000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('si la promesa rechaza resuelve true (nunca rechaza)', async () => {
    await expect(esperarConTope(Promise.reject(new Error('boom')), 8_000)).resolves.toBe(true);
  });

  it('si la promesa no termina, resuelve false al vencer el tope y la promesa sigue viva', async () => {
    vi.useFakeTimers();
    let terminada = false;
    const lenta = new Promise<void>((r) => setTimeout(() => ((terminada = true), r()), 60_000));
    const espera = esperarConTope(lenta, 8_000);
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(espera).resolves.toBe(false);
    expect(terminada).toBe(false);
    await vi.advanceTimersByTimeAsync(52_000);
    expect(terminada).toBe(true);
  });
});
