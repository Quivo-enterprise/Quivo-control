import { describe, expect, it } from 'vitest';
import {
  MOLINOS_INTERVALO_MIN_MS,
  calcularSugerenciaMolinos,
  intervaloObjetivoMolinosMs,
} from './molinos.js';

describe('intervalo objetivo de envíos a Molinos', () => {
  it('125 móviles → 10 h / 125 = 4,8 min', () => {
    expect(intervaloObjetivoMolinosMs(125)).toBe(288_000);
  });

  it('con pocos móviles el intervalo crece; con muchísimos se clava en el piso de 1 min', () => {
    expect(intervaloObjetivoMolinosMs(10)).toBe(3_600_000);
    expect(intervaloObjetivoMolinosMs(1)).toBe(36_000_000);
    expect(intervaloObjetivoMolinosMs(5_000)).toBe(MOLINOS_INTERVALO_MIN_MS);
  });

  it('flota 0, negativa o no finita se trata como 1', () => {
    expect(intervaloObjetivoMolinosMs(0)).toBe(36_000_000);
    expect(intervaloObjetivoMolinosMs(-3)).toBe(36_000_000);
    expect(intervaloObjetivoMolinosMs(Number.NaN)).toBe(36_000_000);
  });
});

describe('calcularSugerenciaMolinos', () => {
  const ahora = new Date('2026-10-13T15:00:00.000Z');

  it('sin envíos hoy el próximo sugerido es ahora', () => {
    const r = calcularSugerenciaMolinos({ flotaActiva: 125, ultimoEnvioTs: null, ahora });
    expect(r.proximoSugeridoEn.getTime()).toBe(ahora.getTime());
    expect(r.intervaloObjetivoMs).toBe(288_000);
  });

  it('con un envío previo suma el intervalo al último envío', () => {
    const ultimo = new Date('2026-10-13T14:58:00.000Z');
    const r = calcularSugerenciaMolinos({ flotaActiva: 125, ultimoEnvioTs: ultimo, ahora });
    expect(r.proximoSugeridoEn.toISOString()).toBe('2026-10-13T15:02:48.000Z');
  });
});
