import { describe, expect, it } from 'vitest';
import { COLOR_VEHICULO_NEUTRO, colorSecundarioAHex, colorVehiculoAHex } from './color-vehiculo';

describe('colorVehiculoAHex', () => {
  it('mapea los códigos del enum', () => {
    expect(colorVehiculoAHex('rojo')).toBe('#D62F3A');
    expect(colorVehiculoAHex('azul')).toBe('#2864DC');
  });
  it('ignora mayúsculas, espacios y tildes', () => {
    expect(colorVehiculoAHex('  ROJO ')).toBe('#D62F3A');
    expect(colorVehiculoAHex('Café')).toBe('#795548');
  });
  it('cae al neutro para desconocido, vacío, null, otro y multicolor', () => {
    expect(colorVehiculoAHex('turquesa')).toBe(COLOR_VEHICULO_NEUTRO);
    expect(colorVehiculoAHex('')).toBe(COLOR_VEHICULO_NEUTRO);
    expect(colorVehiculoAHex(null)).toBe(COLOR_VEHICULO_NEUTRO);
    expect(colorVehiculoAHex(undefined)).toBe(COLOR_VEHICULO_NEUTRO);
    expect(colorVehiculoAHex('otro')).toBe(COLOR_VEHICULO_NEUTRO);
    expect(colorVehiculoAHex('multicolor')).toBe(COLOR_VEHICULO_NEUTRO);
  });
});

describe('colorSecundarioAHex', () => {
  it('devuelve null sin secundario o desconocido', () => {
    expect(colorSecundarioAHex(null)).toBeNull();
    expect(colorSecundarioAHex('turquesa')).toBeNull();
  });
  it('mapea un secundario conocido', () => {
    expect(colorSecundarioAHex('Blanco')).toBe('#F7F7F8');
  });
});
