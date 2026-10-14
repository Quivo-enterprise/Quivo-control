import { describe, expect, it } from 'vitest';
import { enmascararTelefono, redactarPii } from './redactar-pii.js';

describe('enmascararTelefono', () => {
  it('deja visibles solo los 2 últimos dígitos', () => {
    expect(enmascararTelefono('+59171234567')).toBe('+591******67');
    expect(enmascararTelefono('71234567')).toBe('******67');
    expect(enmascararTelefono('7123 4567')).toBe('**** **67');
  });
  it('conserva null y vacío', () => {
    expect(enmascararTelefono(null)).toBeNull();
    expect(enmascararTelefono('')).toBe('');
  });
  it('un valor no string se redacta por completo', () => {
    expect(enmascararTelefono(71234567)).toBe('[redactado]');
  });
});

describe('redactarPii', () => {
  it('enmascara telefono sin mutar el body ni tocar otras claves', () => {
    const body = { nombre: 'Juan', telefono: '+59171234567', estado: 'activo' };
    const out = redactarPii(body);
    expect(out).toEqual({ nombre: 'Juan', telefono: '+591******67', estado: 'activo' });
    expect(body.telefono).toBe('+59171234567');
  });
  it('un body sin telefono queda igual', () => {
    expect(redactarPii({ nombre: 'Socio X' })).toEqual({ nombre: 'Socio X' });
  });
  it('telefono null o vacío se conserva', () => {
    expect(redactarPii({ telefono: null })).toEqual({ telefono: null });
    expect(redactarPii({ telefono: '' })).toEqual({ telefono: '' });
  });
  it('diffs que no son objetos pasan intactos', () => {
    expect(redactarPii(null)).toBeNull();
    expect(redactarPii([1, 2])).toEqual([1, 2]);
  });
});
