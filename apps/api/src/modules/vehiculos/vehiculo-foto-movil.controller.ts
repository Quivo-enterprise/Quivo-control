import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubirFotoVehiculoMovilSchema } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { DispositivoThrottlerGuard } from '../auth-movil/dispositivo-throttler.guard.js';
import { LimitePorDispositivo } from '../auth-movil/limite-por-dispositivo.decorator.js';
import { VehiculoFotoService } from './vehiculo-foto.service.js';

class SubirFotoVehiculoMovilDto extends createZodDto(SubirFotoVehiculoMovilSchema) {}

/**
 * Foto de la unidad desde la app del conductor. El vehículo lo determina la sesión móvil,
 * nunca el body. El tope de body de Fastify (3 MB, `main.ts`) ya cubre el base64 de 2 MB.
 */
@Controller('mobile/vehiculo')
export class VehiculoFotoMovilController {
  constructor(@Inject(VehiculoFotoService) private readonly fotoService: VehiculoFotoService) {}

  // Dos límites en cada ruta: el `ThrottlerGuard` global ('default', por IP) se mantiene a
  // propósito —tráfico sin sesión válida no puede quedar ilimitado— y `DispositivoThrottlerGuard`
  // corre después de `AuthMovilGuard`. POST: 10/hora por dispositivo y, por IP, el default global
  // (los POST de 3 MB). GET: `@LimitePorDispositivo` (tope por IP holgado por CGNAT + 30/min).
  @Post('foto')
  @Throttle({ device: { limit: 10, ttl: 3_600_000 } })
  @UseGuards(AuthMovilGuard, DispositivoThrottlerGuard)
  subir(
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
    @Body() body: SubirFotoVehiculoMovilDto,
  ) {
    return this.fotoService.subirDesdeMovil(sesion, body);
  }

  @Get('foto')
  @LimitePorDispositivo(30)
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.fotoService.obtenerDesdeMovil(sesion);
  }
}
