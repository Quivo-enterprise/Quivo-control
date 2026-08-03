import { describe, expect, it } from 'vitest';
import { haversineMetros } from './geo.js';

describe('haversineMetros', () => {
  it('devuelve 0 para el mismo punto', () => {
    expect(haversineMetros([-63.18, -17.78], [-63.18, -17.78])).toBeCloseTo(0, 6);
  });

  it('aproxima ~111.2km por grado de latitud en el ecuador', () => {
    const distancia = haversineMetros([0, 0], [0, 1]);
    expect(distancia).toBeGreaterThan(110_000);
    expect(distancia).toBeLessThan(112_000);
  });

  it('mide correctamente una distancia corta (radio de tolerancia de un punto de control)', () => {
    // ~0.00027 grados de latitud ≈ 30m
    const distancia = haversineMetros([-63.18, -17.78], [-63.18, -17.77973]);
    expect(distancia).toBeGreaterThan(25);
    expect(distancia).toBeLessThan(35);
  });

  it('es simétrica', () => {
    const a: [number, number] = [-63.18, -17.78];
    const b: [number, number] = [-63.185, -17.783];
    expect(haversineMetros(a, b)).toBeCloseTo(haversineMetros(b, a), 9);
  });
});
