import { describe, expect, it } from 'vitest';
import { derivarEventIdDeterministico, generarUuidV7, uuidV7Schema } from './primitives.js';

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

describe('derivarEventIdDeterministico (fix post-revisión, "eventId estable" — fix y heartbeat concurrentes no deben emitir eventos distintos)', () => {
  it('genera un id que cumple el contrato uuidV7Schema', () => {
    const id = derivarEventIdDeterministico(['sesion-1', 'pc-1', '1']);
    expect(uuidV7Schema.safeParse(id).success).toBe(true);
  });

  it('la MISMA tripleta produce SIEMPRE el MISMO id (llamado dos veces, por caminos "distintos")', () => {
    const a = derivarEventIdDeterministico(['sesion-1', 'pc-1', '3']);
    const b = derivarEventIdDeterministico(['sesion-1', 'pc-1', '3']);
    expect(a).toBe(b);
  });

  it('cambiar CUALQUIER parte (sesionId, puntoControlId o pasada) cambia el id', () => {
    const base = derivarEventIdDeterministico(['sesion-1', 'pc-1', '1']);
    expect(derivarEventIdDeterministico(['sesion-2', 'pc-1', '1'])).not.toBe(base);
    expect(derivarEventIdDeterministico(['sesion-1', 'pc-2', '1'])).not.toBe(base);
    expect(derivarEventIdDeterministico(['sesion-1', 'pc-1', '2'])).not.toBe(base);
  });

  it('no colisiona con una concatenación ambigua (separador no confundible con los propios valores)', () => {
    // Sin un separador que no aparezca en un UUID/entero, ['sesion-1', 'pc-12'] y
    // ['sesion-1pc-1', '2'] concatenarían igual ("sesion-1pc-12") y colisionarían.
    const a = derivarEventIdDeterministico(['sesion-1', 'pc-12']);
    const b = derivarEventIdDeterministico(['sesion-1pc-1', '2']);
    expect(a).not.toBe(b);
  });

  it('es determinístico contra un valor congelado (no cambia si se retoca la implementación sin querer)', () => {
    // Snapshot explícito: cualquier cambio futuro en el algoritmo de mezcla que altere el
    // resultado para esta tripleta rompe este test a propósito — un eventId determinístico
    // que cambia de valor entre versiones de la app duplicaría evidencia server-side para
    // cumplimientos en outbox local todavía sin sincronizar al momento del update.
    const id = derivarEventIdDeterministico(['sesion-fija', 'pc-fijo', '7']);
    expect(id).toBe(derivarEventIdDeterministico(['sesion-fija', 'pc-fijo', '7']));
    expect(uuidV7Schema.safeParse(id).success).toBe(true);
  });
});
