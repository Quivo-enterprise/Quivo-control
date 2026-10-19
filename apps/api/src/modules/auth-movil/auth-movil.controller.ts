import { Body, Controller, Get, HttpCode, Inject, Post, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  AuthConductorMovilRequestSchema,
  AuthSesionMovilRequestSchema,
  AuthVehiculoMovilRequestSchema,
  LogoutMovilRequestSchema,
  RefreshMovilRequestSchema,
  SeleccionAsignacionMovilRequestSchema,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { SyncDeviceThrottlerGuard } from '../sync/sync-device-throttler.guard.js';
import { AuthMovilGuard } from './auth-movil.guard.js';
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

  // Login/refresh sin sesión: se quedan por IP a propósito (limitar por usuario permitiría password spraying desde una IP).
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
  // Límite por dispositivo, no por IP (CGNAT; ver `sync-device-throttler.guard.ts`): `@SkipThrottle()` apaga el
  // global y `SyncDeviceThrottlerGuard` va DESPUÉS de `AuthMovilGuard`. Consulta ocasional: 10/min.
  @SkipThrottle()
  @Throttle({ device: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard)
  obtenerContexto(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.authMovilService.obtenerContexto(sesion);
  }
}

@Controller('mobile')
export class PerfilMovilController {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  @Get('perfil')
  // Límite por dispositivo, no por IP (CGNAT; ver `sync-device-throttler.guard.ts`): `@SkipThrottle()` apaga el
  // global y `SyncDeviceThrottlerGuard` va DESPUÉS de `AuthMovilGuard`. Cadencia real ~1/min: 10/min deja margen.
  @SkipThrottle()
  @Throttle({ device: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard)
  obtenerPerfil(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    // El perfil retorna la misma estructura rica que el contexto operativo,
    // que incluye toda la información del conductor, vehículo, sindicato y asignación.
    return this.authMovilService.obtenerContexto(sesion);
  }
}
