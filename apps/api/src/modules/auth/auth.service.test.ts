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
    const { refreshToken: refreshTokenInicial } = await authService.login({
      email: 'admin@quivo.local',
      password: 'Quivo123!',
    });

    // Antes de logout, el refresh token sigue siendo válido (y rota en el uso, QUI-359 —
    // de ahí que el logout de abajo use el token devuelto por este refresh, no el inicial).
    const { refreshToken } = await authService.refresh({ refreshToken: refreshTokenInicial });
    expect(refreshToken).not.toBe(refreshTokenInicial);

    await authService.logout({ refreshToken });

    // Después de logout, la sesión ya no existe — el mismo refresh token debe fallar.
    await expect(authService.refresh({ refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // QUI-359: el refresh token debe rotar en cada uso. Reusar el token inmediatamente anterior
  // dentro de la ventana de gracia (120 s) es un duplicado benigno (dos pestañas, respuesta
  // perdida): devuelve el token vigente sin rotar. Fuera de la ventana (cubierto con reloj
  // simulado en auth.service.refresh.test.ts) o con un token más viejo, se revoca solo esa sesión.
  it('rota el refresh token en cada uso; reusar el anterior dentro de la ventana devuelve el vigente sin rotar', async () => {
    const authService = new AuthService();
    const { refreshToken: refreshTokenInicial } = await authService.login({
      email: 'admin@quivo.local',
      password: 'Quivo123!',
    });

    const primerRefresh = await authService.refresh({ refreshToken: refreshTokenInicial });
    expect(primerRefresh.accessToken).toEqual(expect.any(String));
    expect(primerRefresh.refreshToken).not.toBe(refreshTokenInicial);

    const repetido = await authService.refresh({ refreshToken: refreshTokenInicial });
    expect(repetido.refreshToken).toBe(primerRefresh.refreshToken);

    // Dos rotaciones atrás ya no es tolerado: 401, y solo esa sesión se revoca.
    const segundoRefresh = await authService.refresh({ refreshToken: primerRefresh.refreshToken });
    await expect(authService.refresh({ refreshToken: refreshTokenInicial })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      authService.refresh({ refreshToken: segundoRefresh.refreshToken }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Hallazgo de security review (regresión introducida por QUI-359 en esta misma rama):
  // `refresh()` rota `session.token` en cada uso, pero `logout()` revocaba por *valor de
  // token* — un token viejo (previo a una rotación hecha por OTRA pestaña/dispositivo) ya
  // no matchea ninguna fila, así que el logout no encontraba nada que revocar y la sesión
  // vigente (con el token nuevo) seguía viva pese al logout explícito. Este es exactamente
  // ese escenario: se hace login, se refresca (rota T1→T2) y se cierra sesión con el T1
  // *viejo* — no con el T2 devuelto por el refresh, a diferencia del primer test de este
  // archivo. El fix resuelve la sesión por su `id` estable (no por el token recibido), así
  // que revocarla con un token desactualizado sigue funcionando mientras ese token siga
  // siendo válido en el momento del logout.
  it('logout con el refresh token viejo (pre-rotación) revoca la sesión de verdad — el token nuevo tampoco sirve después', async () => {
    const authService = new AuthService();
    const { refreshToken: tokenViejo } = await authService.login({
      email: 'admin@quivo.local',
      password: 'Quivo123!',
    });

    const { refreshToken: tokenNuevo } = await authService.refresh({ refreshToken: tokenViejo });
    expect(tokenNuevo).not.toBe(tokenViejo);

    // Logout con el token VIEJO (pre-rotación) — simula la pestaña rezagada que nunca se
    // enteró de la rotación hecha por otra pestaña.
    await authService.logout({ refreshToken: tokenViejo });

    // La sesión debe quedar revocada de verdad: ni el token viejo (esperado, ya no era
    // válido) NI el token nuevo (el bug: seguía sirviendo hasta su expiración natural)
    // deben poder refrescar después de este logout.
    await expect(authService.refresh({ refreshToken: tokenViejo })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(authService.refresh({ refreshToken: tokenNuevo })).rejects.toBeInstanceOf(
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
  }, 15_000);

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
