import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditoriaQuerySchema, type AuditoriaQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { AuditoriaService } from './auditoria.service.js';

class AuditoriaQueryDto extends createZodDto(AuditoriaQuerySchema) {}

/** RF-81..84 (QUI-230/248) — solo lectura, filtros por entidad/acción/usuario/rango de
 * fecha. UI real en `apps/web` (QUI-248). */
@Controller('auditoria')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Query() query: AuditoriaQueryDto) {
    return this.auditoriaService.listar(actor, query as AuditoriaQuery);
  }
}
