import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  RegisterPassengerDeviceRequestSchema,
  UpdatePassengerNotificationPreferencesSchema,
} from '@quivo/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { NotificacionesService } from './notificaciones.service.js';

class RegisterDeviceDto extends createZodDto(RegisterPassengerDeviceRequestSchema) {}
class UpdatePreferencesDto extends createZodDto(UpdatePassengerNotificationPreferencesSchema) {}

@Controller('passenger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('pasajero')
export class NotificacionesController {
  constructor(@Inject(NotificacionesService) private readonly service: NotificacionesService) {}

  @Post('devices')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  registrarDispositivo(@CurrentUser() actor: AuthenticatedUser, @Body() body: RegisterDeviceDto) {
    return this.service.registrarDispositivo(actor, body);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async eliminarDispositivo(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    await this.service.eliminarDispositivo(actor, id);
  }

  @Get('notification-preferences')
  preferencias(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.obtenerPreferencias(actor);
  }

  @Patch('notification-preferences')
  actualizarPreferencias(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdatePreferencesDto,
  ) {
    return this.service.actualizarPreferencias(actor, body);
  }

  @Get('notifications')
  listar(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listar(actor, limit, unread, cursor);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async marcarLeida(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    await this.service.marcarLeida(actor, id);
  }

  @Post('notifications/read-all')
  marcarTodasLeidas(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.marcarTodasLeidas(actor);
  }
}
