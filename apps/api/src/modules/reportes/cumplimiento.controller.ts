import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { CumplimientoQuerySchema, type CumplimientoQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CumplimientoService } from './cumplimiento.service.js';

class CumplimientoQueryDto extends createZodDto(CumplimientoQuerySchema) {}

/** RF-74..77 (QUI-246) — solo lectura. Mismo patrón de roles que auditoría/sync-errores. */
@Controller('reportes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class CumplimientoController {
  constructor(@Inject(CumplimientoService) private readonly cumplimientoService: CumplimientoService) {}

  @Get('cumplimiento')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Query() query: CumplimientoQueryDto) {
    return this.cumplimientoService.obtener(actor, query as CumplimientoQuery);
  }
}
