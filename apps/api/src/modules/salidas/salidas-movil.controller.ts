import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { LlegadaFilaSchema, SalidaFilaMovilSchema, type LlegadaFila, type SalidaFilaMovil } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import { LimitePorDispositivo } from '../auth-movil/limite-por-dispositivo.decorator.js';
import { FilaService } from './fila.service.js';

class LlegadaFilaDto extends createZodDto(LlegadaFilaSchema) {}
class SalidaFilaMovilDto extends createZodDto(SalidaFilaMovilSchema) {}

/**
 * App del chofer: entrada y salida de la fila de la terminal (plan "fila de salida"). Sindicato,
 * vehículo y sesión salen SIEMPRE del token. El estado de la fila viaja en `GET /mobile/vuelta-actual`
 * (campo `fila`), no hay GET acá. Pocas llamadas por día por trufi: 20/min/dispositivo deja margen
 * para reintentos.
 */
@Controller('mobile/fila')
export class SalidasMovilController {
  constructor(@Inject(FilaService) private readonly filaService: FilaService) {}

  @Post('llegada')
  @HttpCode(200)
  @LimitePorDispositivo(20)
  llegada(@CurrentMobileSession() sesion: SesionMovilAutenticada, @Body() body: LlegadaFilaDto) {
    return this.filaService.registrarLlegada(sesion, body as LlegadaFila);
  }

  @Post('salida')
  @HttpCode(200)
  @LimitePorDispositivo(20)
  salida(@CurrentMobileSession() sesion: SesionMovilAutenticada, @Body() body: SalidaFilaMovilDto) {
    return this.filaService.registrarSalida(sesion, body as SalidaFilaMovil);
  }
}
