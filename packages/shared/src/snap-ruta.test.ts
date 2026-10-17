import { describe, expect, it } from 'vitest';
import { distanciaMetros } from './geo.js';
import {
  MAX_FALLOS_SNAP,
  debeInterpolarPorRuta,
  interpolarSobreRuta,
  prepararRutaSnap,
  puntoEnDistancia,
  snapARuta,
  tramoDeRuta,
  type FixSnap,
} from './snap-ruta.js';

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

// Avenida 2+2: la ruta va por un carril hacia el norte y vuelve por el otro hacia el sur. El
// tramo final de 100 m deja inicio y fin a > 50 m: es una ruta abierta (sin wrap).
const avenida = prepararRutaSnap([en(0, 0), en(200, 0), en(200, 10), en(0, 10), en(-100, 10)])!;

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
    expect(
      snapARuta(recta, fix(en(100, 2), { rumbo: 180, velocidadMs: 0.5 }), null),
    ).not.toBeNull();
    expect(
      snapARuta(recta, fix(en(100, 2), { rumbo: 180, velocidadMs: null }), null),
    ).not.toBeNull();
  });

  it('histéresis: se queda en el tramo anterior aunque otro quede un poco más cerca', () => {
    // Dos carriles a 10 m, sin rumbo: el fix está más cerca del carril sur (índice 2).
    const punto = en(100, 6);
    expect(snapARuta(avenida, fix(punto), null)!.indiceSegmento).toBe(2);
    expect(snapARuta(avenida, fix(punto), { indiceSegmento: 0 })!.indiceSegmento).toBe(0);
  });

  // Ruta larga (3950 m) en recta hacia el norte, un segmento cada 50 m.
  const larga = prepararRutaSnap(Array.from({ length: 80 }, (_, i) => en(i * 50, 0)))!;

  it('histéresis: en marcha, si la ventana no tiene candidato aceptable, busca global', () => {
    const r = snapARuta(larga, fix(en(3520, 2), { rumbo: 0, velocidadMs: 10 }), {
      indiceSegmento: 0,
    })!;
    expect(r.indiceSegmento).toBe(70);
  });

  it('parado/lento con tramo anterior: no salta a un tramo lejano hasta superar los fallos', () => {
    const lejos = fix(en(3520, 2), { velocidadMs: 0 });
    expect(snapARuta(larga, lejos, { indiceSegmento: 0 })).toBeNull();
    expect(snapARuta(larga, lejos, { indiceSegmento: 0 }, MAX_FALLOS_SNAP - 1)).toBeNull();
    expect(snapARuta(larga, lejos, { indiceSegmento: 0 }, MAX_FALLOS_SNAP)!.indiceSegmento).toBe(
      70,
    );
  });

  it('parado en un semáforo junto al carril opuesto: conserva su carril', () => {
    // Avenida 2+2 con carriles a 10 m; el vehículo viene por el sur→norte (índice 0) y se detiene
    // un poco más cerca del carril opuesto (índice 2). Parado no hay rumbo que desempate.
    const parado = fix(en(100, 6), { velocidadMs: 0 });
    const r = snapARuta(avenida, parado, { indiceSegmento: 0 })!;
    expect(r.indiceSegmento).toBe(0);
  });

  it('circuito cerrado: la ventana de histéresis da la vuelta por el punto de cierre', () => {
    const circuito = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100), en(0, 100), en(0, 0)])!;
    expect(circuito.cerrada).toBe(true);
    const n = circuito.segmentos.length; // 4
    // Último segmento (índice 3): de (0,100) a (0,0) hacia el oeste. Sigue en el primero (norte).
    const pasando = fix(en(8, 0), { rumbo: 0, velocidadMs: 8 });
    const r = snapARuta(circuito, pasando, { indiceSegmento: n - 1 })!;
    expect(r.indiceSegmento).toBe(0);
    // Parado justo después del cierre, con el último segmento como anterior: la ventana (sin
    // búsqueda global) alcanza el segmento 0 por wrap.
    const parado = fix(en(8, 2), { velocidadMs: 0 });
    expect(snapARuta(circuito, parado, { indiceSegmento: n - 1 })!.indiceSegmento).toBe(0);
    // Y al revés: el segmento 0 como anterior alcanza el último al retroceder.
    const antes = fix(en(2, 40), { velocidadMs: 0 });
    expect(snapARuta(circuito, antes, { indiceSegmento: 0 })!.indiceSegmento).toBe(3);
  });
});

