import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, getJwtExpiryMs } from './jwt.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('decodeJwtPayload', () => {
  it('decodifica el payload de un JWT bien formado', () => {
    const token = makeJwt({ sub: 'user-1', exp: 1234 });
    expect(decodeJwtPayload(token)).toEqual({ sub: 'user-1', exp: 1234 });
  });

  it('devuelve null para un token sin 3 partes', () => {
    expect(decodeJwtPayload('no-es-un-jwt')).toBeNull();
  });

  it('devuelve null para un payload que no es JSON válido', () => {
    expect(decodeJwtPayload('a.b.c')).toBeNull();
  });
});

describe('getJwtExpiryMs', () => {
  it('convierte `exp` (segundos) a milisegundos', () => {
    const token = makeJwt({ exp: 1000 });
    expect(getJwtExpiryMs(token)).toBe(1_000_000);
  });

  it('devuelve null si el token no trae `exp` (ej. token opaco de bypass)', () => {
    const token = makeJwt({ sub: 'user-1' });
    expect(getJwtExpiryMs(token)).toBeNull();
  });

  it('devuelve null para un token inválido', () => {
    expect(getJwtExpiryMs('dev-bypass-token')).toBeNull();
  });
});
