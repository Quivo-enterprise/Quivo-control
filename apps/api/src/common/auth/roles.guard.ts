import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator.js';
import type { AuthenticatedUser } from './jwt-auth.guard.js';

/** Corre después de `JwtAuthGuard` (necesita `request.user` ya seteado) — el orden en `@UseGuards(JwtAuthGuard, RolesGuard)` importa. */
@Injectable()
export class RolesGuard implements CanActivate {
  // `@Inject(Reflector)` explícito — ver `audit.interceptor.ts` (mismo bug de `tsx`/esbuild
  // con `emitDecoratorMetadata` y clases de paquetes externos, evanw/esbuild#257).
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user || !allowedRoles.includes(request.user.rol)) {
      throw new ForbiddenException('No tenés permiso para realizar esta acción');
    }
    return true;
  }
}
