import { describe, expect, it } from 'vitest';
import { leerConcurrenciaIngesta } from './ingesta-concurrencia.js';

describe('leerConcurrenciaIngesta', () => {
  it('sin valor (o vacío) usa el default 1', () => {
    expect(leerConcurrenciaIngesta(undefined)).toBe(1);
    expect(leerConcurrenciaIngesta('  ')).toBe(1);
  });

  it('acepta enteros entre 1 y 16', () => {
    expect(leerConcurrenciaIngesta('1')).toBe(1);
    expect(leerConcurrenciaIngesta('16')).toBe(16);
  });

  it.each(['0', '17', '-1', '2.5', 'abc'])('rechaza %s', (valor) => {
    expect(() => leerConcurrenciaIngesta(valor)).toThrow(/INGESTA_WORKER_CONCURRENCY/);
  });
});
