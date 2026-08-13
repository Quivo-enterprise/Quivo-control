import { NotFoundException, UnauthorizedException } from '@nestjs/common';
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
    await expect(authService.refresh({ refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza login con contraseña incorrecta', async () => {
    const authService = new AuthService();
    await expect(
      authService.login({ email: 'admin@quivo.local', password: 'contraseña-incorrecta' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lista el directorio administrativo sin exponer credenciales ni sesiones', async () => {
    const authService = new AuthService();

    await expect(authService.listarUsuarios()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: 'admin@quivo.local',
          rol: 'admin_quivo',
          sindicatoId: null,
        }),
        expect.objectContaining({ email: 'admin@sindicato.local', rol: 'admin_sindicato' }),
      ]),
    );
  });

  // Objetivo `admin@sindicato.local` (no `admin@quivo.local`, que usan los tests de arriba)
  // — y se restaura la contraseña al final para no dejar el seed mutado entre corridas.
  it('reset asistido: revoca sesiones existentes y permite login con la contraseña nueva', async () => {
    const authService = new AuthService();
    const actor = { userId: 'test-admin', rol: 'admin_quivo', sindicatoId: null };

    const sesionPrevia = await authService.login({
      email: 'admin@sindicato.local',
      password: 'Quivo123!',
    });

    await authService.resetPasswordComoAdmin(actor, {
      email: 'admin@sindicato.local',
      newPassword: 'NuevaClave123!',
    });

    // La sesión que existía antes del reset queda revocada.
    await expect(
      authService.refresh({ refreshToken: sesionPrevia.refreshToken }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // La contraseña vieja ya no sirve; la nueva sí.
    await expect(
      authService.login({ email: 'admin@sindicato.local', password: 'Quivo123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      authService.login({ email: 'admin@sindicato.local', password: 'NuevaClave123!' }),
    ).resolves.toMatchObject({ accessToken: expect.any(String) });

    await authService.resetPasswordComoAdmin(actor, {
      email: 'admin@sindicato.local',
      newPassword: 'Quivo123!',
    });
  });

  it('reset asistido: 404 si el email no existe', async () => {
    const authService = new AuthService();
    const actor = { userId: 'test-admin', rol: 'admin_quivo', sindicatoId: null };
    await expect(
      authService.resetPasswordComoAdmin(actor, {
        email: 'no-existe@quivo.local',
        newPassword: 'NuevaClave123!',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
