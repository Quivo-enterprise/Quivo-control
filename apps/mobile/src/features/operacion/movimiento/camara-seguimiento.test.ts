import { describe, expect, it } from 'vitest';
import { ZOOM_SEGUIMIENTO, construirCamaraSeguimiento } from './camara-seguimiento';

describe('construirCamaraSeguimiento', () => {
  const pos = { lat: -34.6, lng: -58.4, rumbo: 90 };

  it('incluye zoom 17 solo al entrar en seguimiento', () => {
    expect(ZOOM_SEGUIMIENTO).toBe(17);
    expect(construirCamaraSeguimiento(pos, true)).toEqual({
      center: { latitude: -34.6, longitude: -58.4 },
      heading: 90,
      zoom: 17,
    });
  });

  it('no manda zoom en los fixes siguientes (respeta el pinch del usuario)', () => {
    expect(construirCamaraSeguimiento(pos, false)).not.toHaveProperty('zoom');
  });

  it('sin rumbo no manda heading', () => {
    expect(construirCamaraSeguimiento({ ...pos, rumbo: null }, false)).toEqual({
      center: { latitude: -34.6, longitude: -58.4 },
    });
  });
});
