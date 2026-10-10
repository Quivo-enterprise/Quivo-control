import { describe, expect, it } from 'vitest';
import { calcularCadenciaMediaMs, formatearCadencia, registrarMuestraCadencia } from './spike-metricas';

describe('registrarMuestraCadencia', () => {
  it('agrega la primera muestra a un array vacío', () => {
    expect(registrarMuestraCadencia([], 1000)).toEqual([1000]);
  });

  it('agrega una muestra creciente al final', () => {
    expect(registrarMuestraCadencia([1000, 2000], 3000)).toEqual([1000, 2000, 3000]);
  });

  it('ignora una muestra igual a la última', () => {
    expect(registrarMuestraCadencia([1000, 2000], 2000)).toEqual([1000, 2000]);
  });

  it('ignora una muestra menor a la última (fuera de orden)', () => {
    expect(registrarMuestraCadencia([1000, 2000], 1500)).toEqual([1000, 2000]);
  });

  it('no muta el array recibido', () => {
    const original = [1000, 2000];
    registrarMuestraCadencia(original, 3000);
    expect(original).toEqual([1000, 2000]);
  });

  it('acota la ventana a las últimas 20 muestras', () => {
    const muestras = Array.from({ length: 20 }, (_, i) => i * 1000);
    const actualizado = registrarMuestraCadencia(muestras, 20000);
    expect(actualizado).toHaveLength(20);
    expect(actualizado[0]).toBe(1000);
    expect(actualizado[actualizado.length - 1]).toBe(20000);
  });
});

describe('calcularCadenciaMediaMs', () => {
  it('null con cero muestras', () => {
    expect(calcularCadenciaMediaMs([])).toBeNull();
  });

  it('null con una sola muestra (ningún intervalo)', () => {
    expect(calcularCadenciaMediaMs([1000])).toBeNull();
  });

  it('con dos muestras, el delta entre ellas', () => {
    expect(calcularCadenciaMediaMs([1000, 3500])).toBe(2500);
  });

  it('promedia varios intervalos', () => {
    // deltas: 1000, 2000, 3000 -> media 2000
    expect(calcularCadenciaMediaMs([0, 1000, 3000, 6000])).toBe(2000);
  });
});

describe('formatearCadencia', () => {
  it('guion sin datos', () => {
    expect(formatearCadencia(null)).toBe('—');
  });

  it('formatea segundos con un decimal', () => {
    expect(formatearCadencia(2500)).toBe('2.5s');
    expect(formatearCadencia(1000)).toBe('1.0s');
    expect(formatearCadencia(100)).toBe('0.1s');
  });
});
