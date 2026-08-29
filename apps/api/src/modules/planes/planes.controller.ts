import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { PlanesService } from './planes.service.js';

@Controller('passenger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('pasajero')
export class PlanesController {
  constructor(@Inject(PlanesService) private readonly planes: PlanesService) {}

  @Get('plans')
  listar() {
    return this.planes.listarPlanes();
  }

  @Get('subscription')
  suscripcion(@CurrentUser() actor: AuthenticatedUser) {
    return this.planes.obtenerEntitlements(actor);
  }
}
