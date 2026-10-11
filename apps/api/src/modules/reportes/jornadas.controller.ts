import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JornadasQuerySchema, type JornadasQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { JornadasService } from './jornadas.service.js';

class JornadasQueryDto extends createZodDto(JornadasQuerySchema) {}

/**
 * Release 13 — panel de jornadas del delegado. Solo lectura; misma pila de guards/roles y
 * mismo `@Throttle` que `en-vivo.controller.ts` (es una pantalla que se refresca por poll).
 * Sin `@Auditable`, por el mismo motivo que los demás GET de poll de `reportes`.
 */
@Controller('reportes/jornadas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class JornadasController {
  constructor(@Inject(JornadasService) private readonly jornadasService: JornadasService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Query() query: JornadasQueryDto) {
    return this.jornadasService.listar(actor, (query as JornadasQuery).fecha);
  }
}
