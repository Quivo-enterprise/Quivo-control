import { describe, expect, it } from 'vitest';
import { diffOverlayMarkers, type MapOverlayMarker } from './route-map-overlay-markers.js';

function marker(id: string, lat = 0, lng = 0, extra: Partial<MapOverlayMarker> = {}): MapOverlayMarker {
  return { id, lat, lng, content: null, ...extra };
}

describe('diffOverlayMarkers', () => {
  it('marca como alta cada id que no estaba en el set anterior', () => {
    const result = diffOverlayMarkers([], [marker('a'), marker('b')]);
    expect(result.add.map((m) => m.id)).toEqual(['a', 'b']);
    expect(result.update).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('marca como actualización cada id que ya estaba montado', () => {
    const result = diffOverlayMarkers(['a'], [marker('a', 1, 2)]);
    expect(result.add).toEqual([]);
    expect(result.update).toEqual([marker('a', 1, 2)]);
    expect(result.remove).toEqual([]);
  });

  it('marca como baja cada id que ya no aparece en next', () => {
    const result = diffOverlayMarkers(['a', 'b'], []);
    expect(result.add).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.remove.sort()).toEqual(['a', 'b']);
  });

  it('combina alta, actualización y baja en un solo diff', () => {
    const result = diffOverlayMarkers(['a', 'b'], [marker('b', 9, 9), marker('c')]);
    expect(result.add.map((m) => m.id)).toEqual(['c']);
    expect(result.update).toEqual([marker('b', 9, 9)]);
    expect(result.remove).toEqual(['a']);
  });

  it('respeta zIndex/anchor al pasar de alta a actualización', () => {
    const withStyle = marker('a', 1, 1, { anchor: 'bottom', zIndex: 5 });
    const result = diffOverlayMarkers(['a'], [withStyle]);
    expect(result.update).toEqual([withStyle]);
  });

  it('con ids duplicados en next (sin montar aún), el último gana: una sola alta, sin huérfanos', () => {
    const result = diffOverlayMarkers([], [marker('a', 1, 1), marker('a', 2, 2)]);
    expect(result.add).toEqual([marker('a', 2, 2)]);
    expect(result.update).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('con ids duplicados en next (ya montado), se resuelve como una sola actualización: el último gana', () => {
    const result = diffOverlayMarkers(['a'], [marker('a', 1, 1), marker('a', 2, 2)]);
    expect(result.add).toEqual([]);
    expect(result.update).toEqual([marker('a', 2, 2)]);
    expect(result.remove).toEqual([]);
  });

  it('no hace nada con prevIds y next vacíos — comportamiento default sin overlayMarkers', () => {
    expect(diffOverlayMarkers([], [])).toEqual({ add: [], update: [], remove: [] });
  });

  it('acepta cualquier iterable de ids como prevIds, no solo arrays (ej. las keys de un Map)', () => {
    const mounted = new Map<string, unknown>([['a', {}], ['b', {}]]);
    const result = diffOverlayMarkers(mounted.keys(), [marker('a')]);
    expect(result.update.map((m) => m.id)).toEqual(['a']);
    expect(result.remove).toEqual(['b']);
  });
});
