import { Body, Controller, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarInfraccionSchema,
  SancionarInfraccionSchema,
  type ActualizarInfraccion,
  type SancionarInfraccion,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { InfraccionesService } from './infracciones.service.js';

class ActualizarInfraccionDto extends createZodDto(ActualizarInfraccionSchema) {}
class SancionarInfraccionDto extends createZodDto(SancionarInfraccionSchema) {}

/**
 * Acciones del admin sobre infracciones detectadas (docs/plan-en-vivo-alertas.md, PR A). El
 * listado por sesión vive en `GET /reportes/en-vivo/:sesionId/infracciones` (EnVivoController,
 * mismos guards/throttle que el resto del mapa en vivo). Estas dos son escrituras: sin el
 * throttle especial de poll, con el límite global por IP, y ambas `@Auditable`.
 */
@Controller('infracciones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class InfraccionesController {
  constructor(@Inject(InfraccionesService) private readonly infraccionesService: InfraccionesService) {}

  @Patch(':id')
  @Auditable('infraccion')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarInfraccionDto,
  ) {
    return this.infraccionesService.actualizar(actor, id, body as ActualizarInfraccion);
  }

  @Post(':id/sancionar')
  @Auditable('infraccion', 'sancionar')
  sancionar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: SancionarInfraccionDto,
  ) {
    return this.infraccionesService.sancionar(actor, id, body as SancionarInfraccion);
  }
}
