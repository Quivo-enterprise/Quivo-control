import { Body, Controller, HttpCode, Inject, Param, Put, UseGuards } from '@nestjs/common';
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
}
