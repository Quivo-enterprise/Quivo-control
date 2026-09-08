import { Body, Controller, HttpCode, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { EstablecerPinMovilRequestSchema } from '@quivo/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilService } from './auth-movil.service.js';

class EstablecerPinMovilDto extends createZodDto(EstablecerPinMovilRequestSchema) {}

@Controller('mobile/credenciales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class CredencialesMovilesController {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  @Put('vehiculos/:id')
  @HttpCode(204)
  async establecerPinVehiculo(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: EstablecerPinMovilDto,
  ): Promise<void> {
    await this.authMovilService.establecerPinVehiculo(actor, id, body);
  }

  @Put('conductores/:id')
  @HttpCode(204)
  async establecerPinConductor(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: EstablecerPinMovilDto,
  ): Promise<void> {
    await this.authMovilService.establecerPinConductor(actor, id, body);
  }

  /** Genera un PIN de 6 dígitos con CSPRNG en vez de dejar que un admin elija uno débil —
   * ver JSDoc de `AuthMovilService.generarPinVehiculo` para la trampa operativa (rotar
   * revoca sesiones activas). Devuelve el PIN una sola vez; nunca queda en logs. */
  @Post('vehiculos/:id/generar')
  @HttpCode(200)
  generarPinVehiculo(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.authMovilService.generarPinVehiculo(actor, id);
  }

  /** Igual que `generarPinVehiculo`, para el PIN del conductor — ver JSDoc de
   * `AuthMovilService.generarPinConductor`. */
  @Post('conductores/:id/generar')
  @HttpCode(200)
  generarPinConductor(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.authMovilService.generarPinConductor(actor, id);
  }
}
