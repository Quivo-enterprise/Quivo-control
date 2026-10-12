import { describe, expect, it } from 'vitest';
import { distanciaMetros } from './geo';
import {
  interpolarSobreRuta,
  prepararRutaSnap,
  puntoEnDistancia,
  snapARuta,
  type FixSnap,
} from './snap-ruta';

// ~1 m en grados, cerca de lat -34.6.
const M_LAT = 1 / 111_195;
const M_LNG = 1 / (111_195 * Math.cos((-34.6 * Math.PI) / 180));
const BASE = { lat: -34.6, lng: -58.4 };
const en = (norteM: number, esteM: number) => ({
  lat: BASE.lat + norteM * M_LAT,
  lng: BASE.lng + esteM * M_LNG,
});
const fix = (p: { lat: number; lng: number }, extra: Partial<FixSnap> = {}): FixSnap => ({
  ...p,
  rumbo: null,
  velocidadMs: null,
  accuracy: null,
  ...extra,
});

// Recta de 200 m hacia el norte.
const recta = prepararRutaSnap([en(0, 0), en(100, 0), en(200, 0)])!;
// En L: 100 m norte y 100 m este.
const ele = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100)])!;

describe('prepararRutaSnap', () => {
  it('null con menos de 2 puntos distintos', () => {
    expect(prepararRutaSnap([])).toBeNull();
    expect(prepararRutaSnap([en(0, 0)])).toBeNull();
    expect(prepararRutaSnap([en(0, 0), en(0, 0)])).toBeNull();
  });
  it('acumula el largo', () => {
    expect(recta.largoTotal).toBeCloseTo(200, 0);
    expect(recta.cerrada).toBe(false);
  });
});

describe('snapARuta', () => {
  it('proyecta sobre una recta y toma el bearing del segmento', () => {
    const r = snapARuta(recta, fix(en(150, 8)), null)!;
    expect(r).not.toBeNull();
    expect(r.distanciaAlEje).toBeCloseTo(8, 0);
    expect(r.distanciaRecorrida).toBeCloseTo(150, 0);
    expect(r.rumbo).toBeCloseTo(0, 3);
    expect(distanciaMetros(r, en(150, 0))).toBeLessThan(0.5);
  });

  it('esquina en L: el bearing cambia al pasar al segundo tramo', () => {
    expect(snapARuta(ele, fix(en(50, 3)), null)!.rumbo).toBeCloseTo(0, 3);
    const r = snapARuta(ele, fix(en(97, 60)), null)!;
    expect(r.rumbo).toBeCloseTo(90, 3);
    expect(r.distanciaRecorrida).toBeCloseTo(160, 0);
  });

  it('fuera de ruta devuelve null', () => {
    expect(snapARuta(recta, fix(en(100, 60)), null)).toBeNull();
    // Con accuracy 100 el tope es 40 m.
    expect(snapARuta(recta, fix(en(100, 45), { accuracy: 100 }), null)).toBeNull();
    expect(snapARuta(recta, fix(en(100, 35), { accuracy: 100 }), null)).not.toBeNull();
  });

  it('sin accuracy el umbral es 25 m', () => {
    expect(snapARuta(recta, fix(en(100, 24)), null)).not.toBeNull();
    expect(snapARuta(recta, fix(en(100, 26)), null)).toBeNull();
  });

  // Avenida 2+2: la ruta va por un carril hacia el norte y vuelve por el otro hacia el sur.
  const avenida = prepararRutaSnap([en(0, 0), en(200, 0), en(200, 10), en(0, 10)])!;
  it('carriles opuestos solapados: el rumbo elige el sentido correcto', () => {
    const punto = en(100, 5); // equidistante de ambos carriles
    const norte = snapARuta(avenida, fix(punto, { rumbo: 0, velocidadMs: 8 }), null)!;
    const sur = snapARuta(avenida, fix(punto, { rumbo: 180, velocidadMs: 8 }), null)!;
    expect(norte.rumbo).toBeCloseTo(0, 3);
    expect(sur.rumbo).toBeCloseTo(180, 3);
    expect(norte.indiceSegmento).not.toBe(sur.indiceSegmento);
  });

  it('rumbo opuesto al único segmento cercano: rechaza', () => {
    expect(snapARuta(recta, fix(en(100, 2), { rumbo: 180, velocidadMs: 8 }), null)).toBeNull();
  });

  it('a baja velocidad ignora el rumbo', () => {
    expect(snapARuta(recta, fix(en(100, 2), { rumbo: 180, velocidadMs: 0.5 }), null)).not.toBeNull();
    expect(snapARuta(recta, fix(en(100, 2), { rumbo: 180, velocidadMs: null }), null)).not.toBeNull();
  });

  it('histéresis: se queda en el tramo anterior aunque otro quede un poco más cerca', () => {
    // Dos carriles a 10 m, sin rumbo: el fix está más cerca del carril sur (índice 2).
    const punto = en(100, 6);
    expect(snapARuta(avenida, fix(punto), null)!.indiceSegmento).toBe(2);
    expect(snapARuta(avenida, fix(punto), { indiceSegmento: 0 })!.indiceSegmento).toBe(0);
  });

  it('histéresis: si la ventana no tiene candidato aceptable, busca global', () => {
    const larga = prepararRutaSnap(Array.from({ length: 80 }, (_, i) => en(i * 50, 0)))!;
    const r = snapARuta(larga, fix(en(3520, 2)), { indiceSegmento: 0 })!;
    expect(r.indiceSegmento).toBe(70);
  });
});

describe('interpolarSobreRuta', () => {
  it('sigue la esquina en vez de cortarla', () => {
    // De 80 m a 120 m (la esquina está a 100 m), en t = 0.5 está en la esquina.
    const p = interpolarSobreRuta(ele, 80, 120, 0.5);
    expect(distanciaMetros(p, en(100, 0))).toBeLessThan(0.5);
    expect(interpolarSobreRuta(ele, 80, 120, 0.25).rumbo).toBeCloseTo(0, 3);
    expect(interpolarSobreRuta(ele, 80, 120, 0.9).rumbo).toBeCloseTo(90, 3);
  });

  it('t = 0 y t = 1 caen en los extremos', () => {
    expect(distanciaMetros(interpolarSobreRuta(recta, 20, 60, 0), en(20, 0))).toBeLessThan(0.5);
    expect(distanciaMetros(interpolarSobreRuta(recta, 20, 60, 1), en(60, 0))).toBeLessThan(0.5);
  });

  it('retroceso chico en ruta abierta interpola hacia atrás', () => {
    const p = interpolarSobreRuta(recta, 100, 90, 1);
    expect(distanciaMetros(p, en(90, 0))).toBeLessThan(0.5);
  });

  it('circuito cerrado: pasar del final al inicio da la vuelta hacia adelante', () => {
    const circuito = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100), en(0, 100), en(0, 0)])!;
    expect(circuito.cerrada).toBe(true);
    // De 10 m antes del cierre a 10 m después: el punto medio es el origen.
    const p = interpolarSobreRuta(circuito, circuito.largoTotal - 10, 10, 0.5);
    expect(distanciaMetros(p, en(0, 0))).toBeLessThan(0.5);
  });

  it('puntoEnDistancia acota fuera de rango', () => {
    expect(distanciaMetros(puntoEnDistancia(recta, -5), en(0, 0))).toBeLessThan(0.5);
    expect(distanciaMetros(puntoEnDistancia(recta, 999), en(200, 0))).toBeLessThan(0.5);
  });
});
