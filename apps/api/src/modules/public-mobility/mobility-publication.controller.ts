import { Body, Controller, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { EstadoPublicacionSchema, type EstadoPublicacion } from '@quivo/shared';
import { z } from 'zod';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { MobilityPublicationService, type MobilityResource } from './mobility-publication.service.js';

class ActualizarPublicacionDto extends createZodDto(z.object({ status: EstadoPublicacionSchema })) {}

@Controller('mobility-publications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
export class MobilityPublicationController {
  constructor(@Inject(MobilityPublicationService) private readonly publications: MobilityPublicationService) {}

  @Patch(':resource/:id')
  @Auditable('movilidad_publica', 'publicar')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('resource') resource: MobilityResource,
    @Param('id') id: string,
    @Body() body: ActualizarPublicacionDto,
  ) {
    return this.publications.actualizar(actor, resource, id, body.status as EstadoPublicacion);
  }
}
