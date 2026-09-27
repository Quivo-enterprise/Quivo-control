import { describe, expect, it } from 'vitest';
import { entreEnteros, hashString, mulberry32, SEMILLA_HISTORIAL } from './rng';

describe('mulberry32', () => {
  it('la misma semilla produce SIEMPRE la misma secuencia', () => {
    const a = mulberry32(SEMILLA_HISTORIAL);
    const b = mulberry32(SEMILLA_HISTORIAL);
    const secuenciaA = Array.from({ length: 20 }, () => a());
    const secuenciaB = Array.from({ length: 20 }, () => b());
    expect(secuenciaA).toEqual(secuenciaB);
  });

  it('semillas distintas producen secuencias distintas', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('siempre devuelve un número en [0, 1)', () => {
    const rng = mulberry32(SEMILLA_HISTORIAL);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('entreEnteros', () => {
  it('siempre cae dentro de [min, max] inclusive', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const v = entreEnteros(rng, 5, 8);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(8);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('hashString', () => {
  it('es determinístico: el mismo string da SIEMPRE el mismo hash', () => {
    expect(hashString('parada-kanata:8')).toBe(hashString('parada-kanata:8'));
  });

  it('strings distintos casi siempre dan hashes distintos', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
