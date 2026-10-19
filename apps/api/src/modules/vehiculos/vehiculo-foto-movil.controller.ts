import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubirFotoVehiculoMovilSchema } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { FotoVehiculoThrottlerGuard } from '../auth-movil/foto-vehiculo-throttler.guard.js';
import { LIMITE_IP_MOVIL } from '../auth-movil/limite-por-dispositivo.decorator.js';
import { SyncDeviceThrottlerGuard } from '../auth-movil/sync-device-throttler.guard.js';
import { VehiculoFotoService } from './vehiculo-foto.service.js';

class SubirFotoVehiculoMovilDto extends createZodDto(SubirFotoVehiculoMovilSchema) {}

/**
 * Foto de la unidad desde la app del conductor. El vehículo lo determina la sesión móvil,
 * nunca el body. El tope de body de Fastify (3 MB, `main.ts`) ya cubre el base64 de 2 MB.
 */
@Controller('mobile/vehiculo')
@UseGuards(AuthMovilGuard)
export class VehiculoFotoMovilController {
  constructor(@Inject(VehiculoFotoService) private readonly fotoService: VehiculoFotoService) {}

  // Dos límites en cada ruta: el `ThrottlerGuard` global ('default', por IP) se mantiene a
  // propósito —tráfico sin sesión válida no puede quedar ilimitado— y un guard por dispositivo
  // corre después de `AuthMovilGuard` (necesita `req.sesionMovil`; ya está a nivel de clase).
  // POST: 10/hora (`FotoVehiculoThrottlerGuard`, única fuente del ttl/limit) y tope por IP
  // global de 100/min (los POST de 3 MB). GET: tope por IP holgado (`LIMITE_IP_MOVIL`, CGNAT)
  // + 30/min por dispositivo.
  @Post('foto')
  @UseGuards(FotoVehiculoThrottlerGuard)
  subir(
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
    @Body() body: SubirFotoVehiculoMovilDto,
  ) {
    return this.fotoService.subirDesdeMovil(sesion, body);
  }

  @Get('foto')
  @Throttle({ default: LIMITE_IP_MOVIL, device: { limit: 30, ttl: 60_000 } })
  @UseGuards(SyncDeviceThrottlerGuard)
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.fotoService.obtenerDesdeMovil(sesion);
  }
}
