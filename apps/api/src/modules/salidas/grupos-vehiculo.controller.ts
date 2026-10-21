import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarGrupoVehiculoSchema,
  AgregarMiembroGrupoSchema,
  CrearGrupoVehiculoSchema,
  type ActualizarGrupoVehiculo,
  type AgregarMiembroGrupo,
  type CrearGrupoVehiculo,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { GruposService } from './grupos.service.js';

class CrearGrupoVehiculoDto extends createZodDto(CrearGrupoVehiculoSchema) {}
class ActualizarGrupoVehiculoDto extends createZodDto(ActualizarGrupoVehiculoSchema) {}
class AgregarMiembroGrupoDto extends createZodDto(AgregarMiembroGrupoSchema) {}

/** Grupos de trufis: SOLO admins (decisión del CTO, 20/10); `operador` recibe 403. */
@Controller('grupos-vehiculo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class GruposVehiculoController {
  constructor(@Inject(GruposService) private readonly gruposService: GruposService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.gruposService.listar(actor);
  }

  @Post()
  @Auditable('grupo_vehiculo')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearGrupoVehiculoDto) {
    return this.gruposService.crear(actor, body as CrearGrupoVehiculo);
  }

  @Patch(':id')
  @Auditable('grupo_vehiculo')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarGrupoVehiculoDto,
  ) {
    return this.gruposService.actualizar(actor, id, body as ActualizarGrupoVehiculo);
  }

  @Post(':id/miembros')
  @Auditable('grupo_vehiculo', 'agregar_miembro')
  agregarMiembro(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AgregarMiembroGrupoDto,
  ) {
    return this.gruposService.agregarMiembro(actor, id, (body as AgregarMiembroGrupo).vehiculoId);
  }

  @Delete(':id/miembros/:vehiculoId')
  @Auditable('grupo_vehiculo', 'quitar_miembro')
  quitarMiembro(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('vehiculoId') vehiculoId: string,
  ) {
    return this.gruposService.quitarMiembro(actor, id, vehiculoId);
  }
}
