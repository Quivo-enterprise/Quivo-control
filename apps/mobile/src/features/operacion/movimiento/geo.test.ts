import { describe, expect, it } from 'vitest';
import { estaObsoleto } from './geo';

describe('estaObsoleto', () => {
  it('no es obsoleto justo en el fix (Δ=0)', () => {
    expect(estaObsoleto(1000, 1000)).toBe(false);
  });

  it('no es obsoleto exactamente a los 15000ms (el umbral es estrictamente mayor)', () => {
    expect(estaObsoleto(0, 15_000)).toBe(false);
  });

  it('es obsoleto pasados los 15000ms', () => {
    expect(estaObsoleto(0, 15_001)).toBe(true);
  });
});
