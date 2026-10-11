import { describe, expect, it } from 'vitest';
import {
  PADDING_ENCUADRE_RUTA,
  ZOOM_SEGUIMIENTO,
  construirCamaraSeguimiento,
  decidirEncuadre,
} from './camara';

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

describe('decidirEncuadre — guarda contra una ruta sin coordenadas', () => {
  it('con geometría ajusta a la ruta, haya o no posición', () => {
    expect(decidirEncuadre(12, false)).toBe('ajustar-ruta');
    expect(decidirEncuadre(12, true)).toBe('ajustar-ruta');
  });

  it('ruta vacía y posición conocida: centra en el vehículo en vez de tirar', () => {
    expect(decidirEncuadre(0, true)).toBe('centrar-posicion');
  });

  it('ruta vacía y sin posición: no toca la vista', () => {
    expect(decidirEncuadre(0, false)).toBe('nada');
  });
});

describe('PADDING_ENCUADRE_RUTA', () => {
  it('conserva los márgenes del fitBounds de Leaflet (80 arriba, 180 abajo, 20 a los lados)', () => {
    expect(PADDING_ENCUADRE_RUTA).toEqual({ top: 80, right: 20, bottom: 180, left: 20 });
  });
});
