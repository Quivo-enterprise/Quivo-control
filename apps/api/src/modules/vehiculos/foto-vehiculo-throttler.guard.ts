import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, ThrottlerGuard, type ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

type RequestConSesionMovil = FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

/**
 * Rate limit de `POST /mobile/vehiculo/foto` por sesión móvil (10/hora) en vez de por IP:
 * detrás de CGNAT muchos conductores comparten IP (mismo motivo que `SyncDeviceThrottlerGuard`).
 * Debe correr después de `AuthMovilGuard`, que es quien setea `req.sesionMovil`.
 */
@Injectable()
export class FotoVehiculoThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super([{ name: 'foto', ttl: 3_600_000, limit: 10 }], storageService, reflector);
  }

  protected async getTracker(req: RequestConSesionMovil): Promise<string> {
    return req.sesionMovil?.sesionId ?? req.ip;
  }
}
