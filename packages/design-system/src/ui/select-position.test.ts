import { describe, expect, it } from 'vitest';
import {
  SELECT_GAP,
  SELECT_MIN_HEIGHT,
  SELECT_VIEWPORT_MARGIN,
  computeSelectPosition,
} from './form.js';

const rectAt = (top: number, height = 40) => ({ top, bottom: top + height, left: 20, width: 200 });

describe('computeSelectPosition', () => {
  it('abre hacia abajo cuando cabe', () => {
    const r = rectAt(100);
    const pos = computeSelectPosition({
      viewportHeight: 800,
      rect: r,
      contentHeight: 200,
      cap: 256,
    });
    expect(pos).toEqual({ left: 20, width: 200, top: r.bottom + SELECT_GAP, maxHeight: 256 });
  });

  it('hace flip hacia arriba cuando hay más espacio arriba', () => {
    const r = rectAt(700);
    const pos = computeSelectPosition({
      viewportHeight: 800,
      rect: r,
      contentHeight: 300,
      cap: 256,
    });
    expect(pos?.top).toBeUndefined();
    expect(pos?.bottom).toBe(800 - r.top + SELECT_GAP);
    expect(pos?.maxHeight).toBe(256);
  });

  it('acota maxHeight al espacio disponible', () => {
    const r = rectAt(500);
    const space = 800 - r.bottom - SELECT_GAP - SELECT_VIEWPORT_MARGIN;
    const pos = computeSelectPosition({
      viewportHeight: 800,
      rect: r,
      contentHeight: 256,
      cap: 256,
    });
    // abajo hay 246 < 256 pero arriba hay más: flip y tope 256 (cap)
    expect(pos?.bottom).toBeDefined();
    const small = computeSelectPosition({
      viewportHeight: 300,
      rect: rectAt(100),
      contentHeight: 256,
      cap: 256,
    });
    expect(small?.top).toBeDefined();
    expect(small?.maxHeight).toBe(300 - 140 - SELECT_GAP - SELECT_VIEWPORT_MARGIN);
    expect(space).toBeGreaterThan(0);
  });

  it('elige el lado con más espacio y garantiza altura mínima usable', () => {
    const pos = computeSelectPosition({
      viewportHeight: 100,
      rect: rectAt(30, 40),
      contentHeight: 256,
      cap: 256,
    });
    expect(pos?.maxHeight).toBe(SELECT_MIN_HEIGHT);
    const short = computeSelectPosition({
      viewportHeight: 100,
      rect: rectAt(30, 40),
      contentHeight: 40,
      cap: 256,
    });
    expect(short?.maxHeight).toBe(40);
  });

  it('trigger fuera del viewport devuelve null', () => {
    expect(
      computeSelectPosition({
        viewportHeight: 800,
        rect: rectAt(-100, 40),
        contentHeight: 100,
        cap: 256,
      }),
    ).toBeNull();
    expect(
      computeSelectPosition({
        viewportHeight: 800,
        rect: rectAt(800),
        contentHeight: 100,
        cap: 256,
      }),
    ).toBeNull();
  });

  it('sin contentHeight asume el tope', () => {
    const pos = computeSelectPosition({
      viewportHeight: 400,
      rect: rectAt(200),
      contentHeight: undefined,
      cap: 256,
    });
    expect(pos?.bottom).toBeDefined();
  });
});
