import { describe, expect, it } from 'vitest';
import { posicionEnPolilinea } from './geometria';

describe('posicionEnPolilinea', () => {
  it('con polilínea vacía devuelve un punto fijo sin lanzar', () => {
    expect(posicionEnPolilinea([], 0.5)).toEqual({ lat: 0, lng: 0 });
  });

  it('con un solo punto devuelve siempre ese punto, sin importar el avance', () => {
    const punto: [number, number] = [-17.4, -66.15];
    expect(posicionEnPolilinea([punto], 0)).toEqual({ lat: -17.4, lng: -66.15 });
    expect(posicionEnPolilinea([punto], 0.7)).toEqual({ lat: -17.4, lng: -66.15 });
  });

  it('avance 0 devuelve el primer punto', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.15],
      [-17.4, -66.14],
    ];
    const pos = posicionEnPolilinea(polilinea, 0);
    expect(pos.lat).toBeCloseTo(-17.4, 6);
    expect(pos.lng).toBeCloseTo(-66.15, 6);
  });

  it('en un segmento recto, avance 0.5 cae en el punto medio', () => {
    // Segmento de largo constante (misma latitud): la interpolación por distancia
    // acumulada coincide con la interpolación lineal simple del lng.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.14],
    ];
    const pos = posicionEnPolilinea(polilinea, 0.5);
    expect(pos.lat).toBeCloseTo(-17.4, 4);
    expect(pos.lng).toBeCloseTo(-66.15, 3);
  });

  it('hace loop: avance 1 equivale a avance 0 (vuelve al primer punto)', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.4, -66.14],
    ];
    const enUno = posicionEnPolilinea(polilinea, 1);
    const enCero = posicionEnPolilinea(polilinea, 0);
    expect(enUno.lat).toBeCloseTo(enCero.lat, 6);
    expect(enUno.lng).toBeCloseTo(enCero.lng, 6);
  });

  it('normaliza avances fuera de [0,1) — 1.5 equivale a 0.5, y -0.5 equivale a 0.5', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.14],
    ];
    const base = posicionEnPolilinea(polilinea, 0.5);
    const masDeUno = posicionEnPolilinea(polilinea, 1.5);
    const negativo = posicionEnPolilinea(polilinea, -0.5);
    expect(masDeUno.lat).toBeCloseTo(base.lat, 6);
    expect(masDeUno.lng).toBeCloseTo(base.lng, 6);
    expect(negativo.lat).toBeCloseTo(base.lat, 6);
    expect(negativo.lng).toBeCloseTo(base.lng, 6);
  });

  it('respeta esquinas: con 3 puntos, avance a mitad de camino cae cerca del punto medio real', () => {
    // Dos segmentos de largo similar (mismo delta de lng en la misma latitud aprox): el
    // punto medio del recorrido total debería caer cerca del vértice del medio.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.15],
      [-17.4, -66.14],
    ];
    const pos = posicionEnPolilinea(polilinea, 0.5);
    expect(pos.lng).toBeCloseTo(-66.15, 2);
  });
});
