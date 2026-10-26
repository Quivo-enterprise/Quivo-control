import { describe, expect, it } from 'vitest';
import { agregarDigito, borrarDigito, cantidadPuntos, puedeEnviar } from './teclado-pin';

describe('teclado PIN', () => {
  it('agrega solo dígitos y detiene la entrada en 12', () => {
    expect(agregarDigito('12345', '6')).toBe('123456');
    expect(agregarDigito('123456789012', '3')).toBe('123456789012');
    expect(agregarDigito('123', 'x')).toBe('123');
  });

  it('borra el último dígito sin romper el PIN vacío', () => {
    expect(borrarDigito('123')).toBe('12');
    expect(borrarDigito('')).toBe('');
  });

  it('solo permite enviar entre 6 y 12 dígitos', () => {
    expect(puedeEnviar('12345')).toBe(false);
    expect(puedeEnviar('123456')).toBe(true);
    expect(puedeEnviar('123456789012')).toBe(true);
    expect(puedeEnviar('1234567890123')).toBe(false);
    expect(puedeEnviar('12345x')).toBe(false);
  });

  it('mantiene seis puntos mínimos y crece hasta doce', () => {
    expect(cantidadPuntos('')).toBe(6);
    expect(cantidadPuntos('123456')).toBe(6);
    expect(cantidadPuntos('1234567')).toBe(7);
    expect(cantidadPuntos('123456789012')).toBe(12);
  });
});
