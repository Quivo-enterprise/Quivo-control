import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  distanciaAPolilineaM,
  partirCircuitoPorRetorno,
  prepararCircuito,
  progresoEnCircuito,
  separacionCircular,
} from './circuito.js';
import { haversineMetros } from './geo.js';

// Circuito de juguete (≈ 111 m por 0.001°): sale por el sur hacia el este (ida), sube y vuelve por
// el norte hacia el oeste (regreso). El retorno está en el extremo este.
const GRADO_M = 111_195;
const circuito: [number, number][] = [
  [0, 0],
  [0.01, 0],
  [0.02, 0], // retorno aquí
  [0.02, 0.0005],
  [0.01, 0.0005],
  [0, 0.0005],
  [0, 0],
];
const retorno: [number, number] = [0.02, 0.00001];

describe('partirCircuitoPorRetorno', () => {
  it('parte en ida y regreso insertando el punto proyectado en ambas mitades', () => {
    const r = partirCircuitoPorRetorno(circuito, retorno)!;
    expect(r).not.toBeNull();
    const corteIda = r.ida[r.ida.length - 1]!;
    expect(r.regreso[0]).toEqual(corteIda);
    expect(corteIda[0]).toBeCloseTo(0.02, 5);
    expect(r.ida[0]).toEqual([0, 0]);
    expect(r.regreso[r.regreso.length - 1]).toEqual([0, 0]);
  });

  it('con una polilínea que pasa dos veces cerca del retorno corta en la PRIMERA pasada', () => {
    // Ida y regreso casi superpuestos: el regreso pasa a ~20 m del retorno, la ida a ~1 m.
    const doble: [number, number][] = [
      [0, 0],
      [0.01, 0],
      [0.02, 0.00001],
      [0.02, 0.0002],
      [0.01, 0.0002],
      [0, 0.0002],
    ];
    const r = partirCircuitoPorRetorno(doble, [0.02, 0.0001])!;
    expect(r).not.toBeNull();
    // La primera aproximación (segmento 2→3, el que roza el retorno) manda: el corte NO se
    // desplaza al tramo de regreso (4→5), que también pasa a ~11 m.
    expect(r.ida).toHaveLength(4);
    expect(r.regreso).toHaveLength(4);
  });

  it('corta en el mínimo global de la primera racha cercana, no en el primer mínimo local', () => {
    // Retorno a (100,100) m. La ida roza a 100 m en x=100 (mínimo local), sigue a x=200, sube y
    // gira al oeste hasta llegar al retorno: el corte real es el final de esa racha (distancia 0).
    const m = (x: number, y: number): [number, number] => [x / GRADO_M, y / GRADO_M];
    const ida = [m(0, 0), m(100, 0), m(200, 0), m(200, 100), m(100, 100), m(100, 300), m(0, 300)];
    const r = partirCircuitoPorRetorno(ida, m(100, 100))!;
    expect(r).not.toBeNull();
    expect(r.ida).toHaveLength(5);
    expect(r.regreso).toHaveLength(4);
    expect(r.ida[r.ida.length - 1]![0]).toBeCloseTo(100 / GRADO_M, 7);
    expect(r.ida[r.ida.length - 1]![1]).toBeCloseTo(100 / GRADO_M, 7);
  });

  it('devuelve null si la polilínea nunca pasa a radioM del retorno', () => {
    expect(partirCircuitoPorRetorno(circuito, [0.02, 0.01])).toBeNull();
    expect(partirCircuitoPorRetorno(circuito, [0.02, 0.0005], 0.5)).not.toBeNull();
  });

  it('devuelve null si el retorno cae en un extremo (mitad degenerada)', () => {
    expect(partirCircuitoPorRetorno(circuito, [0, 0])).toBeNull();
  });
});

describe('distanciaAPolilineaM', () => {
  it('mide la distancia perpendicular al segmento más cercano', () => {
    const d = distanciaAPolilineaM([0.005, 0.0001], circuito);
    expect(d).toBeCloseTo(0.0001 * GRADO_M, 0);
  });

  it('polilínea sin segmentos: Infinity', () => {
    expect(distanciaAPolilineaM([0, 0], [[0, 0]])).toBe(Infinity);
  });
});

// Geometría real de la L16 (circuito cerrado de ~30,3 km que sale y llega a Salomón Romero) y su PC
// de retorno (Honduras), tal como estaban en prod el 14/10. Ida y regreso comparten calles.
const l16 = JSON.parse(
  readFileSync(new URL('./fixtures/l16-circuito.json', import.meta.url), 'utf8'),
) as { ruta: [number, number][]; retorno: [number, number]; terminal: [number, number] };

