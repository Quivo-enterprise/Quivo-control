import { describe, expect, it } from 'vitest';
import {
  calcularBearing,
  deltaAnguloCorto,
  distanciaMetros,
  duracionAnimacionMs,
  estaObsoleto,
  interpolarAngulo,
  interpolarLatLng,
  normalizarAngulo,
} from './geo';

describe('normalizarAngulo', () => {
  it('deja sin cambios un ángulo ya en [0,360)', () => {
    expect(normalizarAngulo(0)).toBe(0);
    expect(normalizarAngulo(180)).toBe(180);
    expect(normalizarAngulo(359)).toBe(359);
  });

  it('envuelve un ángulo mayor a 360', () => {
    expect(normalizarAngulo(370)).toBe(10);
    expect(normalizarAngulo(720)).toBe(0);
  });

  it('envuelve un ángulo negativo', () => {
    expect(normalizarAngulo(-10)).toBe(350);
    expect(normalizarAngulo(-370)).toBe(350);
  });
});

describe('deltaAnguloCorto', () => {
  it('cruza la costura 350→10 con +20, no -340', () => {
    expect(deltaAnguloCorto(350, 10)).toBe(20);
  });

  it('cruza la costura 10→350 con -20, no +340', () => {
    expect(deltaAnguloCorto(10, 350)).toBe(-20);
  });

  it('sin cruce de costura, es la resta directa', () => {
    expect(deltaAnguloCorto(10, 30)).toBe(20);
    expect(deltaAnguloCorto(30, 10)).toBe(-20);
  });

  it('en 180° exactos devuelve +180 (arco corto ambiguo, se resuelve hacia el positivo)', () => {
    expect(deltaAnguloCorto(0, 180)).toBe(180);
  });
});

describe('interpolarAngulo', () => {
  it('en t=0 devuelve el ángulo de partida', () => {
    expect(interpolarAngulo(350, 10, 0)).toBe(350);
  });

  it('en t=1 devuelve el ángulo de destino', () => {
    expect(interpolarAngulo(350, 10, 1)).toBe(10);
  });

  it('en 350→10 a mitad de camino (arco corto) da 0, no 180', () => {
    expect(interpolarAngulo(350, 10, 0.5)).toBe(0);
  });

  it('en 10→350 a mitad de camino (arco corto) da 0, no 180', () => {
    expect(interpolarAngulo(10, 350, 0.5)).toBe(0);
  });
});

describe('interpolarLatLng', () => {
  it('en t=0 devuelve el punto de partida', () => {
    expect(interpolarLatLng({ lat: -17.3, lng: -66.1 }, { lat: -17.4, lng: -66.2 }, 0)).toEqual({
      lat: -17.3,
      lng: -66.1,
    });
  });

  it('en t=1 devuelve el punto de destino', () => {
    expect(interpolarLatLng({ lat: -17.3, lng: -66.1 }, { lat: -17.4, lng: -66.2 }, 1)).toEqual({
      lat: -17.4,
      lng: -66.2,
    });
  });

  it('en t=0.5 devuelve el punto medio', () => {
    expect(interpolarLatLng({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.5)).toEqual({
      lat: 5,
      lng: 10,
    });
  });
});

describe('calcularBearing', () => {
  it('hacia el norte puro da 0°', () => {
    expect(calcularBearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5);
  });

  it('hacia el este puro da 90°', () => {
    expect(calcularBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
  });

  it('hacia el sur puro da 180°', () => {
    expect(calcularBearing({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(180, 5);
  });

  it('hacia el oeste puro da 270°', () => {
    expect(calcularBearing({ lat: 0, lng: 1 }, { lat: 0, lng: 0 })).toBeCloseTo(270, 5);
  });
});

describe('distanciaMetros', () => {
  it('devuelve 0 para el mismo punto', () => {
    expect(distanciaMetros({ lat: -17.38, lng: -66.15 }, { lat: -17.38, lng: -66.15 })).toBe(0);
  });

  it('mide una distancia razonable entre dos puntos separados ~111m en latitud (~0.001°)', () => {
    const d = distanciaMetros({ lat: -17.38, lng: -66.15 }, { lat: -17.381, lng: -66.15 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('duracionAnimacionMs', () => {
  it('acota al mínimo de 300ms un Δt muy chico', () => {
    expect(duracionAnimacionMs(0)).toBe(300);
    expect(duracionAnimacionMs(100)).toBe(300);
  });

  it('deja pasar un Δt dentro del rango [300,2500] sin cambios', () => {
    expect(duracionAnimacionMs(300)).toBe(300);
    expect(duracionAnimacionMs(1000)).toBe(1000);
    expect(duracionAnimacionMs(2500)).toBe(2500);
  });

  it('acota al máximo de 2500ms un Δt entre 2500 y 5000', () => {
    expect(duracionAnimacionMs(3000)).toBe(2500);
    expect(duracionAnimacionMs(5000)).toBe(2500);
  });

  it('un hueco mayor a 5000ms cae a una transición rápida de 500ms', () => {
    expect(duracionAnimacionMs(5001)).toBe(500);
    expect(duracionAnimacionMs(60_000)).toBe(500);
  });
});

describe('estaObsoleto', () => {
  it('no es obsoleto justo en el fix (Δ=0)', () => {
    expect(estaObsoleto(1000, 1000)).toBe(false);
  });

  it('no es obsoleto exactamente a los 15000ms (el umbral es estrictamente mayor)', () => {
    expect(estaObsoleto(0, 15_000)).toBe(false);
  });

  it('es obsoleto pasados los 15000ms', () => {
    expect(estaObsoleto(0, 15_001)).toBe(true);
  });
});
