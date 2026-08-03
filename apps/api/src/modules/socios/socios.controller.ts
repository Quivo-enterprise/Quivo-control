import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarSocioSchema,
  CrearSocioSchema,
  type ActualizarSocio,
  type CrearSocio,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { SociosService } from './socios.service.js';

class CrearSocioDto extends createZodDto(CrearSocioSchema) {}
class ActualizarSocioDto extends createZodDto(ActualizarSocioSchema) {}

/** RF-05..09 — CRUD de socios por sindicato (QUI-221). `admin_quivo` opera sobre cualquier
 * tenant (manda `sindicatoId` en el body); `admin_sindicato`/`operador` quedan forzados al
 * propio (ver SociosService.resolverSindicatoId) — RLS (QUI-218) es la barrera final. */
@Controller('socios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
export class SociosController {
  constructor(@Inject(SociosService) private readonly sociosService: SociosService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.sociosService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sociosService.obtener(actor, id);
  }

  @Post()
  @Auditable('socio')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearSocioDto) {
    return this.sociosService.crear(actor, body as CrearSocio);
  }

  @Patch(':id')
  @Auditable('socio')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarSocioDto,
  ) {
    return this.sociosService.actualizar(actor, id, body as ActualizarSocio);
  }
}
