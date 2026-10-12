import { describe, expect, it } from 'vitest';
import { desplazarCamino, latLngAPixelContenedor } from './route-map-proyeccion.js';
import { isWithinCentralViewport } from './route-map-geometry.js';

const CENTRO = { lat: -17.3935, lng: -66.157 };
const TAMANO = { x: 800, y: 600 };

describe('latLngAPixelContenedor', () => {
  it('el centro cae en el medio del contenedor', () => {
    const p = latLngAPixelContenedor(CENTRO, CENTRO, 14, TAMANO);
    expect(p.x).toBeCloseTo(400, 6);
    expect(p.y).toBeCloseTo(300, 6);
  });

  it('al este => x mayor; al norte => y menor', () => {
    const este = latLngAPixelContenedor({ ...CENTRO, lng: CENTRO.lng + 0.001 }, CENTRO, 14, TAMANO);
    const norte = latLngAPixelContenedor({ ...CENTRO, lat: CENTRO.lat + 0.001 }, CENTRO, 14, TAMANO);
    expect(este.x).toBeGreaterThan(400);
    expect(norte.y).toBeLessThan(300);
  });

  it('a zoom 14, 0.001° de longitud son 256*2^14/360*0.001 px', () => {
    const p = latLngAPixelContenedor({ ...CENTRO, lng: CENTRO.lng + 0.001 }, CENTRO, 14, TAMANO);
    expect(p.x - 400).toBeCloseTo((256 * 2 ** 14 * 0.001) / 360, 6);
  });

  it('subir un nivel de zoom duplica la distancia en pixeles', () => {
    const punto = { lat: CENTRO.lat + 0.002, lng: CENTRO.lng + 0.003 };
    const a = latLngAPixelContenedor(punto, CENTRO, 13, TAMANO);
    const b = latLngAPixelContenedor(punto, CENTRO, 14, TAMANO);
    expect((b.x - 400) / (a.x - 400)).toBeCloseTo(2, 9);
    expect((b.y - 300) / (a.y - 300)).toBeCloseTo(2, 9);
  });

  it('se combina con isWithinCentralViewport (60% central)', () => {
    const cerca = latLngAPixelContenedor({ ...CENTRO, lng: CENTRO.lng + 0.005 }, CENTRO, 14, TAMANO);
    const lejos = latLngAPixelContenedor({ ...CENTRO, lng: CENTRO.lng + 0.03 }, CENTRO, 14, TAMANO);
    expect(isWithinCentralViewport(cerca, TAMANO)).toBe(true);
    expect(isWithinCentralViewport(lejos, TAMANO)).toBe(false);
  });
});

