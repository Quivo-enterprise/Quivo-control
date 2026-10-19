import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginMovilThrottlerGuard, LoginWebThrottlerGuard } from './login-throttler.guard.js';

function contexto(req: unknown, header = vi.fn()): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header }) }),
    getHandler: () => function loginHandler() {},
    getClass: () => class LoginControllerStub {},
  } as unknown as ExecutionContext;
}

const IP = '190.10.20.30';
const movil = (placa: unknown, ip = IP) => contexto({ ip, body: { placa, pin: '123456' } });
const web = (email: unknown, ip = IP) => contexto({ ip, body: { email, password: 'x' } });

describe('LoginMovilThrottlerGuard (POST /mobile/auth/sesion)', () => {
  const storage = new ThrottlerStorageService();
  const crear = async () => {
    const guard = new LoginMovilThrottlerGuard(storage, new Reflector());
    await guard.onModuleInit();
    return guard;
  };

  afterEach(() => {
    storage.onApplicationShutdown();
    storage.storage.clear();
  });

  it('30 placas distintas desde 1 IP (turno detrás de un CGNAT): ninguna se frena', async () => {
    const guard = await crear();
    for (let i = 0; i < 30; i += 1) {
      await expect(guard.canActivate(movil(`${1000 + i}ABC`))).resolves.toBe(true);
    }
  });

  it('la misma placa 6 veces desde 1 IP: la 6.ª recibe 429 con Retry-After', async () => {
    const guard = await crear();
    for (let i = 0; i < 5; i += 1) {
      await expect(guard.canActivate(movil('1234ABC'))).resolves.toBe(true);
    }
    const header = vi.fn();
    await expect(
      guard.canActivate(contexto({ ip: IP, body: { placa: '1234ABC' } }, header)),
    ).rejects.toMatchObject({ status: 429 });
    expect(header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('61 requests (placas distintas) desde 1 IP: la 61 recibe 429 por el cubo de IP', async () => {
    const guard = await crear();
    for (let i = 0; i < 60; i += 1) {
      await expect(guard.canActivate(movil(`${1000 + i}ABC`))).resolves.toBe(true);
    }
    await expect(guard.canActivate(movil('9999ZZZ'))).rejects.toMatchObject({ status: 429 });
  });

  it('mayúsculas, espacios y guiones de la placa comparten cubo', async () => {
    const guard = await crear();
    const variantes = ['1234ABC', '1234abc', ' 1234 abc ', '1234-ABC', '1234 ABC'];
    for (const v of variantes) await expect(guard.canActivate(movil(v))).resolves.toBe(true);
    await expect(guard.canActivate(movil('1234  Abc'))).rejects.toMatchObject({ status: 429 });
  });

  it('placa inválida o ausente cae al cubo de la IP sin romper (body crudo)', async () => {
    const guard = await crear();
    await expect(guard.canActivate(movil(undefined))).resolves.toBe(true);
    await expect(guard.canActivate(movil(42))).resolves.toBe(true);
    await expect(guard.canActivate(contexto({ ip: IP }))).resolves.toBe(true);
    // Las 3 anteriores comparten el cubo `cuenta` de la IP (límite 5).
    await guard.canActivate(movil('???'));
    await guard.canActivate(movil(''));
    await expect(guard.canActivate(movil(null))).rejects.toMatchObject({ status: 429 });
  });

  it('IPs distintas no comparten cupo', async () => {
    const guard = await crear();
    for (let i = 0; i < 5; i += 1) await guard.canActivate(movil('1234ABC'));
    await expect(guard.canActivate(movil('1234ABC', '190.10.20.31'))).resolves.toBe(true);
  });
});

describe('LoginWebThrottlerGuard (POST /auth/login)', () => {
  const storage = new ThrottlerStorageService();
  const crear = async () => {
    const guard = new LoginWebThrottlerGuard(storage, new Reflector());
    await guard.onModuleInit();
    return guard;
  };

  afterEach(() => {
    storage.onApplicationShutdown();
    storage.storage.clear();
  });

  it('ip+email: 5 por minuto, el 6.º 429; el email se normaliza (trim + minúsculas)', async () => {
    const guard = await crear();
    for (const e of ['a@x.com', 'A@X.com', ' a@x.com ', 'a@X.COM', 'A@x.com']) {
      await expect(guard.canActivate(web(e))).resolves.toBe(true);
    }
    await expect(guard.canActivate(web('a@x.com'))).rejects.toMatchObject({ status: 429 });
    await expect(guard.canActivate(web('b@x.com'))).resolves.toBe(true);
  });

  it('ip sola: 20 por minuto con emails distintos, el 21 recibe 429', async () => {
    const guard = await crear();
    for (let i = 0; i < 20; i += 1) {
      await expect(guard.canActivate(web(`u${i}@x.com`))).resolves.toBe(true);
    }
    await expect(guard.canActivate(web('otro@x.com'))).rejects.toMatchObject({ status: 429 });
  });
});
