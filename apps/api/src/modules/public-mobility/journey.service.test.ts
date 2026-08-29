import { describe, expect, it } from 'vitest';
import type { JourneyOption } from '@quivo/shared';
import { pickRecommendedIds } from './journey.service.js';

function buildOption(overrides: Partial<JourneyOption> & { id: string }): JourneyOption {
  return {
    score: 10,
    estimatedDurationMinutes: 10,
    walkingDistanceMeters: 100,
    transportDistanceMeters: 1000,
    transfers: 0,
    segments: [{ type: 'walk', durationMinutes: 5 }],
    ...overrides,
  };
}

describe('pickRecommendedIds', () => {
  it('no recomienda nada cuando no hay opciones', () => {
    expect(pickRecommendedIds([])).toEqual([]);
  });

  it('recomienda la única opción disponible', () => {
    const options = [buildOption({ id: 'a' })];
    expect(pickRecommendedIds(options)).toEqual(['a']);
  });

  it('no repite una opción que ya gana en más de un eje', () => {
    // "a" es la más rápida, la de menos transbordos y la de menos caminata a la vez.
    const options = [
      buildOption({ id: 'a', score: 1, transfers: 0, walkingDistanceMeters: 50 }),
      buildOption({ id: 'b', score: 5, transfers: 1, walkingDistanceMeters: 300 }),
    ];
    expect(pickRecommendedIds(options)).toEqual(['a']);
  });

  it('destaca una opción distinta por cada eje cuando ninguna domina en todos', () => {
    const options = [
      buildOption({ id: 'fastest', score: 1, transfers: 2, walkingDistanceMeters: 400 }),
      buildOption({ id: 'fewest-transfers', score: 8, transfers: 0, walkingDistanceMeters: 500 }),
      buildOption({ id: 'least-walking', score: 6, transfers: 1, walkingDistanceMeters: 50 }),
    ];
    expect(pickRecommendedIds(options)).toEqual(['fastest', 'fewest-transfers', 'least-walking']);
  });

  it('nunca devuelve más de tres ids', () => {
    const options = [
      buildOption({ id: 'fastest', score: 1, transfers: 2, walkingDistanceMeters: 400 }),
      buildOption({ id: 'fewest-transfers', score: 8, transfers: 0, walkingDistanceMeters: 500 }),
      buildOption({ id: 'least-walking', score: 6, transfers: 1, walkingDistanceMeters: 50 }),
      buildOption({ id: 'other', score: 9, transfers: 3, walkingDistanceMeters: 900 }),
    ];
    expect(pickRecommendedIds(options).length).toBeLessThanOrEqual(3);
  });

  it('desempata por score cuando varias opciones comparten el mínimo de transbordos', () => {
    const options = [
      buildOption({ id: 'a', score: 1, transfers: 0, walkingDistanceMeters: 200 }),
      buildOption({ id: 'b', score: 3, transfers: 0, walkingDistanceMeters: 200 }),
    ];
    expect(pickRecommendedIds(options)).toEqual(['a']);
  });
});
