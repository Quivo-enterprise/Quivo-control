import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, ThrottlerGuard, type ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

type RequestConSesionMovil = FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

/** Única fuente del límite de subidas de foto (el controlador no lo repite). */
export const FOTO_VEHICULO_THROTTLE = { name: 'foto', ttl: 3_600_000, limit: 10 } as const;

/**
 * Rate limit de `POST /mobile/vehiculo/foto` por dispositivo móvil (10/hora) en vez de por IP:
 * detrás de CGNAT muchos conductores comparten IP (mismo motivo que `SyncDeviceThrottlerGuard`).
 * La clave es `deviceId` (estable) y no `sesionId`: reiniciar sesión no resetea el cupo.
 * Debe correr después de `AuthMovilGuard`, que es quien setea `req.sesionMovil`. Es un throttler
 * adicional ('foto'): el global 'default' por IP sigue activo en la ruta.
 */
@Injectable()
export class FotoVehiculoThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super([{ ...FOTO_VEHICULO_THROTTLE }], storageService, reflector);
  }

  protected async getTracker(req: RequestConSesionMovil): Promise<string> {
    return req.sesionMovil?.deviceId ?? req.ip;
  }
}
