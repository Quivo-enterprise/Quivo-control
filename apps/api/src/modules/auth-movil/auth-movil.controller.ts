import { Body, Controller, Get, HttpCode, Inject, Post, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthConductorMovilRequestSchema,
  AuthSesionMovilRequestSchema,
  AuthVehiculoMovilRequestSchema,
  LogoutMovilRequestSchema,
  RefreshMovilRequestSchema,
  SeleccionAsignacionMovilRequestSchema,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { LimitePorDispositivo } from '../sync/limite-por-dispositivo.decorator.js';
import { AuthMovilService } from './auth-movil.service.js';
import { CurrentMobileSession } from './current-mobile-session.decorator.js';
import { LockoutMovilExceptionFilter } from './lockout-movil-exception.filter.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

class AuthVehiculoMovilDto extends createZodDto(AuthVehiculoMovilRequestSchema) {}
class AuthConductorMovilDto extends createZodDto(AuthConductorMovilRequestSchema) {}
class AuthSesionMovilDto extends createZodDto(AuthSesionMovilRequestSchema) {}
class SeleccionAsignacionMovilDto extends createZodDto(SeleccionAsignacionMovilRequestSchema) {}
class RefreshMovilDto extends createZodDto(RefreshMovilRequestSchema) {}
class LogoutMovilDto extends createZodDto(LogoutMovilRequestSchema) {}

@Controller('mobile/auth')
export class AuthMovilController {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  // Logins sin sesión: estrictos por IP a propósito (limitar por usuario permitiría password spraying desde una IP).
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

  /** Login de un solo paso: placa + PIN del conductor. Reemplaza a `/vehiculo` +
   * `/conductor` (vivos detrás de `MOBILE_LEGACY_AUTH_ENABLED`, ver ese servicio). */
  @Post('sesion')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseFilters(LockoutMovilExceptionFilter)
  autenticarSesion(@Body() body: AuthSesionMovilDto) {
    return this.authMovilService.autenticarSesion(body);
  }

  @Post('sesion/asignacion')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  seleccionarAsignacion(@Body() body: SeleccionAsignacionMovilDto) {
    return this.authMovilService.seleccionarAsignacion(body);
  }

  // Refresh holgado por IP: el refresh token es opaco y de alta entropía (no hay qué adivinar) y
  // el CGNAT (muchos teléfonos tras una IP) pega justo acá; no aplica el criterio de los logins.
  @Post('refresh')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  refresh(@Body() body: RefreshMovilDto) {
    return this.authMovilService.refresh(body);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: LogoutMovilDto): Promise<void> {
    await this.authMovilService.logout(body);
  }

  @Get('contexto-operativo')
  @LimitePorDispositivo(10)
  obtenerContexto(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.authMovilService.obtenerContexto(sesion);
  }
}

@Controller('mobile')
export class PerfilMovilController {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  @Get('perfil')
  @LimitePorDispositivo(10)
  obtenerPerfil(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    // El perfil retorna la misma estructura rica que el contexto operativo,
    // que incluye toda la información del conductor, vehículo, sindicato y asignación.
    return this.authMovilService.obtenerContexto(sesion);
  }
}
