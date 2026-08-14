import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { RecorridosQuerySchema, type RecorridosQuery } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { RecorridosService } from './recorridos.service.js';

class RecorridosQueryDto extends createZodDto(RecorridosQuerySchema) {}

/** RNF-24 (QUI-247) — solo lectura, mismo patrón de roles que el resto de reportes. */
@Controller('reportes/recorridos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class RecorridosController {
  constructor(@Inject(RecorridosService) private readonly recorridosService: RecorridosService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Query() query: RecorridosQueryDto) {
    return this.recorridosService.listar(actor, query as RecorridosQuery);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recorridosService.obtener(actor, id);
  }
}
