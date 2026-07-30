import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarVehiculoSchema,
  CrearVehiculoSchema,
  type ActualizarVehiculo,
  type CrearVehiculo,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { VehiculosService } from './vehiculos.service.js';

class CrearVehiculoDto extends createZodDto(CrearVehiculoSchema) {}
class ActualizarVehiculoDto extends createZodDto(ActualizarVehiculoSchema) {}

/** RF-10..14 — CRUD de vehículos por sindicato (QUI-222). Mismo esquema de tenant-scoping
 * que socios (QUI-221): admin_quivo manda sindicatoId, el resto queda forzado al propio. */
@Controller('vehiculos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
export class VehiculosController {
  constructor(private readonly vehiculosService: VehiculosService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.vehiculosService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.vehiculosService.obtener(actor, id);
  }

  @Post()
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearVehiculoDto) {
    return this.vehiculosService.crear(actor, body as CrearVehiculo);
  }

  @Patch(':id')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarVehiculoDto,
  ) {
    return this.vehiculosService.actualizar(actor, id, body as ActualizarVehiculo);
  }
}
