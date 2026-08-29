import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreatePassengerRecentSearchSchema,
  CreatePassengerSavedPlaceSchema,
  UpdatePassengerSavedPlaceSchema,
} from '@quivo/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { PasajerosDatosService } from './pasajeros-datos.service.js';

class CreateSavedPlaceDto extends createZodDto(CreatePassengerSavedPlaceSchema) {}
class UpdateSavedPlaceDto extends createZodDto(UpdatePassengerSavedPlaceSchema) {}
class CreateRecentSearchDto extends createZodDto(CreatePassengerRecentSearchSchema) {}

@Controller('passenger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('pasajero')
export class PasajerosDatosController {
  constructor(@Inject(PasajerosDatosService) private readonly service: PasajerosDatosService) {}

  @Get('favorites/lines')
  listarFavoritos(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listarFavoritos(actor);
  }

  @Post('favorites/lines/:lineId')
  guardarFavorito(@CurrentUser() actor: AuthenticatedUser, @Param('lineId') lineId: string) {
    return this.service.guardarFavorito(actor, lineId);
  }

  @Delete('favorites/lines/:lineId')
  eliminarFavorito(@CurrentUser() actor: AuthenticatedUser, @Param('lineId') lineId: string) {
    return this.service.eliminarFavorito(actor, lineId);
  }

  @Get('places')
  listarLugares(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listarLugares(actor);
  }

  @Post('places')
  guardarLugar(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateSavedPlaceDto) {
    return this.service.guardarLugar(actor, body);
  }

  @Patch('places/:id')
  actualizarLugar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateSavedPlaceDto,
  ) {
    return this.service.actualizarLugar(actor, id, body);
  }

  @Delete('places/:id')
  eliminarLugar(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.eliminarLugar(actor, id);
  }

  @Get('recent-searches')
  listarRecientes(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listarRecientes(actor);
  }

  @Post('recent-searches')
  guardarReciente(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateRecentSearchDto) {
    return this.service.guardarReciente(actor, body);
  }

  @Delete('recent-searches')
  eliminarRecientes(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.eliminarRecientes(actor);
  }

  @Get('alerts')
  listarAlertas(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listarAlertas(actor);
  }

  @Post('alerts/:targetType/:targetId')
  suscribirseAlerta(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
  ) {
    return this.service.suscribirseAlerta(actor, targetType, targetId);
  }

  @Delete('alerts/:targetType/:targetId')
  eliminarAlerta(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
  ) {
    return this.service.eliminarAlerta(actor, targetType, targetId);
  }
}