describe('debeInterpolarPorRuta', () => {
  it('mismo carril: el recorrido por la calle ~ la cuerda', () => {
    expect(debeInterpolarPorRuta(recta, 50, 80, 30)).toBe(true);
  });
  it('ida y vuelta por carriles pegados: el recorrido es enorme frente a la cuerda', () => {
    // avenida: sube 200 m, cruza 10 m y baja. Punto a 20 m del inicio (carril norte) y su
    // opuesto en el carril sur (distancia acumulada 200 + 10 + 180 = 390): cuerda ~10 m.
    const a = snapARuta(avenida, fix(en(20, 0)), null)!;
    const b = snapARuta(avenida, fix(en(20, 10)), null)!;
    expect(b.indiceSegmento).toBe(2);
    const cuerda = distanciaMetros(a, b);
    expect(cuerda).toBeCloseTo(10, 0);
    expect(debeInterpolarPorRuta(avenida, a.distanciaRecorrida, b.distanciaRecorrida, cuerda)).toBe(
      false,
    );
  });
  it('tolera cuerda corta con margen fijo de 30 m', () => {
    expect(debeInterpolarPorRuta(recta, 0, 36, 5)).toBe(false);
    expect(debeInterpolarPorRuta(recta, 0, 35, 5)).toBe(true);
  });
  it('circuito cerrado: pasar por el cierre cuenta el camino corto', () => {
    const circuito = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100), en(0, 100), en(0, 0)])!;
    expect(debeInterpolarPorRuta(circuito, circuito.largoTotal - 10, 10, 20)).toBe(true);
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

describe('snap a la mitad de la fase (circuito ida/regreso)', () => {
  // Ida hacia el este por la calle y=0; regreso por la MISMA calle hacia el oeste con un desvío al
  // norte (y=40). Una polilínea por mitad: el snap solo ve el trazado de su fase.
  const ida = prepararRutaSnap([en(0, 0), en(0, 200), en(0, 400)])!;
  const regreso = prepararRutaSnap([en(0, 400), en(40, 400), en(40, 0)])!;

  it('en la ida, un fix sobre el desvío del regreso no engancha; en el regreso sí', () => {
    const sobreDesvio = fix(en(40, 200));
    expect(snapARuta(ida, sobreDesvio, null)).toBeNull();
    expect(snapARuta(regreso, sobreDesvio, null)).not.toBeNull();
  });

  it('un fix sobre la calle compartida engancha con la mitad de su fase', () => {
    const r = snapARuta(ida, fix(en(2, 100)), null);
    expect(r).not.toBeNull();
    expect(r!.distanciaRecorrida).toBeCloseTo(100, 0);
  });
});

describe('tramoDeRuta', () => {
  it('incluye extremos interpolados y la esquina entre ellos', () => {
    const t = tramoDeRuta(ele, 80, 120);
    expect(t).toHaveLength(3);
    expect(distanciaMetros(t[0]!, en(80, 0))).toBeLessThan(0.5);
    expect(distanciaMetros(t[1]!, en(100, 0))).toBeLessThan(0.5);
    expect(distanciaMetros(t[2]!, en(100, 20))).toBeLessThan(0.5);
  });

  it('sin vértices intermedios devuelve solo los extremos', () => {
    expect(tramoDeRuta(recta, 10, 50)).toHaveLength(2);
  });

  it('hacia atrás recorre los vértices en orden inverso', () => {
    const t = tramoDeRuta(ele, 120, 80);
    expect(t).toHaveLength(3);
    expect(distanciaMetros(t[0]!, en(100, 20))).toBeLessThan(0.5);
    expect(distanciaMetros(t[1]!, en(100, 0))).toBeLessThan(0.5);
    expect(distanciaMetros(t[2]!, en(80, 0))).toBeLessThan(0.5);
  });

  it('ruta larga (2000 segmentos): mismos vértices que un barrido lineal', () => {
    const larga = prepararRutaSnap(Array.from({ length: 2001 }, (_, i) => en(i * 10, (i % 2) * 3)))!;
    for (const [d0, d1] of [[15, 95], [9000, 9500], [12000, 300], [0, larga.largoTotal]] as const) {
      const lo = Math.min(d0, d1);
      const hi = Math.max(d0, d1);
      const esperados = larga.segmentos.filter((s) => s.acumulado > lo && s.acumulado < hi).length;
      expect(tramoDeRuta(larga, d0, d1)).toHaveLength(esperados + 2);
    }
  });

  it('circuito cerrado: da la vuelta por el cierre', () => {
    const circuito = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100), en(0, 100), en(0, 0)])!;
    // De 10 m antes del cierre a 10 m después: extremos + el vértice de cierre (origen).
    const t = tramoDeRuta(circuito, circuito.largoTotal - 10, 10);
    expect(t).toHaveLength(3);
    expect(distanciaMetros(t[0]!, en(0, 10))).toBeLessThan(0.5);
    expect(distanciaMetros(t[1]!, en(0, 0))).toBeLessThan(0.5);
    expect(distanciaMetros(t[2]!, en(10, 0))).toBeLessThan(0.5);
  });
});
