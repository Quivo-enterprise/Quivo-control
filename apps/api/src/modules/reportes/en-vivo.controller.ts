import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { TrazaEnVivoQuerySchema, type TrazaEnVivoQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { EnVivoUsuarioThrottlerGuard } from './en-vivo-usuario-throttler.guard.js';
import { EnVivoService } from './en-vivo.service.js';

class TrazaEnVivoQueryDto extends createZodDto(TrazaEnVivoQuerySchema) {}

/**
 * ENTREGA 3 — mapa en vivo `/en-vivo`. Solo lectura, misma pila de guards/roles que
 * `recorridos.controller.ts`.
 *
 * Rate limit propio de 600 req/min POR USUARIO (no por IP): el límite global
 * (`app.module.ts`, QUI-251) es 100 req/min/IP compartido con TODO el panel, y cada pestaña
 * de esta pantalla hace ~60 req/min (poll de posiciones 2 s + traza 2 s; hasta ~120 con
 * `hayMas`). Por IP, varios operadores o pestañas detrás del mismo NAT se darían 429 entre
 * sí. `@SkipThrottle()` apaga el throttler global ('default', que corre ANTES de la auth y
 * por eso solo podría usar la IP) y `EnVivoUsuarioThrottlerGuard` —DESPUÉS de
 * `JwtAuthGuard`, cuando `req.user` ya existe— aplica el cupo por `userId`. Misma forma
 * que `SyncDeviceThrottlerGuard` en `POST /sync/batches`. El nombre del throttler
 * ('usuario') se declara en `@Throttle` con la forma `{ nombre: { ... } }` de
 * `@nestjs/throttler` v6.
 *
 * Ninguno de estos GET lleva `@Auditable`: son endpoints de poll y el interceptor de
 * auditoría solo actúa sobre handlers decorados — si escribieran, serían ~500 filas
 * basura por hora en `audit_log`.
 */
@Controller('reportes/en-vivo')
@UseGuards(JwtAuthGuard, RolesGuard, EnVivoUsuarioThrottlerGuard)
@Roles('admin_quivo', 'admin_sindicato')
@SkipThrottle()
@Throttle({ usuario: { limit: 600, ttl: 60_000 } })
export class EnVivoController {
  constructor(@Inject(EnVivoService) private readonly enVivoService: EnVivoService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.enVivoService.listarHoy(actor);
  }

  /**
   * ENTREGA 10 — última posición conocida de TODOS los vehículos con sesión activa, en
   * una sola query (ver `EnVivoService.obtenerPosiciones`). Ruta declarada ANTES de
   * `:sesionId/contexto` en el código fuente por legibilidad, aunque no hay colisión
   * real: `posiciones` es un segmento literal de un solo nivel bajo `reportes/en-vivo`,
   * mientras que las rutas con `:sesionId` tienen dos segmentos — Nest las distingue por
   * forma, no por orden de declaración.
   */
  @Get('posiciones')
  posicionesTodas(@CurrentUser() actor: AuthenticatedUser) {
    return this.enVivoService.obtenerPosiciones(actor);
  }

  @Get(':sesionId/contexto')
  contexto(@CurrentUser() actor: AuthenticatedUser, @Param('sesionId') sesionId: string) {
    return this.enVivoService.obtenerContexto(actor, sesionId);
  }

  @Get(':sesionId/posiciones')
  posiciones(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('sesionId') sesionId: string,
    @Query() query: TrazaEnVivoQueryDto,
  ) {
    return this.enVivoService.obtenerTraza(actor, sesionId, query as TrazaEnVivoQuery);
  }
}