/** Punto a `s` metros del inicio de la polilínea (interpolación por tramo). */
function puntoA(polilinea: [number, number][], s: number): [number, number] {
  let acumulado = 0;
  for (let i = 0; i < polilinea.length - 1; i += 1) {
    const a = polilinea[i]!;
    const b = polilinea[i + 1]!;
    const largo = haversineMetros(a, b);
    if (acumulado + largo >= s) {
      const t = (s - acumulado) / largo;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acumulado += largo;
  }
  return polilinea[polilinea.length - 1]!;
}

describe('progresoEnCircuito (L16 real)', () => {
  const { ruta, retorno } = l16;
  const TOL = 100;
  const cir = prepararCircuito(ruta, retorno);
  const sinRetorno = prepararCircuito(ruta, null);
  const largoIda = cir.largoIdaM;
  const prog = (p: [number, number], fase: 'ida' | 'regreso' | null) =>
    progresoEnCircuito(p, cir, fase, TOL);
  // Punto del regreso que está sobre una calle compartida con la ida (distancia 0 a ambas).
  const compartido: [number, number] = [-66.18631, -17.34957];

  it('el circuito es circular y el largo coincide con ida + regreso', () => {
    const p = prog(compartido, 'regreso');
    expect(p.circular).toBe(true);
    expect(p.largoM).toBeGreaterThan(30_000);
    expect(p.largoM).toBeLessThan(30_600);
    expect(largoIda).toBeGreaterThan(14_500);
    expect(largoIda).toBeLessThan(15_200);
  });

  it('punto en calle compartida: cae en la mitad de SU fase', () => {
    const ida = prog(compartido, 'ida');
    const regreso = prog(compartido, 'regreso');
    expect(ida.progresoM).toBeLessThan(largoIda);
    expect(regreso.progresoM).toBeGreaterThan(largoIda);
    expect(ida.distanciaAlTrazadoM).toBeLessThan(5);
    expect(regreso.distanciaAlTrazadoM).toBeLessThan(5);
    // La proyección global (lógica anterior) lo manda a la ida aunque vaya de regreso: ~16 km de error.
    const global = progresoEnCircuito(compartido, sinRetorno, null, TOL);
    expect(global.progresoM).toBeLessThan(largoIda);
    expect(regreso.progresoM - global.progresoM).toBeGreaterThan(10_000);
  });

  it('sin fase o sin retorno proyecta en toda la polilínea', () => {
    const global = progresoEnCircuito(compartido, sinRetorno, null, TOL);
    expect(prog(compartido, null).progresoM).toBe(global.progresoM);
    expect(progresoEnCircuito(compartido, sinRetorno, 'regreso', TOL).progresoM).toBe(
      global.progresoM,
    );
  });

  it('cierre: uno saliendo de la terminal y otro llegando quedan a pocos metros, no a una vuelta', () => {
    const { largoM } = cir;
    const sale = prog(puntoA(ruta, 200), 'ida');
    const llega = prog(puntoA(ruta, largoM - 150), 'regreso');
    expect(sale.progresoM).toBeCloseTo(200, -1);
    expect(llega.progresoM).toBeGreaterThan(largoM - 200);
    // Desde el que sale, el que llega va detrás (~350 m); la distancia lineal sería ~30 km.
    const sep = separacionCircular(sale.progresoM, llega.progresoM, largoM, true);
    expect(sep.lado).toBe('detras');
    expect(sep.distanciaM).toBeGreaterThan(300);
    expect(sep.distanciaM).toBeLessThan(400);
    // Y al revés, el que llega ve al que sale delante a la misma distancia.
    const inversa = separacionCircular(llega.progresoM, sale.progresoM, largoM, true);
    expect(inversa.lado).toBe('delante');
    expect(inversa.distanciaM).toBeCloseTo(sep.distanciaM, 6);
  });

  it('fix a 3 km del trazado: distanciaAlTrazadoM grande para que el servidor lo descarte', () => {
    const lejos: [number, number] = [l16.terminal[0], l16.terminal[1] + 0.027];
    const p = prog(lejos, 'ida');
    expect(p.distanciaAlTrazadoM).toBeGreaterThan(2_500);
    expect(prog(compartido, 'ida').distanciaAlTrazadoM).toBeLessThan(100);
  });

  it('largoM es el mismo con y sin fase (mitades y proyección completa)', () => {
    expect(cir.largoM).toBeCloseTo(prog(compartido, null).largoM, 6);
    expect(prog(compartido, 'ida').largoM).toBe(cir.largoM);
    expect(prog(compartido, 'regreso').largoM).toBe(cir.largoM);
    expect(sinRetorno.largoM).toBeCloseTo(cir.largoM, 0);
  });

  // Punto de `mitad` con la otra mitad a más de `minM`: calle NO compartida.
  function puntoExclusivo(mitad: 'ida' | 'regreso', minM: number): [number, number] {
    const propia = cir.partido![mitad];
    const otra = cir.partido![mitad === 'ida' ? 'regreso' : 'ida'];
    const largo = mitad === 'ida' ? cir.largoIdaM : cir.largoM - cir.largoIdaM;
    for (let s = 500; s < largo - 500; s += 100) {
      const p = puntoA(propia, s);
      if (distanciaAPolilineaM(p, otra) > minM) return p;
    }
    throw new Error('sin tramo exclusivo');
  }

  it('fallback: fase "ida" atrasada (retorno sin registrar) con el punto en calle exclusiva del regreso usa el regreso', () => {
    const p = puntoExclusivo('regreso', 300);
    const r = prog(p, 'ida');
    expect(r.progresoM).toBeGreaterThan(largoIda);
    expect(r.distanciaAlTrazadoM).toBeLessThan(5);
    expect(r.progresoM).toBeCloseTo(prog(p, 'regreso').progresoM, 6);
  });

  it('fallback simétrico: fase "regreso" con el punto en calle exclusiva de la ida usa la ida', () => {
    const p = puntoExclusivo('ida', 300);
    const r = prog(p, 'regreso');
    expect(r.progresoM).toBeLessThan(largoIda);
    expect(r.distanciaAlTrazadoM).toBeLessThan(5);
  });

  it('"regreso" aún aproximándose al retorno (dentro del radio del PC) no se recorta al punto de corte', () => {
    // Rectángulo con el retorno a media subida: a 120 m antes del corte la mitad de regreso solo está en el corte.
    const rect: [number, number][] = [
      [0, 0],
      [0.02, 0],
      [0.02, 0.003],
      [0, 0.003],
      [0, 0],
    ];
    const cr = prepararCircuito(rect, [0.02, 0.0015]);
    const p: [number, number] = [0.02, 0.0015 - 120 / GRADO_M];
    expect(progresoEnCircuito(p, cr, 'regreso', Infinity).progresoM).toBeCloseTo(cr.largoIdaM, 0);
    const r = progresoEnCircuito(p, cr, 'regreso', 100);
    expect(r.progresoM).toBeCloseTo(cr.largoIdaM - 120, -1);
    expect(r.distanciaAlTrazadoM).toBeLessThan(5);
  });

  it('sin fallback si la otra mitad tampoco está a tolerancia: se queda con la de su fase', () => {
    const lejos: [number, number] = [l16.terminal[0], l16.terminal[1] + 0.027];
    expect(prog(lejos, 'regreso').progresoM).toBeGreaterThan(largoIda);
  });

  it('polilínea no cerrada: circular = false', () => {
    const abierta = progresoEnCircuito(
      [0.005, 0],
      prepararCircuito(circuito.slice(0, 3), null),
      null,
      TOL,
    );
    expect(abierta.circular).toBe(false);
    expect(abierta.largoM).toBeGreaterThan(2_000);
  });
});

describe('separacionCircular', () => {
  const L = 1000;

  it('circular: delante si está a ≤ L/2 por delante, si no detrás por el lado corto', () => {
    expect(separacionCircular(100, 300, L, true)).toEqual({ lado: 'delante', distanciaM: 200 });
    expect(separacionCircular(100, 900, L, true)).toEqual({ lado: 'detras', distanciaM: 200 });
    expect(separacionCircular(900, 100, L, true)).toEqual({ lado: 'delante', distanciaM: 200 });
  });

  it('simetría: A→B delante X ⇔ B→A detrás X, para cualquier par', () => {
    for (let a = 0; a < L; a += 37) {
      for (let b = 0; b < L; b += 53) {
        if (a === b) continue;
        const ab = separacionCircular(a, b, L, true);
        const ba = separacionCircular(b, a, L, true);
        // En el empate exacto (L/2) ambos ven al otro delante: no hay lado más corto.
        if (Math.abs(ab.distanciaM - L / 2) < 1e-9) continue;
        expect(ba.lado).toBe(ab.lado === 'delante' ? 'detras' : 'delante');
        expect(ba.distanciaM).toBeCloseTo(ab.distanciaM, 9);
      }
    }
  });

  it('mismo punto: detrás a 0 m (como en las rutas lineales)', () => {
    expect(separacionCircular(400, 400, L, true)).toEqual({ lado: 'detras', distanciaM: 0 });
    expect(separacionCircular(400, 400, L, false)).toEqual({ lado: 'detras', distanciaM: 0 });
  });

  it('lineal: sin vuelta por el cierre', () => {
    expect(separacionCircular(100, 900, L, false)).toEqual({ lado: 'delante', distanciaM: 800 });
    expect(separacionCircular(900, 100, L, false)).toEqual({ lado: 'detras', distanciaM: 800 });
  });
});
