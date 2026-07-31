import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarConductorSchema,
  CrearConductorSchema,
  type ActualizarConductor,
  type CrearConductor,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ConductoresService } from './conductores.service.js';

class CrearConductorDto extends createZodDto(CrearConductorSchema) {}
class ActualizarConductorDto extends createZodDto(ActualizarConductorSchema) {}

/** RF-15..19 — CRUD de conductores por sindicato (QUI-223). */
@Controller('conductores')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
export class ConductoresController {
  constructor(private readonly conductoresService: ConductoresService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.conductoresService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.conductoresService.obtener(actor, id);
  }

  @Post()
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearConductorDto) {
    return this.conductoresService.crear(actor, body as CrearConductor);
  }

  @Patch(':id')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarConductorDto,
  ) {
    return this.conductoresService.actualizar(actor, id, body as ActualizarConductor);
  }
}
