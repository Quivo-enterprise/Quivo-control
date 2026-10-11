import { describe, expect, it } from 'vitest';
import {
  PADDING_ENCUADRE_RUTA,
  PITCH_NAVEGACION,
  ZOOM_NAVEGACION,
  ZOOM_SEGUIMIENTO,
  construirCamaraNavegacion,
  coordenadasEncuadre,
  decidirEncuadre,
  paddingNavegacion,
} from './camara';

describe('constantes de navegación', () => {
  it('pitch 55 y zoom 18', () => {
    expect(PITCH_NAVEGACION).toBe(55);
    expect(ZOOM_NAVEGACION).toBe(18);
    expect(ZOOM_SEGUIMIENTO).toBe(17);
  });
});

describe('construirCamaraNavegacion', () => {
  const pos = { lat: -34.6, lng: -58.4, rumbo: 90 };

  it('manda centro, heading, pitch y zoom en cada cámara', () => {
    expect(construirCamaraNavegacion(pos)).toEqual({
      center: { latitude: -34.6, longitude: -58.4 },
      heading: 90,
      pitch: 55,
      zoom: 18,
    });
  });

  it('sin rumbo no manda heading pero sí pitch y zoom', () => {
    const c = construirCamaraNavegacion({ ...pos, rumbo: null });
    expect(c).not.toHaveProperty('heading');
    expect(c).toEqual({ center: { latitude: -34.6, longitude: -58.4 }, pitch: 55, zoom: 18 });
  });

  it('rumbo 0 (norte) sí se manda', () => {
    expect(construirCamaraNavegacion({ ...pos, rumbo: 0 }).heading).toBe(0);
  });
});

describe('paddingNavegacion', () => {
  it('deja el objetivo de cámara a 2/3 de la banda visible', () => {
    // banda = 800-100-100 = 600; objetivo = 100 + 400 = 500; top = 1000 - 800 + 100 = 300.
    const p = paddingNavegacion({ alto: 800, insetSuperior: 100, insetInferior: 100 });
    expect(p).toEqual({ top: 300, right: 0, bottom: 100, left: 0 });
    // El centro del área con padding es donde Google dibuja el objetivo.
    expect((p.top + 800 - p.bottom) / 2).toBe(500);
  });

  it('insets asimétricos', () => {
    // banda = 900-150-120 = 630; objetivo = 150 + 420 = 570; top = 1140 - 900 + 120 = 360.
    const p = paddingNavegacion({ alto: 900, insetSuperior: 150, insetInferior: 120 });
    expect(p).toEqual({ top: 360, right: 0, bottom: 120, left: 0 });
    expect((p.top + 900 - p.bottom) / 2).toBe(570);
  });

  it('redondea', () => {
    const p = paddingNavegacion({ alto: 801, insetSuperior: 100, insetInferior: 100 });
    expect(Number.isInteger(p.top)).toBe(true);
  });

  it('sin alto medido devuelve ceros', () => {
    expect(paddingNavegacion({ alto: 0, insetSuperior: 100, insetInferior: 100 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('banda degenerada devuelve ceros', () => {
    expect(paddingNavegacion({ alto: 200, insetSuperior: 120, insetInferior: 100 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe('coordenadasEncuadre', () => {
  const ruta = [
    { latitude: 1, longitude: 2 },
    { latitude: 3, longitude: 4 },
  ];
  it('suma el vehículo a la ruta si se lo conoce', () => {
    expect(coordenadasEncuadre(ruta, { lat: 5, lng: 6 })).toEqual([
      ...ruta,
      { latitude: 5, longitude: 6 },
    ]);
  });
  it('sin posición devuelve la ruta tal cual', () => {
    expect(coordenadasEncuadre(ruta, null)).toBe(ruta);
  });
  it('no muta la ruta original', () => {
    coordenadasEncuadre(ruta, { lat: 5, lng: 6 });
    expect(ruta).toHaveLength(2);
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
