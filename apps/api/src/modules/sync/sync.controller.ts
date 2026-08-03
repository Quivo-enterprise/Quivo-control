import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { SyncBatchSchema, type SyncBatchResponse } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { SyncQueueService } from './sync-queue.service.js';

class SyncBatchDto extends createZodDto(SyncBatchSchema) {}

/**
 * RF-69..72, RNF-33/34 (QUI-240). El body ya viaja descomprimido acá — el gunzip de
 * `X-Content-Encoding: gzip` (header custom, no el `Content-Encoding` estándar — ver
 * `main.ts`) pasa en un hook `preParsing` global, transparente para este controller.
 * `sindicatoId`/`deviceId` del job vienen de la sesión móvil
 * (`AuthMovilGuard`), nunca del body — un cliente no puede atribuir eventos a otro tenant o
 * dispositivo.
 */
@Controller('sync')
export class SyncController {
  constructor(@Inject(SyncQueueService) private readonly syncQueueService: SyncQueueService) {}

  @Post('batches')
  @HttpCode(202)
  @UseGuards(AuthMovilGuard)
  async recibirLote(
    @Body() body: SyncBatchDto,
    @CurrentMobileSession() sesion: SesionMovilAutenticada,
  ): Promise<SyncBatchResponse> {
    const deviceIdInvalido = body.eventos.some((evento) => evento.deviceId !== sesion.deviceId);
    if (deviceIdInvalido) {
      throw new BadRequestException(
        'Todos los eventos del lote deben ser del dispositivo de la sesión',
      );
    }

    await this.syncQueueService.encolarLote({
      sindicatoId: sesion.sindicatoId,
      deviceId: sesion.deviceId,
      eventos: body.eventos,
    });

    // "Aceptado" acá significa validado + encolado con éxito para el worker (QUI-241), no
    // insertado todavía — el insert idempotente por UUIDv7 garantiza consistencia eventual
    // aunque el cliente reenvíe el mismo lote antes de la próxima confirmación.
    return { aceptados: body.eventos.map((evento) => evento.eventId) };
  }
}
