import { describe, expect, it } from 'vitest';
import {
  COLOR_PUNTO_CONTROL,
  COLOR_PUNTO_CONTROL_COMPLETADO,
  colorPuntoControl,
  esPuntoControlPasado,
  indiceProximoPuntoControl,
} from './estado-punto-control';

const ids = ['a', 'b', 'c'];

describe('indiceProximoPuntoControl', () => {
  it('devuelve el índice del próximo punto', () => {
    expect(indiceProximoPuntoControl(ids, 'b')).toBe(1);
  });

  it('sin próximo (null) o con un id desconocido devuelve -1', () => {
    expect(indiceProximoPuntoControl(ids, null)).toBe(-1);
    expect(indiceProximoPuntoControl(ids, 'zzz')).toBe(-1);
  });
});

describe('esPuntoControlPasado (isPassed)', () => {
  it('con el próximo en el segundo punto, el primero queda atrás y los demás no', () => {
    expect(esPuntoControlPasado(0, 1, true)).toBe(true);
    expect(esPuntoControlPasado(1, 1, true)).toBe(false);
    expect(esPuntoControlPasado(2, 1, true)).toBe(false);
  });

  it('con el próximo en el primer punto ninguno está pasado', () => {
    expect([0, 1, 2].map((i) => esPuntoControlPasado(i, 0, true))).toEqual([false, false, false]);
  });

  it('sin próximo conocido (-1) ninguno está pasado', () => {
    expect([0, 1, 2].map((i) => esPuntoControlPasado(i, -1, true))).toEqual([false, false, false]);
  });

  it('sin tracking nunca se marca ninguno, aunque el próximo sea el último', () => {
    expect([0, 1, 2].map((i) => esPuntoControlPasado(i, 2, false))).toEqual([false, false, false]);
  });

  it('al avanzar el próximo punto se van sumando pasados', () => {
    const pasados = (proximoIdx: number) =>
      ids.map((_, i) => esPuntoControlPasado(i, proximoIdx, true)).filter(Boolean).length;
    expect([0, 1, 2].map(pasados)).toEqual([0, 1, 2]);
  });
});

describe('colorPuntoControl', () => {
  it('azul pendiente, verde pasado', () => {
    expect(colorPuntoControl(false)).toBe(COLOR_PUNTO_CONTROL);
    expect(colorPuntoControl(true)).toBe(COLOR_PUNTO_CONTROL_COMPLETADO);
    expect(COLOR_PUNTO_CONTROL).toBe('#3127B1');
    expect(COLOR_PUNTO_CONTROL_COMPLETADO).toBe('#22C55E');
  });
});
