import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { SyncDeviceThrottlerGuard } from '../sync/sync-device-throttler.guard.js';
import { PaqueteDiaService } from './paquete-dia.service.js';

@Controller('mobile')
export class PaqueteDiaController {
  constructor(@Inject(PaqueteDiaService) private readonly paqueteDiaService: PaqueteDiaService) {}

  @Get('asignacion-del-dia')
  // Límite por dispositivo, no por IP (CGNAT; ver `sync-device-throttler.guard.ts`): `@SkipThrottle()` apaga el
  // global y `SyncDeviceThrottlerGuard` va DESPUÉS de `AuthMovilGuard`. Consulta ocasional: 10/min.
  @SkipThrottle()
  @Throttle({ device: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard)
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.paqueteDiaService.obtenerPaqueteDelDia(sesion);
  }
}
