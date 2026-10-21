import type { PosicionFila } from '@quivo/shared';
import { describe, expect, it } from 'vitest';
import { TOLERANCIA_SALIDA_MS, esAnticipada } from './salidas.logic.js';

const ahora = new Date('2026-10-20T15:00:00Z');
const pos = (posicion: number, etaMs: number, habilitado = false): PosicionFila => ({
  id: `f${posicion}`, vehiculoId: `v${posicion}`, posicion, etaTs: new Date(ahora.getTime() + etaMs),
  esperaMs: Math.max(0, etaMs), habilitado, demorado: false,
});

describe('esAnticipada (tolerancia de 15 s antes del ETA)', () => {
  it('el 1.º que sale justo en el borde de la tolerancia está en turno; un ms antes es anticipada', () => {
    expect(esAnticipada([pos(1, TOLERANCIA_SALIDA_MS)], 'f1', ahora)).toBe(false);
    expect(esAnticipada([pos(1, TOLERANCIA_SALIDA_MS + 1)], 'f1', ahora)).toBe(true);
  });
  it('habilitado nunca es anticipada; el 2.º sí, aunque su ETA esté cerca; una fila ausente también', () => {
    expect(esAnticipada([pos(1, -5000, true)], 'f1', ahora)).toBe(false);
    expect(esAnticipada([pos(1, 0, true), pos(2, 1000)], 'f2', ahora)).toBe(true);
    expect(esAnticipada([], 'f1', ahora)).toBe(true);
  });
});
