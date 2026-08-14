import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { auth } from '@quivo/db';
import type { FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  userId: string;
  rol: string;
  sindicatoId: string | null;
}

/**
 * Verifica el access token corto (JWT firmado con JWKS, plugin `jwt` de Better-Auth —
 * ver packages/db/src/auth.ts) vía `auth.api.verifyJWT`, no contra la sesión opaca (eso es
 * `/v1/auth/refresh`). Stateless: no pega a la DB de sesiones en cada request protegido,
 * solo verifica la firma contra las claves públicas (JWKS) que Better-Auth ya gestiona.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Falta el header Authorization: Bearer <token>');
    }

    const { payload } = await auth.api.verifyJWT({ body: { token } });
    if (!payload || typeof payload.sub !== 'string' || typeof payload.rol !== 'string') {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    request.user = {
      userId: payload.sub,
      rol: payload.rol,
      sindicatoId: (payload.sindicatoId as string | null | undefined) ?? null,
    };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim() || null;
}
