import { Injectable, UnauthorizedException } from '@nestjs/common';
import { APIError } from 'better-auth';
import { auth } from '@quivo/db';
import type {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshRequest,
  RefreshResponse,
  Rol,
} from '@quivo/shared';

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

  /** El token corto (`jwt` plugin) requiere una sesión válida — se la pasamos vía Bearer (plugin `bearer`, no hay cookies server-to-server). */
  private async mintAccessToken(sessionToken: string): Promise<string> {
    const { token } = await auth.api.getToken({ headers: this.bearerHeaders(sessionToken) });
    return token;
  }

  private bearerHeaders(sessionToken: string): Headers {
    return new Headers({ authorization: `Bearer ${sessionToken}` });
  }
}
