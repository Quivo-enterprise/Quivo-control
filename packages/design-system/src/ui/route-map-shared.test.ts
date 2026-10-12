import { describe, expect, it } from 'vitest';
import { colorTextoContraste, etiquetaFrescura, nodeNumberFromId, offsetRutaParalela } from './route-map-shared.js';

describe('colorTextoContraste', () => {
  it('blanco sobre fondos oscuros y texto oscuro sobre claros', () => {
    expect(colorTextoContraste('#3226b4')).toBe('#ffffff');
    expect(colorTextoContraste('#16a34a')).toBe('#111827');
    expect(colorTextoContraste('#fd9e15')).toBe('#111827');
    expect(colorTextoContraste('#ffffff')).toBe('#111827');
    expect(colorTextoContraste('#000')).toBe('#ffffff');
  });
  it('formato no medible => blanco', () => {
    expect(colorTextoContraste('rgb(10 20 30)')).toBe('#ffffff');
  });
});

describe('etiquetaFrescura', () => {
  it('mapea estados conocidos y devuelve vacío para el resto', () => {
    expect(etiquetaFrescura('perdido')).toBe('Sin señal');
    expect(etiquetaFrescura('reportando')).toBe('Reportando');
    expect(etiquetaFrescura('inventado')).toBe('');
    expect(etiquetaFrescura(undefined)).toBe('');
  });
});

describe('nodeNumberFromId', () => {
  it('nodo-N => N+1; otros ids vacío', () => {
    expect(nodeNumberFromId('nodo-0')).toBe('1');
    expect(nodeNumberFromId('nodo-9')).toBe('10');
    expect(nodeNumberFromId('x')).toBe('');
  });
});

describe('offsetRutaParalela', () => {
  it('una sola ruta no se desplaza', () => {
    expect(offsetRutaParalela(0, 1)).toBe(0);
    expect(offsetRutaParalela(0, 0)).toBe(0);
  });
  it('varias rutas se reparten de a 4 px, centradas en el eje', () => {
    expect(offsetRutaParalela(0, 2)).toBe(-2);
    expect(offsetRutaParalela(1, 2)).toBe(2);
    expect([0, 1, 2].map((i) => offsetRutaParalela(i, 3))).toEqual([-4, 0, 4]);
  });
});
