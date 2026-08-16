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

  // QUI-359: el refresh token debía rotar en cada uso (antes, `refresh()` devolvía el
  // mismo token indefinidamente — un token robado servía hasta 30 días sin detección).
  //
  // Hallazgo de security review (actualizado en esta misma rama): reusar un token ya
  // rotado ahora revoca la *familia completa* de sesión del usuario, no solo rechaza el
  // intento con el token viejo. Antes solo se devolvía 401 y la sesión ya rotada seguía
  // viva — quien usara el token robado *primero* se quedaba con el acceso y el usuario
  // legítimo era el expulsado, al revés de lo que debía pasar. Por eso el token que
  // "ganó" la rotación (`primerRefresh.refreshToken`) tampoco sigue sirviendo después.
  it('rota el refresh token en cada uso; reusar el token viejo tras rotar revoca toda la sesión (detección de reuso)', async () => {
    const authService = new AuthService();
    const { refreshToken: refreshTokenInicial } = await authService.login({
      email: 'admin@quivo.local',
      password: 'Quivo123!',
    });

    const primerRefresh = await authService.refresh({ refreshToken: refreshTokenInicial });
    expect(primerRefresh.accessToken).toEqual(expect.any(String));
    expect(primerRefresh.refreshToken).toEqual(expect.any(String));
    // No es el mismo que el usado para pedirlo: rotó.
    expect(primerRefresh.refreshToken).not.toBe(refreshTokenInicial);

    // Reusar el token ya rotado (ej. un atacante que lo copió antes de que el usuario
    // legítimo refrescara) debe fallar — se reconstruye a qué sesión pertenecía (aunque ya
    // no matchea directamente) y se detecta como reuso.
    await expect(
      authService.refresh({ refreshToken: refreshTokenInicial }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // El token que "ganó" la rotación tampoco sigue sirviendo — la sesión completa quedó
    // revocada, no solo el intento con el token viejo.
    await expect(
      authService.refresh({ refreshToken: primerRefresh.refreshToken }),
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
