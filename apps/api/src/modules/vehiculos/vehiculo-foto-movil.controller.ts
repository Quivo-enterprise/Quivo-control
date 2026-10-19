import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubirFotoVehiculoMovilSchema } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { LIMITE_IP_MOVIL } from '../sync/limite-por-dispositivo.decorator.js';
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

  // Dos límites: el `ThrottlerGuard` global ('default', 100/min por IP) se mantiene a
  // propósito —los POST de 3 MB sin sesión válida no pueden quedar ilimitados— y
  // `FotoVehiculoThrottlerGuard` suma 10/hora por dispositivo (ttl/limit definidos allí, única
  // fuente). Este corre después de `AuthMovilGuard` porque necesita `req.sesionMovil`. A
  // diferencia de /sync, no hay `@SkipThrottle()`: el volumen es bajo y el tope por IP no
  // reintroduce el problema de CGNAT. El GET usa el tope
  // por IP holgado de las demás rutas móviles (`LIMITE_IP_MOVIL`) para no sufrir el CGNAT.
  @Post('foto')
  @UseGuards(FotoVehiculoThrottlerGuard)
  subir(
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
    @Body() body: SubirFotoVehiculoMovilDto,
  ) {
    return this.fotoService.subirDesdeMovil(sesion, body);
  }

  @Get('foto')
  @Throttle({ default: LIMITE_IP_MOVIL })
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.fotoService.obtenerDesdeMovil(sesion);
  }
}
