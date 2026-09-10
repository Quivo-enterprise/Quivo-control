import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';

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
