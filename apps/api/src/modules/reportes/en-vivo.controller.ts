import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TrazaEnVivoQuerySchema, type TrazaEnVivoQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { EnVivoService } from './en-vivo.service.js';

class TrazaEnVivoQueryDto extends createZodDto(TrazaEnVivoQuerySchema) {}

/**
 * ENTREGA 3 — mapa en vivo `/en-vivo`. Solo lectura, misma pila de guards/roles que
 * `recorridos.controller.ts`.
 *
 * `@Throttle` propio de 300 req/min: el límite global (`app.module.ts`, QUI-251) es
 * 100 req/min/IP compartido con TODO el panel, y esta pantalla sola hace ~8 req/min por
 * pestaña — con varias pestañas o varios operadores detrás del mismo NAT, el global se
 * agota y tumba el resto del panel. La forma `{ default: { ... } }` es la de
 * `@nestjs/throttler` v6, que nombra los throttlers (el throttler global se llama
 * `'default'`, ver `ThrottlerModule.forRoot`).
 *
 * Ninguno de estos GET lleva `@Auditable`: son endpoints de poll y el interceptor de
 * auditoría solo actúa sobre handlers decorados — si escribieran, serían ~500 filas
 * basura por hora en `audit_log`.
 */
@Controller('reportes/en-vivo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class EnVivoController {
  constructor(@Inject(EnVivoService) private readonly enVivoService: EnVivoService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.enVivoService.listarHoy(actor);
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
