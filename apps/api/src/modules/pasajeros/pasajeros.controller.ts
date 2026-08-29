import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import { UpdatePassengerProfileRequestSchema } from '@quivo/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { PasajerosService } from './pasajeros.service.js';

class UpdatePassengerProfileDto extends createZodDto(UpdatePassengerProfileRequestSchema) {}

/** Datos privados de experiencia. Nunca reutilizar este controller para administración. */
@Controller('passenger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('pasajero')
export class PasajerosController {
  constructor(@Inject(PasajerosService) private readonly pasajeros: PasajerosService) {}

  @Get('me')
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.pasajeros.obtenerPerfil(actor);
  }

  @Patch('me')
  actualizar(@CurrentUser() actor: AuthenticatedUser, @Body() body: UpdatePassengerProfileDto) {
    return this.pasajeros.actualizarPerfil(actor, body);
  }
}
