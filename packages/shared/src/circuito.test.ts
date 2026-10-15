import { describe, expect, it } from 'vitest';
import { distanciaAPolilineaM, partirCircuitoPorRetorno } from './circuito.js';

// Circuito de juguete (≈ 111 m por 0.001°): sale por el sur hacia el este (ida), sube y vuelve por
// el norte hacia el oeste (regreso). El retorno está en el extremo este.
const GRADO_M = 111_195;
const circuito: [number, number][] = [
  [0, 0],
  [0.01, 0],
  [0.02, 0], // retorno aquí
  [0.02, 0.0005],
  [0.01, 0.0005],
  [0, 0.0005],
  [0, 0],
];
const retorno: [number, number] = [0.02, 0.00001];

describe('partirCircuitoPorRetorno', () => {
  it('parte en ida y regreso insertando el punto proyectado en ambas mitades', () => {
    const r = partirCircuitoPorRetorno(circuito, retorno)!;
    expect(r).not.toBeNull();
    const corteIda = r.ida[r.ida.length - 1]!;
    expect(r.regreso[0]).toEqual(corteIda);
    expect(corteIda[0]).toBeCloseTo(0.02, 5);
    expect(r.ida[0]).toEqual([0, 0]);
    expect(r.regreso[r.regreso.length - 1]).toEqual([0, 0]);
    expect(r.indiceCorte).toBeGreaterThanOrEqual(1);
  });

  it('con una polilínea que pasa dos veces cerca del retorno corta en la PRIMERA pasada', () => {
    // Ida y regreso casi superpuestos: el regreso pasa a ~20 m del retorno, la ida a ~1 m.
    const doble: [number, number][] = [
      [0, 0],
      [0.01, 0],
      [0.02, 0.00001],
      [0.02, 0.0002],
      [0.01, 0.0002],
      [0, 0.0002],
    ];
    const r = partirCircuitoPorRetorno(doble, [0.02, 0.0001])!;
    expect(r).not.toBeNull();
    // La primera aproximación (segmento 2→3, el que roza el retorno) manda: el corte NO se
    // desplaza al tramo de regreso (4→5), que también pasa a ~11 m.
    expect(r.indiceCorte).toBe(2);
    expect(r.regreso).toHaveLength(4);
  });

  it('devuelve null si la polilínea nunca pasa a radioM del retorno', () => {
    expect(partirCircuitoPorRetorno(circuito, [0.02, 0.01])).toBeNull();
    expect(partirCircuitoPorRetorno(circuito, [0.02, 0.0005], 0.5)).not.toBeNull();
  });

  it('devuelve null si el retorno cae en un extremo (mitad degenerada)', () => {
    expect(partirCircuitoPorRetorno(circuito, [0, 0])).toBeNull();
  });
});

describe('distanciaAPolilineaM', () => {
  it('mide la distancia perpendicular al segmento más cercano', () => {
    const d = distanciaAPolilineaM([0.005, 0.0001], circuito);
    expect(d).toBeCloseTo(0.0001 * GRADO_M, 0);
  });

  it('polilínea sin segmentos: Infinity', () => {
    expect(distanciaAPolilineaM([0, 0], [[0, 0]])).toBe(Infinity);
  });
});
