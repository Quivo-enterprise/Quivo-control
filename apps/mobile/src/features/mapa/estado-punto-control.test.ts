import { describe, expect, it } from 'vitest';
import {
  aspectoPuntoControl,
  COLOR_PUNTO_CONTROL,
  COLOR_PUNTO_CONTROL_COMPLETADO,
  COLOR_PUNTO_CONTROL_OMITIDO,
  colorPuntoControl,
} from './estado-punto-control';

describe('aspectoPuntoControl', () => {
  it('pasado y omitido se reflejan solo con el recorrido en seguimiento', () => {
    expect(aspectoPuntoControl('pasado', true)).toBe('pasado');
    expect(aspectoPuntoControl('omitido', true)).toBe('omitido');
  });

  it('proximo, pendiente o sin estado se ven como pendientes', () => {
    expect(aspectoPuntoControl('proximo', true)).toBe('pendiente');
    expect(aspectoPuntoControl('pendiente', true)).toBe('pendiente');
    expect(aspectoPuntoControl(undefined, true)).toBe('pendiente');
  });

  it('sin tracking la ruta se muestra virgen aunque haya estados', () => {
    expect(aspectoPuntoControl('pasado', false)).toBe('pendiente');
    expect(aspectoPuntoControl('omitido', false)).toBe('pendiente');
  });
});

describe('colorPuntoControl', () => {
  it('azul pendiente, verde pasado, rojo omitido', () => {
    expect(colorPuntoControl('pendiente')).toBe(COLOR_PUNTO_CONTROL);
    expect(colorPuntoControl('pasado')).toBe(COLOR_PUNTO_CONTROL_COMPLETADO);
    expect(colorPuntoControl('omitido')).toBe(COLOR_PUNTO_CONTROL_OMITIDO);
    expect(COLOR_PUNTO_CONTROL).toBe('#3127B1');
    expect(COLOR_PUNTO_CONTROL_COMPLETADO).toBe('#22C55E');
    expect(COLOR_PUNTO_CONTROL_OMITIDO).toBe('#C53B4A');
  });
});
