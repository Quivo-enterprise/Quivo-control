import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarVarianteSchema,
  CrearVarianteSchema,
  type ActualizarVariante,
  type CrearVariante,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { VariantesService } from './variantes.service.js';

class CrearVarianteDto extends createZodDto(CrearVarianteSchema) {}
class ActualizarVarianteDto extends createZodDto(ActualizarVarianteSchema) {}

const ROLES_VARIANTES = ['admin_quivo', 'admin_sindicato', 'operador'] as const;

/** RF-24..33 — `POST/GET /v1/rutas/:rutaId/variantes` (QUI-225). */
@Controller('rutas/:rutaId/variantes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_VARIANTES)
export class RutaVariantesController {
  constructor(@Inject(VariantesService) private readonly variantesService: VariantesService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser, @Param('rutaId') rutaId: string) {
    return this.variantesService.listarPorRuta(actor, rutaId);
  }

  @Post()
  @Auditable('variante')
  crear(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('rutaId') rutaId: string,
    @Body() body: CrearVarianteDto,
  ) {
    return this.variantesService.crear(actor, rutaId, body as CrearVariante);
  }
}

/** `GET/PATCH /v1/variantes/:id` — igual que paradas/puntos-control, doc técnico §8 lista
 * `/rutas/:id/variantes` como recurso plano una vez identificado por id. */
@Controller('variantes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_VARIANTES)
export class VariantesController {
  constructor(@Inject(VariantesService) private readonly variantesService: VariantesService) {}

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.variantesService.obtener(actor, id);
  }

  @Patch(':id')
  @Auditable('variante')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarVarianteDto,
  ) {
    return this.variantesService.actualizar(actor, id, body as ActualizarVariante);
  }
}
