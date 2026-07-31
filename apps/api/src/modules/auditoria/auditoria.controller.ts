import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditoriaQuerySchema, type AuditoriaQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { AuditoriaService } from './auditoria.service.js';

class AuditoriaQueryDto extends createZodDto(AuditoriaQuerySchema) {}

/** RF-81..84 — solo lectura, filtros básicos (entidad/acción/rango de fecha); la UI
 * completa con más filtros llega en QUI-248 (M4). */
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
