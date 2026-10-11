import { describe, expect, it } from 'vitest';
import { faseControl } from './fase-control';

describe('faseControl', () => {
  it('sin jornada y sin recorrido → jornada', () => {
    expect(faseControl({ jornadaIniciada: false, tracking: false })).toBe('jornada');
  });

  it('jornada iniciada sin recorrido → listo', () => {
    expect(faseControl({ jornadaIniciada: true, tracking: false })).toBe('listo');
  });

  it('con recorrido → recorrido', () => {
    expect(faseControl({ jornadaIniciada: true, tracking: true })).toBe('recorrido');
  });

  it('tracking manda: recorrido re-enganchado sin declaración muestra FINALIZAR', () => {
    expect(faseControl({ jornadaIniciada: false, tracking: true })).toBe('recorrido');
  });
});
