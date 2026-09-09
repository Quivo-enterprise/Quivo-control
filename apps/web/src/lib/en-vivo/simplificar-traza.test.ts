import { describe, expect, it } from 'vitest';
import {
  EPSILON_SIMPLIFICACION_METROS,
  indicesDouglasPeucker,
  simplificarTrazaParaDibujo,
  UMBRAL_PUNTOS_SIMPLIFICACION,
  type PuntoSimplificable,
} from './simplificar-traza.js';

const LAT_BASE = -17.3935;
const LNG_BASE = -66.157;
/** ~1 metro en grados de longitud a esta latitud, para armar fixtures legibles en metros. */
const GRADO_LNG_POR_METRO = 1 / (111_320 * Math.cos((LAT_BASE * Math.PI) / 180));

function puntoEnMetros(xMetros: number, yMetros: number = 0): PuntoSimplificable {
  return { lat: LAT_BASE + yMetros / 111_320, lng: LNG_BASE + xMetros * GRADO_LNG_POR_METRO };
}

describe('indicesDouglasPeucker', () => {
  it('con 2 puntos o menos conserva todo', () => {
    expect(indicesDouglasPeucker([], 3)).toEqual([]);
    expect(indicesDouglasPeucker([puntoEnMetros(0)], 3)).toEqual([0]);
    expect(indicesDouglasPeucker([puntoEnMetros(0), puntoEnMetros(10)], 3)).toEqual([0, 1]);
  });

  it('descarta puntos casi colineales dentro del epsilon (recta)', () => {
    // 5 puntos sobre una recta perfecta — con cualquier epsilon > 0 debería quedar solo
    // el primero y el último.
    const puntos = [puntoEnMetros(0), puntoEnMetros(10), puntoEnMetros(20), puntoEnMetros(30), puntoEnMetros(40)];
    expect(indicesDouglasPeucker(puntos, 1)).toEqual([0, 4]);
  });

  it('conserva un punto que se desvía por encima del epsilon (una esquina real)', () => {
    // Recta de (0,0) a (40,0) con un punto en (20, 10) — 10 m de desvío perpendicular.
    const puntos = [puntoEnMetros(0, 0), puntoEnMetros(10, 0), puntoEnMetros(20, 10), puntoEnMetros(30, 0), puntoEnMetros(40, 0)];
    const indices = indicesDouglasPeucker(puntos, 3);
    expect(indices).toContain(2); // la esquina se conserva
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(4);
  });

  it('con una desviación por debajo del epsilon la descarta igual que el resto', () => {
    // Mismo desvío de 10 m que el caso anterior, pero con epsilon más grande que el desvío.
    const puntos = [puntoEnMetros(0, 0), puntoEnMetros(10, 0), puntoEnMetros(20, 10), puntoEnMetros(30, 0), puntoEnMetros(40, 0)];
    const indices = indicesDouglasPeucker(puntos, 15);
    expect(indices).toEqual([0, 4]);
  });

  it('siempre conserva el primer y el último punto, incluso con ruido total', () => {
    const puntos = Array.from({ length: 30 }, (_, i) => puntoEnMetros(i * 5, i % 2 === 0 ? 0 : 50));
    const indices = indicesDouglasPeucker(puntos, 1);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(29);
  });
});

describe('simplificarTrazaParaDibujo', () => {
  it('por debajo del umbral devuelve el mismo array (misma referencia)', () => {
    const puntos = Array.from({ length: UMBRAL_PUNTOS_SIMPLIFICACION }, (_, i) => puntoEnMetros(i * 10));
    expect(simplificarTrazaParaDibujo(puntos)).toBe(puntos);
  });

  it('por encima del umbral simplifica un tramo recto largo', () => {
    const puntos = Array.from({ length: UMBRAL_PUNTOS_SIMPLIFICACION + 500 }, (_, i) => puntoEnMetros(i * 15));
    const simplificado = simplificarTrazaParaDibujo(puntos);
    expect(simplificado.length).toBeLessThan(puntos.length);
    expect(simplificado[0]).toBe(puntos[0]);
    expect(simplificado[simplificado.length - 1]).toBe(puntos[puntos.length - 1]);
  });

  it('preserva una curva real aunque el resto del tramo sea recto', () => {
    const recta1 = Array.from({ length: 1000 }, (_, i) => puntoEnMetros(i * 15, 0));
    const curva = [puntoEnMetros(15_100, 20), puntoEnMetros(15_150, 40)];
    const recta2 = Array.from({ length: 1000 }, (_, i) => puntoEnMetros(15_200 + i * 15, 40));
    const puntos = [...recta1, ...curva, ...recta2];
    const simplificado = simplificarTrazaParaDibujo(puntos);
    // La curva se traduce en un cambio de latitud sostenido — el simplificado debe conservar
    // algún punto con y=40 (no colapsar toda la curva en la recta de entrada).
    expect(simplificado.some((p) => Math.abs(p.lat - puntoEnMetros(0, 40).lat) < 1e-9)).toBe(true);
  });

  it('la desviación de un punto conservado respecto de la recta original queda por debajo del epsilon usado', () => {
    const puntos = Array.from({ length: 2000 }, (_, i) => puntoEnMetros(i * 15, Math.sin(i / 37) * 1.5));
    const simplificado = simplificarTrazaParaDibujo(puntos);
    expect(simplificado.length).toBeLessThan(puntos.length);
    expect(EPSILON_SIMPLIFICACION_METROS).toBeGreaterThan(0);
  });
});
