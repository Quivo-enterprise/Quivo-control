import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarPuntoControlSchema,
  CrearPuntoControlSchema,
  type ActualizarPuntoControl,
  type CrearPuntoControl,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ControlPointsService } from './control-points.service.js';

class CrearPuntoControlDto extends createZodDto(CrearPuntoControlSchema) {}
class ActualizarPuntoControlDto extends createZodDto(ActualizarPuntoControlSchema) {}

const ROLES_PUNTOS_CONTROL = ['admin_quivo', 'admin_sindicato', 'operador'] as const;

/** RF-34..39 — `POST/GET /v1/rutas/:rutaId/puntos-control` (QUI-226). */
@Controller('rutas/:rutaId/puntos-control')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_PUNTOS_CONTROL)
export class RutaControlPointsController {
  constructor(@Inject(ControlPointsService) private readonly controlPointsService: ControlPointsService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Param('rutaId') rutaId: string) {
    return this.controlPointsService.listarPorRuta(actor, rutaId);
  }

  @Post()
  @Auditable('punto_control')
  crear(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('rutaId') rutaId: string,
    @Body() body: CrearPuntoControlDto,
  ) {
    return this.controlPointsService.crear(actor, rutaId, body as CrearPuntoControl);
  }
}

/** `GET/PATCH /v1/puntos-control/:id` — doc técnico §8 lista `/v1/puntos-control` como
 * recurso plano. */
@Controller('puntos-control')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_PUNTOS_CONTROL)
export class ControlPointsController {
  constructor(@Inject(ControlPointsService) private readonly controlPointsService: ControlPointsService) {}

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.controlPointsService.obtener(actor, id);
  }

  @Patch(':id')
  @Auditable('punto_control')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarPuntoControlDto,
  ) {
    return this.controlPointsService.actualizar(actor, id, body as ActualizarPuntoControl);
  }
}
