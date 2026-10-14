import { describe, expect, it } from 'vitest';
import { formatearTelefonoBolivia, normalizarTelefonoBolivia, TelefonoBoliviaSchema } from './telefono-bolivia.js';

describe('telefono boliviano', () => {
  it.each([
    ['71234567', '+59171234567'],
    ['61234567', '+59161234567'],
    ['7123 4567', '+59171234567'],
    ['+591 71234567', '+59171234567'],
    ['591-71234567', '+59171234567'],
    ['(591) 7123-4567', '+59171234567'],
    ['+59171234567', '+59171234567'],
    ['  71234567  ', '+59171234567'],
  ])('normaliza %s', (input, esperado) => {
    expect(normalizarTelefonoBolivia(input)).toBe(esperado);
  });

  it.each([
    ['fijo 4xxxxxxx', '44123456'],
    ['7 dígitos', '7123456'],
    ['9 dígitos', '712345678'],
    ['prefijo con fijo', '+59144123456'],
    ['letras', '7123abcd'],
    ['vacío', ''],
  ])('rechaza %s', (_nombre, input) => {
    expect(normalizarTelefonoBolivia(input)).toBeNull();
  });

  it('formatea para mostrar', () => {
    expect(formatearTelefonoBolivia('+59171234567')).toBe('+591 7123 4567');
    expect(formatearTelefonoBolivia('abc')).toBe('abc');
  });

  it('el schema normaliza, limpia con vacío/null y conserva undefined', () => {
    expect(TelefonoBoliviaSchema.parse('7123 4567')).toBe('+59171234567');
    expect(TelefonoBoliviaSchema.parse('')).toBeNull();
    expect(TelefonoBoliviaSchema.parse('   ')).toBeNull();
    expect(TelefonoBoliviaSchema.parse(null)).toBeNull();
    expect(TelefonoBoliviaSchema.parse(undefined)).toBeUndefined();
  });

  it('el schema rechaza con mensaje en español', () => {
    const r = TelefonoBoliviaSchema.safeParse('44123456');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Número boliviano de 8 dígitos que empiece con 6 o 7');
  });
});
