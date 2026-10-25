import { describe, expect, it } from 'vitest';
import { debeCorrerLatidoPrimerPlano } from './latido-primer-plano';

describe('debeCorrerLatidoPrimerPlano', () => {
  it('parado (sin fix ni latido recientes, o nunca) => corre', () => {
    expect(debeCorrerLatidoPrimerPlano(100_000, 50_000, 50_000)).toBe(true);
    expect(debeCorrerLatidoPrimerPlano(100_000, 0, 0)).toBe(true);
  });
  it('fix reciente (< 50 s, en marcha) => se salta', () => {
    expect(debeCorrerLatidoPrimerPlano(100_000, 0, 51_000)).toBe(false);
  });
  it('justo en el margen (50 s) => corre', () => {
    expect(debeCorrerLatidoPrimerPlano(100_000, 50_000, 50_000)).toBe(true);
  });
  it('latido reciente (< 50 s) => se salta', () => {
    expect(debeCorrerLatidoPrimerPlano(100_000, 51_000, 0)).toBe(false);
  });
});
