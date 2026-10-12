import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { EnVivoUsuarioThrottlerGuard } from './en-vivo-usuario-throttler.guard.js';

function createContext(
  req: unknown,
  handler: () => void = function posicionesHandler() {},
): ExecutionContext {
  const res = { header: () => undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => class EnVivoControllerStub {},
  } as unknown as ExecutionContext;
}

function getTracker(guard: EnVivoUsuarioThrottlerGuard, req: unknown): Promise<string> {
  return (guard as unknown as { getTracker(req: unknown): Promise<string> }).getTracker(req);
}

const user = (userId: string) => ({ userId, rol: 'admin_sindicato', sindicatoId: 's-1' });

describe('EnVivoUsuarioThrottlerGuard — tracker', () => {
  const guard = new EnVivoUsuarioThrottlerGuard({} as ThrottlerStorage, new Reflector());

  it('usa el userId autenticado cuando req.user está seteado', async () => {
    await expect(getTracker(guard, { ip: '190.1.1.1', user: user('u-1') })).resolves.toBe('u-1');
  });

  it('cae a req.ip cuando no hay usuario', async () => {
    await expect(getTracker(guard, { ip: '190.1.1.1' })).resolves.toBe('190.1.1.1');
  });
});

describe('EnVivoUsuarioThrottlerGuard — canActivate real', () => {
  const storageService = new ThrottlerStorageService();
  const reflector = new Reflector();

  afterEach(() => {
    storageService.onApplicationShutdown();
    storageService.storage.clear();
  });

  it('permite 600 req/min por usuario y bloquea la 601 con 429', async () => {
    const guard = new EnVivoUsuarioThrottlerGuard(storageService, reflector);
    await guard.onModuleInit();
    const req = { ip: '190.1.1.1', user: user('u-1') };
    for (let i = 0; i < 600; i += 1) {
      await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    }
    await expect(guard.canActivate(createContext(req))).rejects.toMatchObject({ status: 429 });
  });

  it('no mezcla el cupo de dos usuarios detrás de la misma IP (NAT)', async () => {
    const guard = new EnVivoUsuarioThrottlerGuard(storageService, reflector);
    await guard.onModuleInit();
    const reqA = { ip: '190.1.1.1', user: user('u-A') };
    const reqB = { ip: '190.1.1.1', user: user('u-B') };
    for (let i = 0; i < 600; i += 1) {
      await guard.canActivate(createContext(reqA));
    }
    await expect(guard.canActivate(createContext(reqB))).resolves.toBe(true);
  });

  it('comparte el mismo cupo de 600 entre handlers distintos del controller', async () => {
    const guard = new EnVivoUsuarioThrottlerGuard(storageService, reflector);
    await guard.onModuleInit();
    const req = { ip: '190.1.1.1', user: user('u-1') };
    const traza = function trazaHandler() {};
    const contexto = function contextoHandler() {};
    for (let i = 0; i < 300; i += 1) {
      await guard.canActivate(createContext(req, traza));
      await guard.canActivate(createContext(req, contexto));
    }
    await expect(guard.canActivate(createContext(req))).rejects.toMatchObject({ status: 429 });
    await expect(guard.canActivate(createContext(req, traza))).rejects.toMatchObject({
      status: 429,
    });
  });
});
