import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { AcuseVueltaSchema, type AcuseVuelta } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { LimitePorDispositivo } from '../auth-movil/limite-por-dispositivo.decorator.js';
import { FilaService } from '../salidas/fila.service.js';
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
  constructor(
    @Inject(VueltasService) private readonly vueltasService: VueltasService,
    @Inject(FilaService) private readonly filaService: FilaService,
  ) {}

  @Get()
  @LimitePorDispositivo(60)
  async obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    // La fila de salida se compone acá (no en `VueltasService`): campo opcional `fila`, `null` si no está en la fila.
    const [actual, fila] = await Promise.all([
      this.vueltasService.obtenerActualMovil(sesion),
      this.filaService.estadoMovil(sesion),
    ]);
    return { ...actual, fila };
  }

  @Post('acuse')
  @HttpCode(200)
  @LimitePorDispositivo(30)
  acusar(@CurrentMobileSession() sesion: SesionMovilAutenticada, @Body() body: AcuseVueltaDto) {
    return this.vueltasService.acusar(sesion, body as AcuseVuelta);
  }
}
