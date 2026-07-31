import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarAsignacionSchema,
  CrearAsignacionManualSchema,
  GenerarRotacionSchema,
  type ActualizarAsignacion,
  type CrearAsignacionManual,
  type GenerarRotacion,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { RotacionesService } from './rotaciones.service.js';

class GenerarRotacionDto extends createZodDto(GenerarRotacionSchema) {}
class CrearAsignacionManualDto extends createZodDto(CrearAsignacionManualSchema) {}
class ActualizarAsignacionDto extends createZodDto(ActualizarAsignacionSchema) {}

// A diferencia del resto de M1 (que incluye `operador`), rotaciones queda restringida a
// roles de planificación — asunción de este equipo, el doc técnico no lo especifica.
const ROLES_ROTACIONES = ['admin_quivo', 'admin_sindicato'] as const;

/** RF-51..57 (QUI-232) — generar borrador con reparto round-robin, editar asignaciones a
 * mano, publicar/anular de forma atómica. */
@Controller('rotaciones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_ROTACIONES)
export class RotacionesController {
  constructor(private readonly rotacionesService: RotacionesService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.rotacionesService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.rotacionesService.obtener(actor, id);
  }

  @Post()
  @Auditable('rotacion')
  generar(@CurrentUser() actor: AuthenticatedUser, @Body() body: GenerarRotacionDto) {
    return this.rotacionesService.generar(actor, body as GenerarRotacion);
  }

  @Post(':id/publicar')
  @Auditable('rotacion', 'publicar')
  publicar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.rotacionesService.publicar(actor, id);
  }

  @Post(':id/anular')
  @Auditable('rotacion', 'anular')
  anular(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.rotacionesService.anular(actor, id);
  }

  @Post(':id/asignaciones')
  @Auditable('asignacion')
  crearAsignacion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CrearAsignacionManualDto,
  ) {
    return this.rotacionesService.crearAsignacion(actor, id, body as CrearAsignacionManual);
  }

  @Patch(':id/asignaciones/:asignacionId')
  @Auditable('asignacion')
  actualizarAsignacion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('asignacionId') asignacionId: string,
    @Body() body: ActualizarAsignacionDto,
  ) {
    return this.rotacionesService.actualizarAsignacion(actor, id, asignacionId, body as ActualizarAsignacion);
  }

  @Delete(':id/asignaciones/:asignacionId')
  @Auditable('asignacion')
  eliminarAsignacion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('asignacionId') asignacionId: string,
  ) {
    return this.rotacionesService.eliminarAsignacion(actor, id, asignacionId);
  }
}
