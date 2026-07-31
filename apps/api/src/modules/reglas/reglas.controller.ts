import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarReglaSchema,
  CrearReglaSchema,
  type ActualizarRegla,
  type CrearRegla,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ReglasService } from './reglas.service.js';

class CrearReglaDto extends createZodDto(CrearReglaSchema) {}
class ActualizarReglaDto extends createZodDto(ActualizarReglaSchema) {}

// Reglas es una función de política, no operativa día a día — asunción de este equipo,
// mismo criterio que rotaciones (sin `operador`).
const ROLES_REGLAS = ['admin_quivo', 'admin_sindicato'] as const;

/** RF-40..50 (QUI-244) — CRUD de reglas/estatutos por sindicato. */
@Controller('reglas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_REGLAS)
export class ReglasController {
  constructor(private readonly reglasService: ReglasService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.reglasService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.reglasService.obtener(actor, id);
  }

  @Post()
  @Auditable('regla')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearReglaDto) {
    return this.reglasService.crear(actor, body as CrearRegla);
  }

  @Patch(':id')
  @Auditable('regla')
  actualizar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: ActualizarReglaDto) {
    return this.reglasService.actualizar(actor, id, body as ActualizarRegla);
  }
}
