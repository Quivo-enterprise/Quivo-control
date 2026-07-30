import { Body, Controller, Post } from '@nestjs/common';
import { LoginRequestSchema, RefreshRequestSchema } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { AuthService } from './auth.service.js';

class LoginDto extends createZodDto(LoginRequestSchema) {}
class RefreshDto extends createZodDto(RefreshRequestSchema) {}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /v1/auth/login — contrato en apps/web/src/lib/auth/api-client.ts. */
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  /** POST /v1/auth/refresh — contrato en apps/web/src/lib/auth/api-client.ts. */
  @Post('refresh')
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body);
  }
}
