import { describe, expect, it } from 'vitest';
import { formatearFechaFoto } from './vehicle-photo';

describe('formatearFechaFoto', () => {
  it('usa hora de Bolivia (UTC-4) sin depender de la zona del navegador', () => {
    // 02:30 UTC del 5 de marzo = 22:30 del 4 de marzo en La Paz.
    const texto = formatearFechaFoto('2026-03-05T02:30:00.000Z');
    expect(texto).toMatch(/4/);
    expect(texto).toMatch(/22:30|10:30/);
  });

  it('devuelve un guion con fecha inválida', () => {
    expect(formatearFechaFoto('no-es-fecha')).toBe('—');
  });
});
