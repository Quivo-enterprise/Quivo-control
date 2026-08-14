import { describe, expect, it } from 'vitest';
import { generarUuidV7, uuidV7Schema } from './primitives.js';

function randomBytes(seed: number): Uint8Array {
  const bytes = new Uint8Array(10);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (seed + i * 37) % 256;
  }
  return bytes;
}

describe('generarUuidV7', () => {
  it('genera un UUID que cumple el contrato uuidV7Schema (RF-72)', () => {
    const id = generarUuidV7(randomBytes(1));
    expect(uuidV7Schema.safeParse(id).success).toBe(true);
  });

  it('rechaza menos de 10 bytes de entropía', () => {
    expect(() => generarUuidV7(new Uint8Array(9))).toThrow();
  });

  it('es ordenable por tiempo de creación (mismo criterio que RF-72/idempotencia)', () => {
    const antes = generarUuidV7(randomBytes(1), new Date('2026-01-01T00:00:00.000Z'));
    const despues = generarUuidV7(randomBytes(1), new Date('2026-01-01T00:00:01.000Z'));
    expect(antes < despues).toBe(true);
  });

  it('genera IDs distintos con distinta aleatoriedad en el mismo instante', () => {
    const misma = new Date('2026-01-01T00:00:00.000Z');
    const a = generarUuidV7(randomBytes(1), misma);
    const b = generarUuidV7(randomBytes(200), misma);
    expect(a).not.toBe(b);
  });
});
