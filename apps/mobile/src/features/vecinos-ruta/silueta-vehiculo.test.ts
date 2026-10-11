import { describe, expect, it } from 'vitest';
import { variantePorTipo } from './silueta-vehiculo-variante';

describe('variantePorTipo', () => {
  it('mapea tipos conocidos', () => {
    expect(variantePorTipo('omnibus')).toBe('bus');
    expect(variantePorTipo('bus_urbano')).toBe('bus');
    expect(variantePorTipo('trufi')).toBe('micro');
    expect(variantePorTipo('taxi_trufi')).toBe('micro');
    expect(variantePorTipo('minibus')).toBe('minibus');
  });
  it('usa minibús para desconocidos', () => {
    expect(variantePorTipo('micro')).toBe('minibus');
    expect(variantePorTipo('xyz')).toBe('minibus');
  });
});
