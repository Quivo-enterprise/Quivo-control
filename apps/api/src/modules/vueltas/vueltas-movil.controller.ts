import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { AcuseVueltaSchema, type AcuseVuelta } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { LimitePorDispositivo } from '../sync/limite-por-dispositivo.decorator.js';
import { VueltasService } from './vueltas.service.js';

class AcuseVueltaDto extends createZodDto(AcuseVueltaSchema) {}

/**
 * App del chofer (docs/plan-molinos-designacion.md): consulta de la vuelta actual y acuse de
 * la designación. La sesión sale SIEMPRE del token. La app consulta cada ~20 s en primer plano
 * (y desde los eventos de ubicación con ese mismo piso): 60 req/min POR DISPOSITIVO deja margen
 * para reintentos sin abrir la puerta a abuso. Límite por dispositivo con
 * `@LimitePorDispositivo` (CGNAT); cada handler lleva su propio contador.
 */
@Controller('mobile/vuelta-actual')
export class VueltasMovilController {
  constructor(@Inject(VueltasService) private readonly vueltasService: VueltasService) {}

  @Get()
  @LimitePorDispositivo(60)
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.vueltasService.obtenerActualMovil(sesion);
  }

  @Post('acuse')
  @HttpCode(200)
  @LimitePorDispositivo(30)
  acusar(@CurrentMobileSession() sesion: SesionMovilAutenticada, @Body() body: AcuseVueltaDto) {
    return this.vueltasService.acusar(sesion, body as AcuseVuelta);
  }
}
