import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { SyncErroresQuerySchema, type SyncErroresQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { SyncErroresService } from './sync-errores.service.js';

class SyncErroresQueryDto extends createZodDto(SyncErroresQuerySchema) {}

/** RNF-35 (QUI-242) — solo lectura, filtros por dispositivo/sesión/rango de fecha. Mismo
 * patrón que `AuditoriaController` (QUI-230/248). */
@Controller('sync-errores')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class SyncErroresController {
  constructor(@Inject(SyncErroresService) private readonly syncErroresService: SyncErroresService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Query() query: SyncErroresQueryDto) {
    return this.syncErroresService.listar(actor, query as SyncErroresQuery);
  }
}
