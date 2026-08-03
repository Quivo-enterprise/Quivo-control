import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthMovilService } from './auth-movil.service.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

@Injectable()
export class AuthMovilGuard implements CanActivate {
  constructor(@Inject(AuthMovilService) private readonly authMovilService: AuthMovilService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { sesionMovil?: SesionMovilAutenticada }>();
    const token = extraerBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }

    request.sesionMovil = await this.authMovilService.validarAccessToken(token);
    return true;
  }
}

function extraerBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
