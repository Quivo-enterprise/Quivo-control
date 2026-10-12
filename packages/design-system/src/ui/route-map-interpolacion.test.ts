import { describe, expect, it } from 'vitest';
import {
  DURACION_INTERPOLACION_MS,
  SALTO_DIRECTO_METROS,
  apuntarInterpolacionA,
  distanciaMetros,
  interpolacionEnMovimiento,
  interpolacionQuieta,
  posicionInterpolada,
} from './route-map-interpolacion.js';

const A = { lat: -17.39, lng: -66.15 };
// ~111 m al norte de A.
const B = { lat: -17.389, lng: -66.15 };

describe('distanciaMetros', () => {
  it('0 para el mismo punto y ~111 m por 0.001 de latitud', () => {
    expect(distanciaMetros(A, A)).toBe(0);
    expect(distanciaMetros(A, B)).toBeGreaterThan(105);
    expect(distanciaMetros(A, B)).toBeLessThan(115);
  });
});

describe('apuntarInterpolacionA', () => {
  it('desliza linealmente de la posición mostrada al destino', () => {
    const e = apuntarInterpolacionA(interpolacionQuieta(A), B, 1000);
    expect(posicionInterpolada(e, 1000)).toEqual(A);
    const mitad = posicionInterpolada(e, 1000 + DURACION_INTERPOLACION_MS / 2);
    expect(mitad.lat).toBeCloseTo((A.lat + B.lat) / 2, 9);
    expect(posicionInterpolada(e, 1000 + DURACION_INTERPOLACION_MS)).toEqual(B);
    expect(posicionInterpolada(e, 99_999)).toEqual(B);
  });

  it('enMovimiento solo mientras dura el tramo', () => {
    const e = apuntarInterpolacionA(interpolacionQuieta(A), B, 0);
    expect(interpolacionEnMovimiento(e, 500)).toBe(true);
    expect(interpolacionEnMovimiento(e, DURACION_INTERPOLACION_MS)).toBe(false);
    expect(interpolacionEnMovimiento(interpolacionQuieta(A), 0)).toBe(false);
  });

  it('un destino nuevo a mitad de tramo arranca desde la posición mostrada, sin rebobinar', () => {
    const e1 = apuntarInterpolacionA(interpolacionQuieta(A), B, 0);
    const mostrada = posicionInterpolada(e1, 1000);
    const C = { lat: -17.388, lng: -66.15 };
    const e2 = apuntarInterpolacionA(e1, C, 1000);
    expect(e2.desde).toEqual(mostrada);
    expect(posicionInterpolada(e2, 1000)).toEqual(mostrada);
    expect(posicionInterpolada(e2, 1000 + DURACION_INTERPOLACION_MS)).toEqual(C);
  });

  it('mismo destino devuelve el mismo estado (misma referencia)', () => {
    const e = apuntarInterpolacionA(interpolacionQuieta(A), B, 0);
    expect(apuntarInterpolacionA(e, { ...B }, 500)).toBe(e);
  });

  it('prefers-reduced-motion salta directo', () => {
    const e = apuntarInterpolacionA(interpolacionQuieta(A), B, 0, { reducirMovimiento: true });
    expect(posicionInterpolada(e, 0)).toEqual(B);
    expect(interpolacionEnMovimiento(e, 0)).toBe(false);
  });

  it('un salto mayor al umbral teletransporta', () => {
    const lejos = { lat: A.lat + (SALTO_DIRECTO_METROS * 2) / 111_000, lng: A.lng };
    const e = apuntarInterpolacionA(interpolacionQuieta(A), lejos, 0);
    expect(posicionInterpolada(e, 0)).toEqual(lejos);
    expect(interpolacionEnMovimiento(e, 0)).toBe(false);
  });

  it('respeta una duración personalizada y duración 0 salta', () => {
    const e = apuntarInterpolacionA(interpolacionQuieta(A), B, 0, { duracionMs: 400 });
    expect(interpolacionEnMovimiento(e, 399)).toBe(true);
    expect(interpolacionEnMovimiento(e, 400)).toBe(false);
    const j = apuntarInterpolacionA(interpolacionQuieta(A), B, 0, { duracionMs: 0 });
    expect(posicionInterpolada(j, 0)).toEqual(B);
  });
});
