import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';

// Contexto mínimo para ejercitar `canActivate` real (no solo `getTracker`): necesita
// `switchToHttp().getRequest()/getResponse()` (guard base) y `getHandler()/getClass()`
// (Reflector, para leer metadata de `@Throttle`/`@SkipThrottle` — acá ninguna, así que cae
// a la config del constructor del guard).
function createContext(req: unknown): ExecutionContext {
  const res = { header: () => undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => function recibirLoteHandler() {},
    getClass: () => class SyncControllerStub {},
  } as unknown as ExecutionContext;
}

const sesion: SesionMovilAutenticada = {
  sesionId: 's-1',
  sindicatoId: 'sind-1',
  asignacionId: 'asig-1',
  vehiculoId: 'veh-1',
  conductorId: 'cond-1',
  deviceId: 'device-1',
};

// `getTracker` es `protected` — el guard base de @nestjs/throttler lo invoca desde
// `canActivate`, pero acceder directo acá es lo más simple para probarlo en aislamiento sin
// levantar todo el pipeline de Nest (guards, storage, reflector metadata real).
function getTracker(guard: SyncDeviceThrottlerGuard, req: unknown): Promise<string> {
  return (
    guard as unknown as { getTracker(req: unknown): Promise<string> }
  ).getTracker(req);
}

describe('SyncDeviceThrottlerGuard', () => {
  const storageStub = {} as ThrottlerStorage;
  const reflectorStub = new Reflector();

  it('usa el deviceId de la sesión móvil cuando está seteada (QUI-CGNAT)', async () => {
    const guard = new SyncDeviceThrottlerGuard(storageStub, reflectorStub);
    const req = { ip: '190.10.20.30', sesionMovil: sesion } as FastifyRequest & {
      sesionMovil?: SesionMovilAutenticada;
    };

    await expect(getTracker(guard, req)).resolves.toBe('device-1');
  });

  it('cae a req.ip cuando no hay sesión móvil en el request', async () => {
    const guard = new SyncDeviceThrottlerGuard(storageStub, reflectorStub);
    const req = { ip: '190.10.20.30' } as FastifyRequest & {
      sesionMovil?: SesionMovilAutenticada;
    };

    await expect(getTracker(guard, req)).resolves.toBe('190.10.20.30');
  });
});

// Test obligatorio del fix de QUI-240 (code-review, hallazgo 1): el límite POR DISPOSITIVO
// tiene que seguir intacto después de mover el guard de fallos-por-IP a `AuthMovilGuard` —
// acá se ejercita `canActivate` real (no solo `getTracker`) contra un `ThrottlerStorageService`
// real para probar que efectivamente bloquea con 429 al superar 60/min por dispositivo.
describe('SyncDeviceThrottlerGuard — límite por dispositivo intacto (canActivate real)', () => {
  const storageService = new ThrottlerStorageService();
  const reflectorStub = new Reflector();

  afterEach(() => {
    // Limpia los `setTimeout` internos del storage en memoria entre tests — si no, quedan
    // handles abiertos y el storage arrastra estado (totalHits) de un test al siguiente.
    storageService.onApplicationShutdown();
    storageService.storage.clear();
  });

  it('deja pasar hasta 60 requests/min de un mismo dispositivo y bloquea la 61 con 429', async () => {
    const guard = new SyncDeviceThrottlerGuard(storageService, reflectorStub);
    await guard.onModuleInit();
    const req = { ip: '190.10.20.30', sesionMovil: sesion } as FastifyRequest & {
      sesionMovil?: SesionMovilAutenticada;
    };

    for (let i = 0; i < 60; i += 1) {
      await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    }

    await expect(guard.canActivate(createContext(req))).rejects.toMatchObject({
      status: 429,
    });
  });

  it('no mezcla el cupo de dos dispositivos distintos aunque compartan IP (CGNAT)', async () => {
    const guard = new SyncDeviceThrottlerGuard(storageService, reflectorStub);
    await guard.onModuleInit();
    const reqA = {
      ip: '190.10.20.30',
      sesionMovil: { ...sesion, deviceId: 'device-A' },
    } as FastifyRequest & { sesionMovil?: SesionMovilAutenticada };
    const reqB = {
      ip: '190.10.20.30',
      sesionMovil: { ...sesion, deviceId: 'device-B' },
    } as FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

    for (let i = 0; i < 60; i += 1) {
      await expect(guard.canActivate(createContext(reqA))).resolves.toBe(true);
    }
    // Device B arranca su propio cupo limpio pese a compartir IP con A, que ya lo agotó.
    await expect(guard.canActivate(createContext(reqB))).resolves.toBe(true);
  });
});
