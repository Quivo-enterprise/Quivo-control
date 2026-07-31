import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';

/**
 * Contra Better-Auth real (mismo criterio que jwt-auth.guard.integration.test.ts) — usa el
 * usuario seed real en vez de mockear `auth.api.*`, así detecta si `signOut` deja de revocar
 * la sesión de verdad (bug que este test existe específicamente para atrapar, QUI-251:
 * antes de esto "cerrar sesión" era puramente client-side).
 */
describe('AuthService (contra Better-Auth real)', () => {
  it('login → refresh funciona; logout revoca la sesión y el refresh siguiente falla', async () => {
    const authService = new AuthService();
    const { refreshToken } = await authService.login({
      email: 'admin@quivo.local',
      password: 'Quivo123!',
    });

    // Antes de logout, el refresh token sigue siendo válido.
    await expect(authService.refresh({ refreshToken })).resolves.toMatchObject({
      accessToken: expect.any(String),
    });

    await authService.logout({ refreshToken });

    // Después de logout, la sesión ya no existe — el mismo refresh token debe fallar.
    await expect(authService.refresh({ refreshToken })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza login con contraseña incorrecta', async () => {
    const authService = new AuthService();
    await expect(
      authService.login({ email: 'admin@quivo.local', password: 'contraseña-incorrecta' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
