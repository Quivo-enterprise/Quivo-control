import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  AdminResetPasswordRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
} from '@quivo/shared';
import { LoginWebThrottlerGuard } from '../../common/auth/login-throttler.guard.js';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { AuthService } from './auth.service.js';

class LoginDto extends createZodDto(LoginRequestSchema) {}
class RefreshDto extends createZodDto(RefreshRequestSchema) {}
class LogoutDto extends createZodDto(LogoutRequestSchema) {}
class AdminResetPasswordDto extends createZodDto(AdminResetPasswordRequestSchema) {}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /** POST /v1/auth/login — contrato en apps/web/src/lib/auth/api-client.ts. Límite mucho
   * más estricto que el default global (QUI-251): sin esto, un login con contraseña
   * incorrecta no tenía ningún freno — fuerza bruta ilimitada por IP. Dos cubos de 60 s:
   * ip+email 5 e ip sola 20 (oficinas detrás de una IP); ver `LoginWebThrottlerGuard`. */
  @Post('login')
  @SkipThrottle()
  @UseGuards(LoginWebThrottlerGuard)
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

  /** Directorio administrativo sin credenciales ni sesiones. El guard coincide con el del
   * reset para que solo `admin_quivo` pueda conocer y seleccionar usuarios de otros tenants. */
  @Get('admin/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_quivo')
  listarUsuarios() {
    return this.authService.listarUsuarios();
  }

  /** POST /v1/auth/admin/reset-password — reset asistido, sin flujo de email (ver
   * AuthService.resetPasswordComoAdmin para el porqué). Solo `admin_quivo`: reinicia la
   * contraseña de cualquier usuario, no solo de su propio sindicato. */
  @Post('admin/reset-password')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_quivo')
  @HttpCode(204)
  async resetPasswordComoAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: AdminResetPasswordDto,
  ): Promise<void> {
    await this.authService.resetPasswordComoAdmin(actor, body);
  }
}
