import { describe, expect, it } from 'vitest';
import { formatearDistancia, formatearDistanciaVoz } from './format-distancia';

describe('formatearDistancia', () => {
  it('redondea al metro entero por debajo de 1000 m', () => {
    expect(formatearDistancia(104.58484945)).toBe('105 m');
  });

  it('corta a un decimal de km a partir de 1000 m', () => {
    expect(formatearDistancia(1234)).toBe('1.2 km');
  });
});

describe('formatearDistanciaVoz — ENTREGA 5 (plan post-piloto 2026-09-09)', () => {
  it('redondea a múltiplos de 10, no solo al entero (el bug real del piloto)', () => {
    // Cita textual del piloto: "la voz habla 8 decimales: 104.58484945 metros".
    expect(formatearDistanciaVoz(104.58484945)).toBe('100 m');
    // "Punto de control 16 detectado 134 metros antes" — el fix ingenuo (solo redondear al
    // entero) seguiría diciendo "134 metros", que suena a bug igual. Con decenas: "130 metros".
    expect(formatearDistanciaVoz(134)).toBe('130 m');
  });

  it('redondea hacia arriba en el punto medio de la decena, igual que Math.round', () => {
    expect(formatearDistanciaVoz(135)).toBe('140 m');
    expect(formatearDistanciaVoz(5)).toBe('10 m');
  });

  it('no toca el corte a km de formatearDistancia por encima de 1000 m', () => {
    expect(formatearDistanciaVoz(1234)).toBe('1.2 km');
  });

  it('0 metros se anuncia como "0 m", no "NaN"', () => {
    expect(formatearDistanciaVoz(0)).toBe('0 m');
  });
});
