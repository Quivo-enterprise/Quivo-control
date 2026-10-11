import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { VecinosRutaQuerySchema, type VecinosRutaQuery } from '@quivo/shared';
import type { ZodSchema } from 'zod';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { SyncDeviceThrottlerGuard } from '../sync/sync-device-throttler.guard.js';
import { VecinosRutaService } from './vecinos-ruta.service.js';

// El schema recibe strings (query string) y devuelve números: su tipo de entrada difiere del de
// salida, que `createZodDto` no admite; el cast solo ajusta el tipo, la validación es la real.
class VecinosRutaQueryDto extends createZodDto(
  VecinosRutaQuerySchema as unknown as ZodSchema<VecinosRutaQuery>,
) {}

/**
 * Release 13 / B — "delante / detrás" sobre la misma ruta. La app consulta cada ~30 s con el
 * tracking activo; 60 req/min por dispositivo deja margen de reintentos y reaperturas sin abrir la puerta a
 * un abuso (el costo real lo absorbe el caché por ruta del servicio).
 */
@Controller('mobile')
export class VecinosRutaController {
  constructor(
    @Inject(VecinosRutaService) private readonly vecinosRutaService: VecinosRutaService,
  ) {}

  @Get('vecinos-ruta')
  // Rate limit por dispositivo, no por IP (mismo patrón que `POST /sync/batches`, ver
  // `sync-device-throttler.guard.ts`): con ~1 req/30 s por teléfono, varios choferes tras el
  // mismo CGNAT agotarían el cupo global por IP (60/min). `@SkipThrottle()` apaga el guard
  // global ('default') y `SyncDeviceThrottlerGuard` (throttler 'device', clave = deviceId)
  // DEBE ir después de `AuthMovilGuard` para que `sesionMovil` ya exista. El contador es por
  // handler, así que no comparte cupo con el endpoint de sync.
  @SkipThrottle()
  @Throttle({ device: { limit: 60, ttl: 60_000 } })
  @UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard)
  obtener(
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
    @Query() query: VecinosRutaQueryDto,
  ) {
    return this.vecinosRutaService.obtener(sesion, query);
  }
}
