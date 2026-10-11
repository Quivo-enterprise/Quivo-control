import { describe, expect, it } from 'vitest';
import type { EstadoVisual } from '../operacion/movimiento/store-visual';
import { posicionMapaDesde } from './posicion-mapa';

const visual: EstadoVisual = {
  lat: -34.6,
  lng: -58.4,
  rumbo: 45,
  accuracy: 8,
  speed: 3,
  ts: 1000,
  obsoleto: true,
};

describe('posicionMapaDesde', () => {
  it('prioriza el store visual y propaga rumbo, precisión, velocidad, ts y obsoleto', () => {
    expect(posicionMapaDesde(visual, { lat: 1, lng: 2 })).toEqual({
      lat: -34.6,
      lng: -58.4,
      heading: 45,
      accuracy: 8,
      speed: 3,
      ts: 1000,
      obsoleto: true,
    });
  });

  it('un rumbo null del store se propaga como heading null (punto sin flecha)', () => {
    expect(posicionMapaDesde({ ...visual, rumbo: null }, null)?.heading).toBeNull();
  });

  it('sin store cae a posicionActual, solo lat/lng', () => {
    expect(posicionMapaDesde(null, { lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
  });

  it('sin nada devuelve null (no hay marcador antes del primer fix)', () => {
    expect(posicionMapaDesde(null, null)).toBeNull();
  });
});
