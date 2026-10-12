import { describe, expect, it } from 'vitest';
import {
  encolarNuevosPuntos,
  estadoInicialAnimacion,
} from '../../../../../packages/design-system/src/ui/vehicle-marker-animation';
import { conPuntoVivo } from './punto-vivo';

const p = (n: number) => ({
  lat: n,
  lng: -n,
  ts: `2026-10-12T10:00:${String(n).padStart(2, '0')}.000Z`,
});
const vivo = (n: number) => ({ lat: n, lng: -n, ultimoFixTs: p(n).ts });

describe('conPuntoVivo', () => {
  it('agrega el fix de posiciones cuando es más nuevo que la traza', () => {
    const r = conPuntoVivo([p(1), p(2)], vivo(5));
    expect(r.map((x) => x.ts)).toEqual([p(1).ts, p(2).ts, p(5).ts]);
  });
  it('no agrega si el ts es igual o más viejo (dedupe)', () => {
    const t = [p(1), p(2)];
    expect(conPuntoVivo(t, vivo(2))).toBe(t);
    expect(conPuntoVivo(t, vivo(1))).toBe(t);
  });
  it('ignora posición sin fix o ausente', () => {
    const t = [p(1)];
    expect(conPuntoVivo(t, { lat: null, lng: null, ultimoFixTs: null })).toBe(t);
    expect(conPuntoVivo(t, undefined)).toBe(t);
  });
  it('traza vacía + fix vivo => un solo punto', () => {
    expect(conPuntoVivo([], vivo(3))).toEqual([p(3)]);
  });
  it('integración: la traza tardía con el mismo fix y fixes intermedios no re-anima ni salta atrás', () => {
    let e = encolarNuevosPuntos(estadoInicialAnimacion(), conPuntoVivo([p(1)], null), 2000);
    e = encolarNuevosPuntos(e, conPuntoVivo([p(1)], vivo(5)), 2000);
    expect(e.lastConsumedTs).toBe(p(5).ts);
    const antes = e.queue.length;
    // llega la traza con intermedios (2,3,4) y el mismo 5
    const e2 = encolarNuevosPuntos(e, conPuntoVivo([p(1), p(2), p(3), p(4), p(5)], vivo(5)), 2000);
    expect(e2).toBe(e);
    expect(e2.queue.length).toBe(antes);
    // un punto realmente nuevo sí se encola
    const e3 = encolarNuevosPuntos(
      e2,
      conPuntoVivo([p(1), p(2), p(3), p(4), p(5), p(6)], vivo(6)),
      2000,
    );
    expect(e3.lastConsumedTs).toBe(p(6).ts);
  });
});
