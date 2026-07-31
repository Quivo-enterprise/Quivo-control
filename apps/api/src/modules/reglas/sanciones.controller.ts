import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarSancionSchema,
  CrearSancionSchema,
  type ActualizarSancion,
  type CrearSancion,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { SancionesService } from './sanciones.service.js';

class CrearSancionDto extends createZodDto(CrearSancionSchema) {}
class ActualizarSancionDto extends createZodDto(ActualizarSancionSchema) {}

const ROLES_SANCIONES = ['admin_quivo', 'admin_sindicato'] as const;

/** RF-40..50 (QUI-244) — sanciones con transiciones de estado dedicadas (RF-40..50: doc
 * técnico solo lista los 5 estados, no la máquina de transiciones — ver sanciones.service.ts). */
@Controller('sanciones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_SANCIONES)
export class SancionesController {
  constructor(private readonly sancionesService: SancionesService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.sancionesService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sancionesService.obtener(actor, id);
  }

  @Post()
  @Auditable('sancion')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearSancionDto) {
    return this.sancionesService.crear(actor, body as CrearSancion);
  }

  @Patch(':id')
  @Auditable('sancion')
  actualizar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: ActualizarSancionDto) {
    return this.sancionesService.actualizar(actor, id, body as ActualizarSancion);
  }

  @Post(':id/aplicar')
  @Auditable('sancion', 'aplicar')
  aplicar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sancionesService.aplicar(actor, id);
  }

  @Post(':id/anular')
  @Auditable('sancion', 'anular')
  anular(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sancionesService.anular(actor, id);
  }

  @Post(':id/apelar')
  @Auditable('sancion', 'apelar')
  apelar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sancionesService.apelar(actor, id);
  }

  @Post(':id/pagar')
  @Auditable('sancion', 'pagar')
  pagar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sancionesService.pagar(actor, id);
  }
}
