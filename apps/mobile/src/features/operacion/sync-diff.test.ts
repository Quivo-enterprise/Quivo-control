import { describe, expect, it } from 'vitest';
import { idsNoAcusados } from './sync-diff';

describe('idsNoAcusados', () => {
  it('devuelve los enviados que no vinieron en el acuse del servidor', () => {
    const enviados = ['a', 'b', 'c'];
    const aceptados = ['a', 'c'];
    expect(idsNoAcusados(enviados, aceptados)).toEqual(['b']);
  });

  it('devuelve vacío cuando todos fueron acusados', () => {
    expect(idsNoAcusados(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('devuelve todos cuando el servidor no acusó ninguno', () => {
    expect(idsNoAcusados(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
