import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarParadaSchema,
  CrearParadaSchema,
  type ActualizarParada,
  type CrearParada,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ParadasService } from './paradas.service.js';

class CrearParadaDto extends createZodDto(CrearParadaSchema) {}
class ActualizarParadaDto extends createZodDto(ActualizarParadaSchema) {}

const ROLES_PARADAS = ['admin_quivo', 'admin_sindicato', 'operador'] as const;

/** RF-24..33 — `POST/GET /v1/rutas/:rutaId/paradas` (QUI-225). */
@Controller('rutas/:rutaId/paradas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_PARADAS)
export class RutaParadasController {
  constructor(private readonly paradasService: ParadasService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Param('rutaId') rutaId: string) {
    return this.paradasService.listarPorRuta(actor, rutaId);
  }

  @Post()
  crear(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('rutaId') rutaId: string,
    @Body() body: CrearParadaDto,
  ) {
    return this.paradasService.crear(actor, rutaId, body as CrearParada);
  }
}

/** `GET/PATCH /v1/paradas/:id` — doc técnico §8 lista `/v1/paradas` como recurso plano. */
@Controller('paradas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_PARADAS)
export class ParadasController {
  constructor(private readonly paradasService: ParadasService) {}

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.paradasService.obtener(actor, id);
  }

  @Patch(':id')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarParadaDto,
  ) {
    return this.paradasService.actualizar(actor, id, body as ActualizarParada);
  }
}
