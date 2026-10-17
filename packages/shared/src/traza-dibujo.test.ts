import { describe, expect, it } from 'vitest';
import { distanciaMetros } from './geo.js';
import { prepararRutaSnap } from './snap-ruta.js';
import {
  HUECO_MAX_S,
  puntosValidosParaDibujo,
  trazaParaDibujo,
  type SegmentoTraza,
} from './traza-dibujo.js';
import type { PuntoTrazaGps } from './entities/recorrido.js';

const M_LAT = 1 / 111_195;
const M_LNG = 1 / (111_195 * Math.cos((-34.6 * Math.PI) / 180));
const en = (norteM: number, esteM: number) => ({
  lat: -34.6 + norteM * M_LAT,
  lng: -58.4 + esteM * M_LNG,
});
const T0 = Date.parse('2026-01-01T12:00:00Z');
const pt = (
  seg: number,
  p: { lat: number; lng: number },
  extra: Partial<PuntoTrazaGps> = {},
): PuntoTrazaGps => ({
  ts: new Date(T0 + seg * 1000).toISOString(),
  ...p,
  accuracy: 5,
  speed: null,
  ...extra,
});

const ele = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100)])!;
const cerca = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  distanciaMetros(a, b) < 1;
const tiene = (s: SegmentoTraza, p: { lat: number; lng: number }) => s.coords.some((c) => cerca(c, p));

describe('puntosValidosParaDibujo', () => {
  it('ordena por ts sin mutar la entrada', () => {
    const entrada = [pt(20, en(20, 0)), pt(0, en(0, 0)), pt(10, en(10, 0))];
    const copia = [...entrada];
    const v = puntosValidosParaDibujo(entrada);
    expect(v.map((p) => p.ts)).toEqual([entrada[1]!.ts, entrada[2]!.ts, entrada[0]!.ts]);
    expect(entrada).toEqual(copia);
  });

  it('descarta accuracy > 50 m y conserva accuracy nula', () => {
    const v = puntosValidosParaDibujo([
      pt(0, en(0, 0)),
      pt(10, en(10, 0), { accuracy: 100 }),
      pt(20, en(20, 0), { accuracy: null }),
    ]);
    expect(v).toHaveLength(2);
  });

  it('descarta un salto de 3 km en 10 s y no vuelve a comparar contra él', () => {
    const v = puntosValidosParaDibujo([pt(0, en(0, 0)), pt(10, en(3000, 0)), pt(20, en(20, 0))]);
    expect(v).toHaveLength(2);
    expect(v[1]!.ts).toBe(pt(20, en(20, 0)).ts);
  });

  it('un primer punto outlier (3 km, sin accuracy) no se queda de ancla: se descarta y se conservan los buenos', () => {
    const buenos = Array.from({ length: 10 }, (_, i) => pt(10 + i * 5, en(i * 10, 0)));
    const v = puntosValidosParaDibujo([pt(0, en(3000, 0), { accuracy: null }), ...buenos]);
    expect(v).toEqual(buenos);
  });
});

describe('trazaParaDibujo', () => {
  it('esquina de 90° con pasos chicos y rumbo viejo: sigue siendo ruta (reintento sin rumbo)', () => {
    // Un primer paso de 20 m fija el rumbo (norte); los pasos de 8 m con accuracy 15 m ya no lo
    // actualizan, así que al doblar al este el rumbo queda viejo.
    const tramo = [
      ...Array.from({ length: 10 }, (_, i) => en(20 + i * 8, 2)),
      ...Array.from({ length: 8 }, (_, i) => en(98, 10 + i * 8)),
    ];
    const puntos = [pt(0, en(0, 2), { accuracy: 15, speed: 3.5 })].concat(
      tramo.map((p, i) => pt(5 + i * 2, p, { accuracy: 15, speed: 3.5 })),
    );
    const r = trazaParaDibujo(puntos, [ele]);
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe('ruta');
  });

  it('vacío o un solo punto → []', () => {
    expect(trazaParaDibujo([], [ele])).toEqual([]);
    expect(trazaParaDibujo([pt(0, en(50, 0))], [ele])).toEqual([]);
  });

  it('esquina: dos puntos snapeados siguen los vértices de la ruta, no la cuerda', () => {
    const r = trazaParaDibujo([pt(0, en(90, 2)), pt(10, en(98, 12))], [ele]);
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe('ruta');
    expect(tiene(r[0]!, en(100, 0))).toBe(true);
  });

  it('desvío real (150 m fuera de la ruta) → libre con coords crudas', () => {
    const lejos = en(50, 150);
    const r = trazaParaDibujo([pt(0, en(50, 150)), pt(20, en(60, 150))], [ele]);
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe('libre');
    expect(tiene(r[0]!, lejos)).toBe(true);
  });

  it('tramo entre un punto ajustado y uno crudo es libre (no se dibuja la cuerda como ruta)', () => {
    const r = trazaParaDibujo(
      [pt(0, en(10, 0)), pt(10, en(20, 0)), pt(20, en(20, 150)), pt(30, en(30, 0))],
      [ele],
    );
    expect(r.map((s) => s.tipo)).toEqual(['ruta', 'libre']);
    expect(r[0]!.coords).toHaveLength(2);
    expect(tiene(r[1]!, en(20, 150))).toBe(true);
  });

  it('hueco de 400 s → dos segmentos, sin línea cruzando el hueco', () => {
    const r = trazaParaDibujo(
      [
        pt(0, en(10, 0)),
        pt(10, en(20, 0)),
        pt(10 + 400, en(60, 0)),
        pt(420, en(70, 0)),
      ],
      [ele],
    );
    expect(HUECO_MAX_S).toBe(120);
    expect(r).toHaveLength(2);
  });

  it('circuito cerrado: pasar por el cierre da la vuelta con wrap', () => {
    const circ = prepararRutaSnap([en(0, 0), en(100, 0), en(100, 100), en(0, 100), en(0, 0)])!;
    const r = trazaParaDibujo([pt(0, en(0, 10)), pt(10, en(10, 0))], [circ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe('ruta');
    expect(tiene(r[0]!, en(0, 0))).toBe(true);
    expect(r[0]!.coords.length).toBeGreaterThan(2);
  });

  it('ida y regreso por la misma calle: la histéresis no salta al otro pase', () => {
    // Ida hacia el este (y=0) y regreso hacia el oeste 6 m al norte.
    const ida = prepararRutaSnap([en(0, 0), en(0, 200), en(6, 200), en(6, 0), en(6, -100)])!;
    const puntos = [pt(0, en(0, 50)), pt(10, en(0, 100)), pt(20, en(0, 150))];
    // Regreso: el rumbo derivado (oeste) debe elegir el carril de y=6.
    puntos.push(pt(60, en(6, 150)), pt(70, en(6, 100)), pt(80, en(6, 50)));
    const [seg] = trazaParaDibujo(puntos, [ida]);
    expect(seg!.tipo).toBe('ruta');
    const ultimo = seg!.coords[seg!.coords.length - 1]!;
    expect(cerca(ultimo, en(6, 50))).toBe(true);
  });
});
