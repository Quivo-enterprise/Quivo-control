import { Body, Controller, Get, Post } from '@nestjs/common';
import { CrearSindicatoSchema } from '@quivo/shared';
import { createZodDto } from '../validation/zod-dto.js';

class CrearSindicatoDto extends createZodDto(CrearSindicatoSchema) {}

@Controller('_internal')
export class PingController {
  /** Liveness simple (sin tocar DB/Redis) — GET /v1/_internal/ping. */
  @Get('ping')
  ping() {
    return { pong: true };
  }

  /**
   * Endpoint interno de diagnóstico: prueba end-to-end que el pipe global de validación
   * Zod (APP_PIPE) usa un schema real de `@quivo/shared`. No es un endpoint de producto —
   * se retira cuando el módulo `sindicatos` real (QUI-220) exponga su propio CRUD.
   */
  @Post('validate-demo')
  validateDemo(@Body() body: CrearSindicatoDto) {
    return { recibido: body };
  }
}
