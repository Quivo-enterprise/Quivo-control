import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarRutaSchema,
  CrearRutaSchema,
  type ActualizarRuta,
  type CrearRuta,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { RutasService } from './rutas.service.js';

class CrearRutaDto extends createZodDto(CrearRutaSchema) {}
class ActualizarRutaDto extends createZodDto(ActualizarRutaSchema) {}

const ROLES_RUTAS = ['admin_quivo', 'admin_sindicato', 'operador'] as const;

/** RF-24..33 — `POST/GET /v1/lineas/:lineaId/rutas` (QUI-225). */
@Controller('lineas/:lineaId/rutas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_RUTAS)
export class LineaRutasController {
  constructor(@Inject(RutasService) private readonly rutasService: RutasService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Param('lineaId') lineaId: string) {
    return this.rutasService.listarPorLinea(actor, lineaId);
  }

  @Post()
  @Auditable('ruta')
  crear(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('lineaId') lineaId: string,
    @Body() body: CrearRutaDto,
  ) {
    return this.rutasService.crear(actor, lineaId, body as CrearRuta);
  }
}

/** `GET/PATCH /v1/rutas/:id` — no anidado bajo línea porque el id de ruta ya identifica
 * unívocamente el recurso (mismo criterio que /v1/rutas/:id/variantes más abajo). */
@Controller('rutas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_RUTAS)
export class RutasController {
  constructor(@Inject(RutasService) private readonly rutasService: RutasService) {}

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.rutasService.obtener(actor, id);
  }

  @Patch(':id')
  @Auditable('ruta')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarRutaDto,
  ) {
    return this.rutasService.actualizar(actor, id, body as ActualizarRuta);
  }
}
