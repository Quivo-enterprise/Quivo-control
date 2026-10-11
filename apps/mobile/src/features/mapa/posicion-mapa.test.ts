import { describe, expect, it } from 'vitest';
import type { EstadoVisual } from '../operacion/movimiento/store-visual';
import { debeCommitearFrame, INTERVALO_MIN_COMMIT_MS, posicionMapaDesde } from './posicion-mapa';

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

describe('debeCommitearFrame', () => {
  it('el primer frame siempre se publica', () => {
    expect(debeCommitearFrame(1000, null, false)).toBe(true);
  });

  it('salta frames a menos de INTERVALO_MIN_COMMIT_MS del último commit', () => {
    expect(debeCommitearFrame(1016, 1000, false)).toBe(false);
  });

  it('publica un frame ~33ms después (cadencia de 30Hz sobre rAF de 60Hz)', () => {
    expect(debeCommitearFrame(1000 + INTERVALO_MIN_COMMIT_MS, 1000, false)).toBe(true);
  });

  it('el frame final siempre se publica aunque sea inmediato', () => {
    expect(debeCommitearFrame(1001, 1000, true)).toBe(true);
  });
});
