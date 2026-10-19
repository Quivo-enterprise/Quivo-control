import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants.js';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SesionMovilAutenticada } from './auth-movil.types.js';
import { AuthMovilController, PerfilMovilController } from './auth-movil.controller.js';
import { VueltasMovilController } from '../vueltas/vueltas-movil.controller.js';
import { PaqueteDiaController } from '../tracking/paquete-dia.controller.js';
import { RuteoController } from '../tracking/ruteo.controller.js';
import { VecinosRutaController } from '../tracking/vecinos-ruta.controller.js';
import { LIMITE_IP_MOVIL } from './limite-por-dispositivo.decorator.js';
import { SyncController } from '../sync/sync.controller.js';
import { VehiculoFotoMovilController } from '../vehiculos/vehiculo-foto-movil.controller.js';
import { DispositivoThrottlerGuard } from './dispositivo-throttler.guard.js';

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
function getTracker(guard: DispositivoThrottlerGuard, req: unknown): Promise<string> {
  return (
    guard as unknown as { getTracker(req: unknown): Promise<string> }
  ).getTracker(req);
}

describe('DispositivoThrottlerGuard', () => {
  const storageStub = {} as ThrottlerStorage;
  const reflectorStub = new Reflector();

  it('usa el deviceId de la sesión móvil cuando está seteada (QUI-CGNAT)', async () => {
    const guard = new DispositivoThrottlerGuard(storageStub, reflectorStub);
    const req = { ip: '190.10.20.30', sesionMovil: sesion } as FastifyRequest & {
      sesionMovil?: SesionMovilAutenticada;
    };

    await expect(getTracker(guard, req)).resolves.toBe('device-1');
  });

  it('cae a req.ip cuando no hay sesión móvil en el request', async () => {
    const guard = new DispositivoThrottlerGuard(storageStub, reflectorStub);
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
describe('DispositivoThrottlerGuard — límite por dispositivo intacto (canActivate real)', () => {
  const storageService = new ThrottlerStorageService();
  const reflectorStub = new Reflector();

  afterEach(() => {
    // Limpia los `setTimeout` internos del storage en memoria entre tests — si no, quedan
    // handles abiertos y el storage arrastra estado (totalHits) de un test al siguiente.
    storageService.onApplicationShutdown();
    storageService.storage.clear();
  });

  it('deja pasar hasta 60 requests/min de un mismo dispositivo y bloquea la 61 con 429', async () => {
    const guard = new DispositivoThrottlerGuard(storageService, reflectorStub);
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
    const guard = new DispositivoThrottlerGuard(storageService, reflectorStub);
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

// Todas las rutas móviles con `@LimitePorDispositivo` (+ foto GET): metadata real de los controllers.
// El tope por IP ('default') se lee de la metadata en vez de agotarlo 3000 veces; la mecánica del
// guard global se prueba una sola vez abajo con un tope chico.
describe('rutas móviles con límite por dispositivo', () => {
  const rutas = [
    { nombre: 'sync/batches', clase: SyncController, handler: 'recibirLote', limite: 60 },
    { nombre: 'vecinos-ruta', clase: VecinosRutaController, handler: 'obtener', limite: 60 },
    { nombre: 'vuelta-actual', clase: VueltasMovilController, handler: 'obtener', limite: 60 },
    { nombre: 'vuelta-actual/acuse', clase: VueltasMovilController, handler: 'acusar', limite: 30 },
    { nombre: 'ruta-a-punto', clase: RuteoController, handler: 'obtener', limite: 20 },
    { nombre: 'asignacion-del-dia', clase: PaqueteDiaController, handler: 'obtener', limite: 10 },
    { nombre: 'contexto-operativo', clase: AuthMovilController, handler: 'obtenerContexto', limite: 10 },
    { nombre: 'perfil', clase: PerfilMovilController, handler: 'obtenerPerfil', limite: 10 },
    { nombre: 'vehiculo/foto GET', clase: VehiculoFotoMovilController, handler: 'obtener', limite: 30 },
  ] as const;
  // Cada ruta debe llevar `AuthMovilGuard` (a nivel de método o de clase) ANTES del guard por
  // dispositivo: es el invariante de seguridad (el segundo necesita `req.sesionMovil`).
  function guardsEfectivos(clase: object, fn: () => unknown): string[] {
    const nombres = (meta: unknown) => ((meta ?? []) as { name: string }[]).map((g) => g.name);
    return [...nombres(Reflect.getMetadata(GUARDS_METADATA, clase)), ...nombres(Reflect.getMetadata(GUARDS_METADATA, fn))];
  }
  const reflector = new Reflector();

  for (const { nombre, clase, handler, limite } of rutas) {
    it(`${nombre}: ${limite}/min por dispositivo y ${LIMITE_IP_MOVIL.limit}/min por IP (no se salta)`, () => {
      const fn = (clase.prototype as unknown as Record<string, () => unknown>)[handler]!;
      const guards = guardsEfectivos(clase, fn);
      expect(guards.filter((g) => g === 'AuthMovilGuard')).toHaveLength(1);
      expect(guards.indexOf('AuthMovilGuard')).toBeLessThan(guards.indexOf('DispositivoThrottlerGuard'));
      expect(guards.at(-1)).toBe('DispositivoThrottlerGuard');

      expect(reflector.get(`${THROTTLER_LIMIT}default`, fn)).toBe(LIMITE_IP_MOVIL.limit);
      expect(reflector.get(`${THROTTLER_LIMIT}device`, fn)).toBe(limite);
    });
  }
});

describe('POST vehiculo/foto', () => {
  const reflector = new Reflector();
  const fn = VehiculoFotoMovilController.prototype.subir;

  it('exige sesión móvil antes del guard por dispositivo y limita 10/hora por dispositivo', () => {
    const guards = ((Reflect.getMetadata(GUARDS_METADATA, fn) ?? []) as { name: string }[]).map((g) => g.name);
    expect(guards).toEqual(['AuthMovilGuard', 'DispositivoThrottlerGuard']);
    expect(reflector.get(`${THROTTLER_LIMIT}device`, fn)).toBe(10);
    expect(reflector.get(`${THROTTLER_TTL}device`, fn)).toBe(3_600_000);
    // El tope por IP queda en el default global (no se sobreescribe).
    expect(reflector.get(`${THROTTLER_LIMIT}default`, fn)).toBeUndefined();
  });
});

describe('guard global por IP con tope configurado (mecánica)', () => {
  const storageService = new ThrottlerStorageService();

  afterEach(() => {
    storageService.onApplicationShutdown();
    storageService.storage.clear();
  });

  it('pasa hasta el tope, bloquea el siguiente y no mezcla IPs distintas', async () => {
    const global = new ThrottlerGuard([{ name: 'default', ttl: 60_000, limit: 5 }], storageService, new Reflector());
    await global.onModuleInit();
    const ctx = (ip: string) => createContext({ ip });

    for (let i = 0; i < 5; i += 1) {
      await expect(global.canActivate(ctx('190.10.20.30'))).resolves.toBe(true);
    }
    await expect(global.canActivate(ctx('190.10.20.30'))).rejects.toMatchObject({ status: 429 });
    await expect(global.canActivate(ctx('190.10.20.31'))).resolves.toBe(true);
  });
});

describe('Retry-After del guard por dispositivo', () => {
  const storageService = new ThrottlerStorageService();

  afterEach(() => {
    storageService.onApplicationShutdown();
    storageService.storage.clear();
  });

  it('el propio guard por dispositivo setea Retry-After al bloquear', async () => {
    const guard = new DispositivoThrottlerGuard(storageService, new Reflector());
    await guard.onModuleInit();
    const header = vi.fn();
    const req = { ip: '190.10.20.30', sesionMovil: sesion };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header }) }),
      getHandler: () => function handlerStub() {},
      getClass: () => class ControllerStub {},
    } as unknown as ExecutionContext;

    for (let i = 0; i < 60; i += 1) await guard.canActivate(ctx);
    expect(header).not.toHaveBeenCalledWith('Retry-After', expect.anything());
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
    expect(header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });
});
