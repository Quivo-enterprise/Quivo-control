import { Controller, Get, Inject, Query } from '@nestjs/common';
import { VecinosRutaQuerySchema, type VecinosRutaQuery } from '@quivo/shared';
import type { ZodSchema } from 'zod';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { LimitePorDispositivo } from '../sync/limite-por-dispositivo.decorator.js';
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
  @LimitePorDispositivo(60)
  obtener(
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
    @Query() query: VecinosRutaQueryDto,
  ) {
    return this.vecinosRutaService.obtener(sesion, query);
  }
}
