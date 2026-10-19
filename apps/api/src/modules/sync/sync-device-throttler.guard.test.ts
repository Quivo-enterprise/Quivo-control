import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { AuthMovilController, PerfilMovilController } from '../auth-movil/auth-movil.controller.js';
import { VueltasMovilController } from '../vueltas/vueltas-movil.controller.js';
import { PaqueteDiaController } from '../tracking/paquete-dia.controller.js';
import { RuteoController } from '../tracking/ruteo.controller.js';
import { VecinosRutaController } from '../tracking/vecinos-ruta.controller.js';
import { LIMITE_IP_MOVIL } from './limite-por-dispositivo.decorator.js';
import { SyncController } from './sync.controller.js';
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

// Todas las rutas móviles con `@LimitePorDispositivo`: metadata real de los controllers + guards
// reales contra un storage real. El global se instancia con la config de `app.module.ts`
// (`default`, 100/min): el decorador lo sube a `LIMITE_IP_MOVIL`, NO lo apaga.
describe('rutas móviles con @LimitePorDispositivo', () => {
  const rutas = [
    { nombre: 'sync/batches', clase: SyncController, handler: 'recibirLote', limite: 60 },
    { nombre: 'vecinos-ruta', clase: VecinosRutaController, handler: 'obtener', limite: 60 },
    { nombre: 'vuelta-actual', clase: VueltasMovilController, handler: 'obtener', limite: 60 },
    { nombre: 'vuelta-actual/acuse', clase: VueltasMovilController, handler: 'acusar', limite: 30 },
    { nombre: 'ruta-a-punto', clase: RuteoController, handler: 'obtener', limite: 20 },
    { nombre: 'asignacion-del-dia', clase: PaqueteDiaController, handler: 'obtener', limite: 10 },
    { nombre: 'contexto-operativo', clase: AuthMovilController, handler: 'obtenerContexto', limite: 10 },
    { nombre: 'perfil', clase: PerfilMovilController, handler: 'obtenerPerfil', limite: 10 },
  ] as const;
  const storageService = new ThrottlerStorageService();
  const reflector = new Reflector();

  afterEach(() => {
    storageService.onApplicationShutdown();
    storageService.storage.clear();
  });

  for (const { nombre, clase, handler, limite } of rutas) {
    it(`${nombre}: ${limite}/min por dispositivo y ${LIMITE_IP_MOVIL.limit}/min por IP (no se salta)`, async () => {
      const fn = (clase.prototype as unknown as Record<string, () => unknown>)[handler]!;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, fn) as { name: string }[]).map((g) => g.name);
      expect(guards).toEqual(['AuthMovilGuard', 'SyncDeviceThrottlerGuard']);

      const res = { header: vi.fn() };
      const ctx = (req: unknown) =>
        ({
          switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
          getHandler: () => fn,
          getClass: () => clase,
        }) as unknown as ExecutionContext;
      const reqDe = (deviceId: string) => ({ ip: '190.10.20.30', sesionMovil: { ...sesion, deviceId } });

      // Por IP: pasa muy por encima del 100 global (CGNAT) y bloquea justo tras el tope holgado.
      const global = new ThrottlerGuard([{ name: 'default', ttl: 60_000, limit: 100 }], storageService, reflector);
      await global.onModuleInit();
      for (let i = 0; i < LIMITE_IP_MOVIL.limit; i += 1) {
        await expect(global.canActivate(ctx(reqDe('device-A')))).resolves.toBe(true);
      }
      await expect(global.canActivate(ctx(reqDe('device-A')))).rejects.toMatchObject({ status: 429 });

      // Por dispositivo: cupo propio, sin mezclarse con otro dispositivo de la misma IP.
      const device = new SyncDeviceThrottlerGuard(storageService, reflector);
      await device.onModuleInit();
      for (let i = 0; i < limite; i += 1) {
        await expect(device.canActivate(ctx(reqDe('device-A')))).resolves.toBe(true);
      }
      await expect(device.canActivate(ctx(reqDe('device-A')))).rejects.toMatchObject({ status: 429 });
      expect(res.header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
      await expect(device.canActivate(ctx(reqDe('device-B')))).resolves.toBe(true);
    });
  }
});
