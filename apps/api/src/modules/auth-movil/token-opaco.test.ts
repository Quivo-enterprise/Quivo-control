import { describe, expect, it } from 'vitest';
import { emitirTokenOpaco, hashTokenOpaco } from './token-opaco.js';

describe('tokens opacos móviles', () => {
  it('emite valores distintos y persiste sólo un hash determinista', () => {
    const primero = emitirTokenOpaco('access');
    const segundo = emitirTokenOpaco('access');

    expect(primero.value).toMatch(/^mobile_at_/);
    expect(primero.value).not.toBe(segundo.value);
    expect(primero.hash).toBe(hashTokenOpaco(primero.value));
    expect(primero.hash).toHaveLength(64);
    expect(primero.hash).not.toContain(primero.value);
  });
});
