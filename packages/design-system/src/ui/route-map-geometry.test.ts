import { describe, expect, it } from 'vitest';
import { FOLLOW_CENTRAL_FRACTION, isWithinCentralViewport } from './route-map-geometry.js';

describe('isWithinCentralViewport', () => {
  const size = { x: 1000, y: 800 };

  it('es true en el centro exacto del viewport', () => {
    expect(isWithinCentralViewport({ x: 500, y: 400 }, size)).toBe(true);
  });

  it('es true justo en el borde interior del 60% central (no vibra con jitter de GPS)', () => {
    // Margen del 20% a cada lado: [200, 800] en x, [160, 640] en y.
    expect(isWithinCentralViewport({ x: 200, y: 160 }, size)).toBe(true);
    expect(isWithinCentralViewport({ x: 800, y: 640 }, size)).toBe(true);
  });

  it('es false apenas afuera del borde del 60% central en x', () => {
    expect(isWithinCentralViewport({ x: 199, y: 400 }, size)).toBe(false);
    expect(isWithinCentralViewport({ x: 801, y: 400 }, size)).toBe(false);
  });

  it('es false apenas afuera del borde del 60% central en y', () => {
    expect(isWithinCentralViewport({ x: 500, y: 159 }, size)).toBe(false);
    expect(isWithinCentralViewport({ x: 500, y: 641 }, size)).toBe(false);
  });

  it('es false en las esquinas del viewport', () => {
    expect(isWithinCentralViewport({ x: 0, y: 0 }, size)).toBe(false);
    expect(isWithinCentralViewport({ x: 1000, y: 800 }, size)).toBe(false);
  });

  it('respeta una fracción distinta a la default cuando se pasa explícita', () => {
    // Con fracción 1.0 (100%) todo el viewport cuenta como "central".
    expect(isWithinCentralViewport({ x: 0, y: 0 }, size, 1)).toBe(true);
    // Con fracción 0 (0%) solo el punto exacto del centro cuenta.
    expect(isWithinCentralViewport({ x: 500, y: 400 }, size, 0)).toBe(true);
    expect(isWithinCentralViewport({ x: 499, y: 400 }, size, 0)).toBe(false);
  });

  it('usa 0.6 como fracción default', () => {
    expect(FOLLOW_CENTRAL_FRACTION).toBe(0.6);
  });

  it('no divide por cero con un viewport de tamaño 0 (mapa todavía sin layout)', () => {
    expect(isWithinCentralViewport({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });
});
