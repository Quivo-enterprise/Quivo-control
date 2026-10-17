import { describe, expect, it } from 'vitest';
import { COLOR_TRAZA, COLOR_TRAZA_LIBRE, puntosAnimadosSobreRuta, rutasDeTraza, rutasSnapDe } from './segmentos-traza';

const M_LAT = 1 / 111_195;
const M_LNG = 1 / (111_195 * Math.cos((-34.6 * Math.PI) / 180));
const en = (norteM: number, esteM: number) => ({ lat: -34.6 + norteM * M_LAT, lng: -58.4 + esteM * M_LNG });
const T0 = Date.parse('2026-01-01T12:00:00Z');
const pt = (seg: number, p: { lat: number; lng: number }) => ({
  ts: new Date(T0 + seg * 1000).toISOString(),
  ...p,
  accuracy: 5,
  speed: null,
});
const geo = [en(0, 0), en(100, 0), en(100, 100)].map((p) => [p.lng, p.lat]);

describe('rutasSnapDe', () => {
  it('suma el tramo de cada variante y tolera `variantes` ausente', () => {
    expect(rutasSnapDe(geo, [])).toHaveLength(1);
    expect(rutasSnapDe(geo, undefined)).toHaveLength(1);
    const tramo = [[-58.39, -34.59], [-58.389, -34.59]];
    const v = { id: 'v', nombre: 'Molinos', geometria: { type: 'LineString' as const, coordinates: tramo } };
    expect(rutasSnapDe(geo, [v as never])).toHaveLength(2);
  });
});

describe('rutasDeTraza', () => {
  it('tramo sobre la ruta → azul sólido; desvío → alerta y fino; sin offset lateral', () => {
    const rutas = rutasSnapDe(geo, []);
    const r = rutasDeTraza(
      [pt(0, en(10, 0)), pt(10, en(20, 0)), pt(20, en(20, 150)), pt(30, en(30, 150))],
      rutas,
      'Traza',
    );
    expect(r.map((x) => x.color)).toEqual([COLOR_TRAZA, COLOR_TRAZA_LIBRE]);
    expect(r.map((x) => x.fino)).toEqual([false, true]);
    expect(r.every((x) => x.sinOffset)).toBe(true);
    expect(r[0]!.label).toBe('Traza');
    expect(r[1]!.label).toBeUndefined();
  });
});

describe('puntosAnimadosSobreRuta', () => {
  const rutas = rutasSnapDe(geo, []);
  it('dos fixes ajustados cerca de la esquina → el segundo lleva un camino por la esquina', () => {
    const r = puntosAnimadosSobreRuta([pt(0, en(90, 2)), pt(10, en(98, 12))], rutas);
    expect(r[0]!.camino).toBeUndefined();
    const medio = r[1]!.camino!(0.5);
    // Entre (90,0) y (100,10) sobre la ruta, a media distancia pasa por (100,0) (la esquina) o cerca.
    expect(Math.abs(medio.lat - en(100, 0).lat) * 111_195).toBeLessThan(6);
    const fin = r[1]!.camino!(1);
    expect(fin.lat).toBeCloseTo(r[1]!.lat, 6);
    expect(fin.lng).toBeCloseTo(r[1]!.lng, 6);
  });
  it('un fix fuera de la ruta queda crudo y sin camino; sin rutas devuelve los puntos tal cual', () => {
    const lejos = en(50, 150);
    const r = puntosAnimadosSobreRuta([pt(0, en(50, 0)), pt(10, lejos)], rutas);
    expect(r[1]).toEqual({ ts: pt(10, lejos).ts, lat: lejos.lat, lng: lejos.lng });
    expect(puntosAnimadosSobreRuta([pt(0, lejos)], [])).toHaveLength(1);
  });
});
