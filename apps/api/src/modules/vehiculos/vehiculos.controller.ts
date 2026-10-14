import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ActualizarVehiculoSchema,
  CambiarEstadoVehiculoSchema,
  CrearVehiculoSchema,
  type ActualizarVehiculo,
  type CambiarEstadoVehiculo,
  type CrearVehiculo,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { VehiculoFotoService } from './vehiculo-foto.service.js';
import { VehiculosService } from './vehiculos.service.js';

class CrearVehiculoDto extends createZodDto(CrearVehiculoSchema) {}
class ActualizarVehiculoDto extends createZodDto(ActualizarVehiculoSchema) {}
class CambiarEstadoVehiculoDto extends createZodDto(CambiarEstadoVehiculoSchema) {}

/** RF-10..14 — CRUD de vehículos por sindicato (QUI-222). Mismo esquema de tenant-scoping
 * que socios (QUI-221): admin_quivo manda sindicatoId, el resto queda forzado al propio. */
@Controller('vehiculos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
export class VehiculosController {
  constructor(
    @Inject(VehiculosService) private readonly vehiculosService: VehiculosService,
    @Inject(VehiculoFotoService) private readonly fotoService: VehiculoFotoService,
  ) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.vehiculosService.listar(actor);
  }

  @Get('verificar-placa')
  verificarPlaca(@CurrentUser() actor: AuthenticatedUser, @Query('placa') placa: string) {
    return this.vehiculosService.verificarPlaca(actor, placa);
  }

  @Get(':id/historial-estados')
  historialEstados(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.vehiculosService.historialEstados(actor, id);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.vehiculosService.obtener(actor, id);
  }

  @Post()
  @Auditable('vehiculo')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearVehiculoDto) {
    return this.vehiculosService.crear(actor, body as CrearVehiculo);
  }

  @Patch(':id/estado')
  @Auditable('vehiculo')
  cambiarEstado(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CambiarEstadoVehiculoDto,
  ) {
    return this.vehiculosService.cambiarEstado(actor, id, body as CambiarEstadoVehiculo);
  }

  @Patch(':id')
  @Auditable('vehiculo')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarVehiculoDto,
  ) {
    return this.vehiculosService.actualizar(actor, id, body as ActualizarVehiculo);
  }

  /** Quita la foto de la unidad (la sube el conductor desde la app). Sin rol `operador`. */
  @Delete(':id/foto')
  @Roles('admin_quivo', 'admin_sindicato')
  @Auditable('vehiculo', 'quitar_foto')
  quitarFoto(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.fotoService.quitar(actor, id);
  }
}
