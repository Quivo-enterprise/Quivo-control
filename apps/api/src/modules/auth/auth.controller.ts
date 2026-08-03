import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LoginRequestSchema, LogoutRequestSchema, RefreshRequestSchema } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthService } from './auth.service.js';

class LoginDto extends createZodDto(LoginRequestSchema) {}
class RefreshDto extends createZodDto(RefreshRequestSchema) {}
class LogoutDto extends createZodDto(LogoutRequestSchema) {}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /** POST /v1/auth/login — contrato en apps/web/src/lib/auth/api-client.ts. Límite mucho
   * más estricto que el default global (QUI-251): sin esto, un login con contraseña
   * incorrecta no tenía ningún freno — fuerza bruta ilimitada por IP. */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  /** POST /v1/auth/refresh — contrato en apps/web/src/lib/auth/api-client.ts. */
  @Post('refresh')
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body);
  }

  /** POST /v1/auth/logout (QUI-251) — revoca la sesión de verdad, no solo un cierre del
   * lado del cliente. `204` porque no hay nada que devolver. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.authService.logout(body);
  }
}
