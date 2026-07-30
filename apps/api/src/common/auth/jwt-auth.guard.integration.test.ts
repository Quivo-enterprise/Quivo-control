import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../../modules/auth/auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * Contra Better-Auth de verdad (sin mockear `auth.api.verifyJWT`) — así detecta bugs de
 * configuración como el que encontramos armando QUI-220: sin `BETTER_AUTH_URL`, el plugin
 * `jwt` firma `iss`/`aud` vacíos y el propio `verifyJWT` de Better-Auth rechaza CUALQUIER
 * token con `aud` falsy, incluso uno recién firmado y válido — el test con `verifyJWT`
 * mockeado (`jwt-auth.guard.test.ts`) no lo detecta porque nunca llega a firmar un JWT real.
 */
describe('JwtAuthGuard (contra Better-Auth real)', () => {
  it('acepta un access token recién emitido por AuthService.login', async () => {
    const authService = new AuthService();
    const { accessToken } = await authService.login({
      email: 'admin@quivo.local',
      password: 'Quivo123!',
    });

    const request = { headers: { authorization: `Bearer ${accessToken}` } } as {
      headers: Record<string, string>;
      user?: unknown;
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const guard = new JwtAuthGuard();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ rol: 'admin_quivo', sindicatoId: null });
  });
});
