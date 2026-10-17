import { describe, expect, it } from 'vitest';
import { centroVisibleDesplazado, FOLLOW_CENTRAL_FRACTION, isWithinCentralViewport } from './route-map-geometry.js';

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

describe('isWithinCentralViewport con relleno (HUD / panel)', () => {
  const size = { x: 1000, y: 800 };
  const relleno = { top: 200, right: 0, bottom: 0, left: 0 };
  it('un punto central del contenedor entero pero bajo el HUD ya no cuenta como central', () => {
    // Rect visible y 200..800; 60 % central = y 320..680. El punto en y=250 estaba dentro del 60 % del contenedor.
    expect(isWithinCentralViewport({ x: 500, y: 250 }, size)).toBe(true);
    expect(isWithinCentralViewport({ x: 500, y: 250 }, size, FOLLOW_CENTRAL_FRACTION, relleno)).toBe(false);
  });
  it('el centro del rectángulo visible es central', () => {
    expect(isWithinCentralViewport({ x: 500, y: 500 }, size, FOLLOW_CENTRAL_FRACTION, relleno)).toBe(true);
    expect(isWithinCentralViewport({ x: 500, y: 700 }, size, FOLLOW_CENTRAL_FRACTION, relleno)).toBe(false);
  });
  it('un relleno que anula el contenedor se ignora', () => {
    expect(isWithinCentralViewport({ x: 500, y: 400 }, size, FOLLOW_CENTRAL_FRACTION, { top: 500, right: 0, bottom: 400, left: 0 })).toBe(true);
  });
  it('sin relleno es idéntico al comportamiento anterior', () => {
    expect(isWithinCentralViewport({ x: 100, y: 100 }, size, FOLLOW_CENTRAL_FRACTION, { top: 0, right: 0, bottom: 0, left: 0 })).toBe(
      isWithinCentralViewport({ x: 100, y: 100 }, size),
    );
  });
});

describe('centroVisibleDesplazado', () => {
  it('HUD arriba y panel a la derecha: el centro visible queda abajo-izquierda del centro', () => {
    expect(centroVisibleDesplazado({ x: 1000, y: 800 }, { top: 200, right: 400, bottom: 0, left: 0 })).toEqual({ x: -200, y: 100 });
  });
  it('sin relleno no hay desplazamiento', () => {
    expect(centroVisibleDesplazado({ x: 1000, y: 800 })).toEqual({ x: 0, y: 0 });
  });
});
