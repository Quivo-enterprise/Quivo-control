import { describe, expect, it } from 'vitest';
import { latLngAPixelContenedor } from './route-map-proyeccion.js';
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
