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
  RefreshRequest,
  RefreshResponse,
  Rol,
} from '@quivo/shared';
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

      return {
        accessToken: await this.mintAccessToken(sessionToken),
        refreshToken: sessionToken,
        user: {
          id: user.id,
          email: user.email,
          rol: user.rol as Rol,
          sindicatoId: (user.sindicatoId as string | null | undefined) ?? null,
        },
      };
    } catch (error) {
      if (error instanceof APIError) {
        throw new UnauthorizedException('Credenciales inválidas');
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

  private bearerHeaders(sessionToken: string): Headers {
    return new Headers({ authorization: `Bearer ${sessionToken}` });
  }
}
