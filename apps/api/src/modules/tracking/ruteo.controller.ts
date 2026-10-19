import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { SyncDeviceThrottlerGuard } from '../sync/sync-device-throttler.guard.js';
import { RuteoService } from './ruteo.service.js';

@Controller('mobile')
export class RuteoController {
  constructor(@Inject(RuteoService) private readonly ruteoService: RuteoService) {}

  @Get('ruta-a-punto')
  // Límite por dispositivo, no por IP (CGNAT; ver `sync-device-throttler.guard.ts`): `@SkipThrottle()` apaga el
  // global y `SyncDeviceThrottlerGuard` va DESPUÉS de `AuthMovilGuard`. Cadencia real ≤ 4/min por teléfono: 20/min deja margen.
  @SkipThrottle()
  @Throttle({ device: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard)
  async obtener(
    @Query('origenLat') origenLat: string,
    @Query('origenLng') origenLng: string,
    @Query('destinoLat') destinoLat: string,
    @Query('destinoLng') destinoLng: string,
  ) {
    const oLat = Number(origenLat);
    const oLng = Number(origenLng);
    const dLat = Number(destinoLat);
    const dLng = Number(destinoLng);
    if ([oLat, oLng, dLat, dLng].some((valor) => Number.isNaN(valor))) {
      throw new BadRequestException('origenLat/origenLng/destinoLat/destinoLng deben ser números');
    }
    return this.ruteoService.rutaEntrePuntos({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng });
  }
}
