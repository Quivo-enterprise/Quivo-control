import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthConductorMovilRequestSchema,
  AuthVehiculoMovilRequestSchema,
  LogoutMovilRequestSchema,
  RefreshMovilRequestSchema,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthMovilGuard } from './auth-movil.guard.js';
import { AuthMovilService } from './auth-movil.service.js';
import { CurrentMobileSession } from './current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

class AuthVehiculoMovilDto extends createZodDto(AuthVehiculoMovilRequestSchema) {}
class AuthConductorMovilDto extends createZodDto(AuthConductorMovilRequestSchema) {}
class RefreshMovilDto extends createZodDto(RefreshMovilRequestSchema) {}
class LogoutMovilDto extends createZodDto(LogoutMovilRequestSchema) {}

@Controller('mobile/auth')
export class AuthMovilController {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  @Post('vehiculo')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  autenticarVehiculo(@Body() body: AuthVehiculoMovilDto) {
    return this.authMovilService.autenticarVehiculo(body);
  }

  @Post('conductor')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  autenticarConductor(@Body() body: AuthConductorMovilDto) {
    return this.authMovilService.autenticarConductor(body);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Body() body: RefreshMovilDto) {
    return this.authMovilService.refresh(body);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: LogoutMovilDto): Promise<void> {
    await this.authMovilService.logout(body);
  }

  @Get('contexto-operativo')
  @UseGuards(AuthMovilGuard)
  obtenerContexto(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.authMovilService.obtenerContexto(sesion);
  }
}

@Controller('mobile')
export class PerfilMovilController {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  @Get('perfil')
  @UseGuards(AuthMovilGuard)
  obtenerPerfil(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    // El perfil retorna la misma estructura rica que el contexto operativo,
    // que incluye toda la información del conductor, vehículo, sindicato y asignación.
    return this.authMovilService.obtenerContexto(sesion);
  }
}
