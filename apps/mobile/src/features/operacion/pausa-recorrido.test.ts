import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

import { parsearPausa } from './pausa-recorrido';

const desde = '2026-10-21T14:05:00.000Z';

describe('parsearPausa', () => {
  it('devuelve el inicio de la pausa de la misma sesión', () => {
    expect(parsearPausa(JSON.stringify({ sesionId: 's1', desde }), 's1')).toBe(desde);
  });
  it('ignora la pausa de otra sesión', () => {
    expect(parsearPausa(JSON.stringify({ sesionId: 's1', desde }), 's2')).toBeNull();
  });
  it('tolera vacío, basura y fechas inválidas', () => {
    expect(parsearPausa(null, 's1')).toBeNull();
    expect(parsearPausa('{no json', 's1')).toBeNull();
    expect(parsearPausa(JSON.stringify({ sesionId: 's1', desde: 'x' }), 's1')).toBeNull();
  });
});
