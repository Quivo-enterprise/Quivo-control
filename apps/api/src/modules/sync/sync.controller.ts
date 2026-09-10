import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { SyncBatchSchema, type SyncBatchResponse } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';
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

  // Rate limit por dispositivo, no por IP (ver el comentario largo en
  // `sync-device-throttler.guard.ts` para el porqué — CGNAT de operadores móviles y el
  // orden de guards). `@SkipThrottle()` apaga acá el `ThrottlerGuard` global (100/60 por
  // IP, `app.module.ts`); `SyncDeviceThrottlerGuard` DEBE ir después de `AuthMovilGuard` en
  // este array para que `sesionMovil` ya exista cuando lee el tracker.
  //
  // Tráfico SIN sesión válida (Bearer ausente/inválido) queda fuera de `SkipThrottle()` Y
  // fuera de `SyncDeviceThrottlerGuard` (nunca llega: `AuthMovilGuard` corta antes con 401).
  // Eso NO significa costo ilimitado para ese tráfico: `AuthMovilGuard` mismo cachea (por
  // TOKEN, no por IP — ver el docblock de `canActivate` en `auth-movil.guard.ts`, historia
  // completa de QUI-240 con dos diseños descartados) los tokens que ya confirmó inválidos,
  // así que un Bearer basura REPETIDO no vuelve a pagar el SHA-256 + query a Postgres. A
  // propósito NO es un bloqueo por IP: eso tumbaría a cualquier chofer con credencial válida
  // que comparta CGNAT con un teléfono en bucle de reintentos (caso real, documentado en
  // `docs/handoff.md`) — exactamente el reventón que `SyncDeviceThrottlerGuard` existe para
  // evitar del otro lado (por dispositivo autenticado). El caso no cubierto a propósito: un
  // atacante rotando un token distinto por request nunca repite hash, así que nunca cachea y
  // paga el costo real en cada intento — igual que sin este fix. Trade-off aceptado: ese
  // patrón (tokens únicos ilimitados) no es el que se observó en producción.
  @Post('batches')
  @HttpCode(202)
  @SkipThrottle()
  @Throttle({ device: { ttl: 60_000, limit: 60 } })
  @UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard)
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
