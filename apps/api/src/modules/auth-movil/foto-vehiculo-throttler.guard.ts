import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerPorDispositivoGuard } from './throttler-por-dispositivo.guard.js';

/** Única fuente del límite de subidas de foto (el controlador no lo repite). */
export const FOTO_VEHICULO_THROTTLE = { name: 'foto', ttl: 3_600_000, limit: 10 } as const;

/**
 * `POST /mobile/vehiculo/foto`: 10/hora por dispositivo (throttler adicional 'foto'; el global
 * por IP sigue activo). Misma clave y `Retry-After` que `SyncDeviceThrottlerGuard`.
 */
@Injectable()
export class FotoVehiculoThrottlerGuard extends ThrottlerPorDispositivoGuard {
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super([{ ...FOTO_VEHICULO_THROTTLE }], storageService, reflector);
  }
}
