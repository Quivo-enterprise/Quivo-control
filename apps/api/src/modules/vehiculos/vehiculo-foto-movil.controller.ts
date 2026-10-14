import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { SubirFotoVehiculoMovilSchema } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { FotoVehiculoThrottlerGuard } from './foto-vehiculo-throttler.guard.js';
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

  // 10 subidas/hora por sesión (no por IP: CGNAT — ver `FotoVehiculoThrottlerGuard`), que
  // corre después de `AuthMovilGuard` porque necesita `req.sesionMovil`.
  @Post('foto')
  @SkipThrottle()
  @Throttle({ foto: { ttl: 3_600_000, limit: 10 } })
  @UseGuards(FotoVehiculoThrottlerGuard)
  subir(
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
    @Body() body: SubirFotoVehiculoMovilDto,
  ) {
    return this.fotoService.subirDesdeMovil(sesion, body);
  }

  @Get('foto')
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.fotoService.obtenerDesdeMovil(sesion);
  }
}
