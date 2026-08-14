import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarLineaSchema,
  CrearLineaSchema,
  type ActualizarLinea,
  type CrearLinea,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { LineasService } from './lineas.service.js';

class CrearLineaDto extends createZodDto(CrearLineaSchema) {}
class ActualizarLineaDto extends createZodDto(ActualizarLineaSchema) {}

/** RF-20..23 — CRUD de líneas por sindicato (QUI-224). */
@Controller('lineas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
export class LineasController {
  constructor(@Inject(LineasService) private readonly lineasService: LineasService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.lineasService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.lineasService.obtener(actor, id);
  }

  @Post()
  @Auditable('linea')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearLineaDto) {
    return this.lineasService.crear(actor, body as CrearLinea);
  }

  @Patch(':id')
  @Auditable('linea')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarLineaDto,
  ) {
    return this.lineasService.actualizar(actor, id, body as ActualizarLinea);
  }
}
