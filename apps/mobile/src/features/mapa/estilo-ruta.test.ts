import { describe, expect, it } from 'vitest';
import { COLOR_ESPERA, COLOR_LINEA, debeResaltarRutaCalculada, estiloRuta } from './estilo-ruta';

describe('estiloRuta', () => {
  it('en espera: oscura (#1E1B4B) y más fina', () => {
    expect(estiloRuta(false)).toEqual({ color: '#1E1B4B', grosor: 4.5 });
    expect(COLOR_ESPERA).toBe('#1E1B4B');
  });

  it('en seguimiento: naranja (#FE9B0B) y más gruesa', () => {
    expect(estiloRuta(true)).toEqual({ color: '#FE9B0B', grosor: 5.5 });
    expect(COLOR_LINEA).toBe('#FE9B0B');
  });
});

describe('debeResaltarRutaCalculada (tramo OSRM)', () => {
  const tramo: [number, number][] = [
    [-58.4, -34.6],
    [-58.41, -34.61],
  ];

  it('solo con tracking y al menos 2 puntos', () => {
    expect(debeResaltarRutaCalculada(true, tramo)).toBe(true);
  });

  it('en espera no se resalta aunque exista el tramo', () => {
    expect(debeResaltarRutaCalculada(false, tramo)).toBe(false);
  });

  it('sin tramo calculado (null) o con menos de 2 puntos no se resalta', () => {
    expect(debeResaltarRutaCalculada(true, null)).toBe(false);
    expect(debeResaltarRutaCalculada(true, [])).toBe(false);
    expect(debeResaltarRutaCalculada(true, [[-58.4, -34.6]])).toBe(false);
  });
});
