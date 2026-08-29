import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { APIError } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { auth, prisma, withTenantContext } from '@quivo/db';
import type {
  AdminResetPasswordRequest,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  PassengerRegisterRequest,
  RefreshRequest,
  RefreshResponse,
  Rol,
  UsuarioAdministrativo,
} from '@quivo/shared';
import { RolSchema } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Traduce `auth.api.*` de Better-Auth (sesión opaca + JWT firmado con JWKS, ver
 * `packages/db/src/auth.ts`) al contrato ya fijado que espera `apps/web`
 * (`accessToken`/`refreshToken`/`user`). Better-Auth sigue siendo quien hashea passwords,
 * valida sesiones y firma tokens — acá solo se reempaquetan nombres de campos.
 */
@Injectable()
export class AuthService {
  async login({ email, password }: LoginRequest): Promise<LoginResponse> {
    try {
      const { token: sessionToken, user } = await auth.api.signInEmail({
        body: { email, password },
      });

      return this.toLoginResponse(sessionToken, user);
    } catch (error) {
      if (error instanceof APIError) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      throw error;
    }
  }

  /**
   * Alta pública de QUIVO Rutas. El rol nunca viene del body: Better Auth recibe siempre
   * `pasajero`, de modo que un cliente no puede autoelevarse a un rol de Control.
   */
  async registerPassenger(input: PassengerRegisterRequest): Promise<LoginResponse> {
    try {
      const result = await auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          rol: 'pasajero',
          sindicatoId: null,
        },
      });

      await withTenantContext(
        { rol: 'pasajero', sindicatoId: null, userId: result.user.id },
        (tx) =>
          tx.passengerProfile.create({
            data: {
              userId: result.user.id,
              termsVersion: input.termsVersion,
              termsAcceptedAt: new Date(),
            },
          }),
      );

      // Better Auth emite una sesión cuando el alta no requiere verificación inmediata.
      // Si una configuración futura de email verification no la emite, reutilizamos el
      // flujo de login para mantener estable el contrato de la API.
      if (typeof result.token === 'string' && result.token.length > 0) {
        return this.toLoginResponse(result.token, result.user);
      }
      return this.login({ email: input.email, password: input.password });
    } catch (error) {
      // No revelamos si el email ya existe: la respuesta pública es deliberadamente
      // genérica para evitar enumeración de cuentas.
      if (error instanceof APIError) {
        throw new UnauthorizedException('No se pudo crear la cuenta');
      }
      throw error;
    }
  }

  async refresh({ refreshToken }: RefreshRequest): Promise<RefreshResponse> {
    const session = await auth.api.getSession({ headers: this.bearerHeaders(refreshToken) });
    if (!session) {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }

    return {
      accessToken: await this.mintAccessToken(refreshToken),
      refreshToken,
    };
  }

  /** POST /v1/auth/logout (QUI-251) — revoca la sesión de verdad en la DB (`auth.api.signOut`),
   * no solo un borrado del lado del cliente. Sin esto, un `refreshToken` robado seguía
   * siendo válido hasta su expiración natural (hasta 30 días) aunque el usuario ya hubiera
   * "cerrado sesión" en su browser. */
  async logout({ refreshToken }: LogoutRequest): Promise<void> {
    await auth.api.signOut({ headers: this.bearerHeaders(refreshToken) });
  }

  /** GET /v1/auth/admin/users — directorio mínimo para preparar el reset asistido. La
   * autorización vive en el controller; esta consulta no devuelve hashes, cuentas ni
   * sesiones de Better Auth. */
  async listarUsuarios(): Promise<UsuarioAdministrativo[]> {
    return prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        rol: true,
        sindicatoId: true,
      },
      orderBy: [{ rol: 'asc' }, { email: 'asc' }],
    }) as Promise<UsuarioAdministrativo[]>;
  }

  /** POST /v1/auth/admin/reset-password — reset asistido por `admin_quivo` (ver RolesGuard
   * en el controller), sin flujo de email: el proyecto no tiene proveedor de email
   * configurado, así que Better-Auth's forgetPassword/resetPassword (que sí soporta esto de
   * forma nativa) no tiene forma de entregar el link. La contraseña nueva se comunica fuera
   * de banda; acá solo se re-hashea (`better-auth/crypto`, el mismo hasher que usa
   * Better-Auth internamente) y se revocan las sesiones existentes para forzar a que el
   * usuario vuelva a autenticarse con la nueva.
   *
   * No lleva `@Auditable`: ese interceptor guarda el body de la request tal cual en
   * `audit_log.diff` — con la contraseña nueva en texto plano en el body, eso filtraría la
   * contraseña a cualquiera con acceso a Auditoría. Acá se audita a mano, solo con el email
   * del usuario afectado. */
  async resetPasswordComoAdmin(
    actor: AuthenticatedUser,
    { email, newPassword }: AdminResetPasswordRequest,
  ): Promise<void> {
    const usuario = await prisma.user.findUnique({ where: { email } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const hashed = await hashPassword(newPassword);
    const cuenta = await prisma.account.findFirst({
      where: { userId: usuario.id, providerId: 'credential' },
    });
    if (cuenta) {
      await prisma.account.update({ where: { id: cuenta.id }, data: { password: hashed } });
    } else {
      await prisma.account.create({
        data: {
          id: randomUUID(),
          accountId: usuario.id,
          providerId: 'credential',
          userId: usuario.id,
          password: hashed,
        },
      });
    }

    await prisma.session.deleteMany({ where: { userId: usuario.id } });

    // `audit_log` tiene RLS (QUI-218) — a diferencia de `user`/`account`/`session` (sin
    // política propia, de ahí que las llamadas de arriba usen `prisma` a secas), el insert
    // necesita el contexto de tenant seteado o la política lo rechaza.
    await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
      tx.auditLog.create({
        data: {
          sindicatoId: usuario.sindicatoId,
          usuarioId: actor.userId,
          entidad: 'usuario',
          entidadId: usuario.id,
          accion: 'reset_password',
          diff: { email: usuario.email },
        },
      }),
    );
  }

  /** El token corto (`jwt` plugin) requiere una sesión válida — se la pasamos vía Bearer (plugin `bearer`, no hay cookies server-to-server). */
  private async mintAccessToken(sessionToken: string): Promise<string> {
    const { token } = await auth.api.getToken({ headers: this.bearerHeaders(sessionToken) });
    return token;
  }

  private async toLoginResponse(
    sessionToken: string,
    user: { id: string; email: string; rol: unknown; sindicatoId?: unknown },
  ): Promise<LoginResponse> {
    const rol = RolSchema.parse(user.rol) as Rol;
    return {
      accessToken: await this.mintAccessToken(sessionToken),
      refreshToken: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        rol,
        sindicatoId: (user.sindicatoId as string | null | undefined) ?? null,
      },
    };
  }

  private bearerHeaders(sessionToken: string): Headers {
    return new Headers({ authorization: `Bearer ${sessionToken}` });
  }
}