describe('desplazarCamino', () => {
  type P = { lat: number; lng: number };
  const A: P = { lat: CENTRO.lat, lng: CENTRO.lng };
  const B: P = { lat: CENTRO.lat, lng: CENTRO.lng + 0.01 };
  const ESTE: P[] = [A, B];

  it('offset 0 devuelve el camino sin tocar', () => {
    expect(desplazarCamino(ESTE, 0, 14)).toBe(ESTE);
  });

  it('offset positivo con avance al este desplaza hacia el sur (derecha del avance)', () => {
    const [a] = desplazarCamino(ESTE, 4, 14) as [P];
    expect(a.lat).toBeLessThan(CENTRO.lat);
    expect(a.lng).toBeCloseTo(CENTRO.lng, 9);
  });

  it('el desplazamiento mide offsetPx pixeles a cualquier zoom', () => {
    for (const zoom of [10, 14, 18]) {
      const [a] = desplazarCamino(ESTE, 4, zoom) as [P];
      const pixel = latLngAPixelContenedor(a, A, zoom, TAMANO);
      expect(Math.hypot(pixel.x - 400, pixel.y - 300)).toBeCloseTo(4, 3);
    }
  });

  it('offset negativo va al lado contrario', () => {
    const [a] = desplazarCamino(ESTE, -4, 14) as [P];
    expect(a.lat).toBeGreaterThan(CENTRO.lat);
  });

  it('en una esquina usa la normal promedio y conserva la cantidad de vértices', () => {
    const C: P = { lat: CENTRO.lat - 0.01, lng: CENTRO.lng + 0.01 };
    const r = desplazarCamino([A, B, C], 4, 14) as [P, P, P];
    expect(r).toHaveLength(3);
    expect(r[1].lat).toBeLessThan(B.lat);
    expect(r[1].lng).toBeLessThan(B.lng);
  });

  it('segmentos degenerados (puntos repetidos) no producen NaN', () => {
    const r = desplazarCamino([A, A, B], 4, 14);
    r.forEach((p) => {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lng)).toBe(true);
    });
  });

  /** Desplazamiento en px de pantalla de `despues` respecto de `antes`, a `zoom`. */
  const desplazamientoPx = (antes: P, despues: P, zoom: number) => {
    const a = latLngAPixelContenedor(antes, antes, zoom, TAMANO);
    const d = latLngAPixelContenedor(despues, antes, zoom, TAMANO);
    return { x: d.x - a.x, y: d.y - a.y, dist: Math.hypot(d.x - a.x, d.y - a.y) };
  };

  it('racha de puntos repetidos en el medio: todos se desplazan igual y conserva la cantidad', () => {
    const P1: P = { lat: CENTRO.lat, lng: CENTRO.lng };
    const P2: P = { lat: CENTRO.lat, lng: CENTRO.lng + 0.01 };
    const P3: P = { lat: CENTRO.lat, lng: CENTRO.lng + 0.02 };
    const r = desplazarCamino([P1, P2, P2, P2, P3], 4, 14);
    expect(r).toHaveLength(5);
    [1, 2, 3].forEach((i) => {
      const d = desplazamientoPx(P2, r[i] as P, 14);
      expect(d.dist).toBeCloseTo(4, 3);
      expect(d.x).toBeCloseTo(0, 3);
      expect(d.y).toBeGreaterThan(0); // hacia el sur (derecha del avance al este)
    });
  });

  it('punto repetido al inicio [A, A, B]: ambos puntos se desplazan offsetPx lateralmente', () => {
    const r = desplazarCamino([A, A, B], 4, 14);
    expect(r).toHaveLength(3);
    [0, 1].forEach((i) => {
      const d = desplazamientoPx(A, r[i] as P, 14);
      expect(d.dist).toBeCloseTo(4, 3);
      expect(d.x).toBeCloseTo(0, 3);
    });
  });

  it('esquina de 90°: la mitra mide offsetPx * raíz de 2', () => {
    const C: P = { lat: CENTRO.lat - 0.01, lng: CENTRO.lng + 0.01 };
    const r = desplazarCamino([A, B, C], 4, 14);
    const d = desplazamientoPx(B, r[1] as P, 14);
    expect(d.dist).toBeCloseTo(4 * Math.SQRT2, 2);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBeGreaterThan(0);
  });

  it('horquilla de ~170°: la mitra se acota a 2 * offsetPx y no hay espiga', () => {
    const giro = 0.01 * Math.tan((5 * Math.PI) / 180); // vuelve con 5° de desvío
    const C: P = { lat: CENTRO.lat - giro, lng: CENTRO.lng };
    const r = desplazarCamino([A, B, C], 4, 14);
    const d = desplazamientoPx(B, r[1] as P, 14);
    expect(Number.isFinite(d.dist)).toBe(true);
    expect(d.dist).toBeLessThanOrEqual(8 + 1e-6);
    expect(d.dist).toBeCloseTo(8, 2);
  });

  it('reversión exacta (U): finito y desplazado offsetPx hacia el lado del tramo previo', () => {
    const r = desplazarCamino([A, B, A], 4, 14);
    const d = desplazamientoPx(B, r[1] as P, 14);
    expect(Number.isFinite(d.dist)).toBe(true);
    expect(d.dist).toBeCloseTo(4, 3);
    expect(d.x).toBeCloseTo(0, 3);
    expect(d.y).toBeGreaterThan(0);
  });
});
