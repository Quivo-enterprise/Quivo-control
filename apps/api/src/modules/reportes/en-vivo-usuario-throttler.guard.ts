import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, ThrottlerGuard, type ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

type RequestConUsuario = FastifyRequest & { user?: AuthenticatedUser };

/**
 * Rate limit de `/reportes/en-vivo/*` por USUARIO autenticado en vez de por IP.
 *
 * Cada pestaña de `/en-vivo` hace ~30 req/min de `/posiciones` (poll de 2 s) + ~30 req/min de
 * traza de la sesión seleccionada (hasta 60 con `hayMas`). Con la key por IP del throttler
 * global (`app.module.ts`), varios operadores o pestañas detrás del mismo NAT comparten un
 * único cupo y reciben 429. Acá la key es `req.user.userId`, resuelto por `JwtAuthGuard`.
 *
 * Orden de guards: el `ThrottlerGuard` global (`APP_GUARD`) corre SIEMPRE antes que los guards
 * de clase/ruta, o sea ANTES de `JwtAuthGuard`; por eso el controller lleva `@SkipThrottle()`
 * (apaga el nombre 'default' global) y este guard, con nombre propio 'usuario', va DESPUÉS de
 * `JwtAuthGuard` en el `@UseGuards(...)`. Mismo patrón que `SyncDeviceThrottlerGuard`.
 *
 * Seguridad de la key: `req.user` solo lo setea `JwtAuthGuard` tras verificar la firma del
 * JWT; nunca se deriva de un header o parámetro crudo del cliente. Si por algún motivo no hay
 * usuario (no ocurre en la práctica: `JwtAuthGuard` corta con 401 antes), cae a `req.ip`.
 *
 * Storage en memoria por instancia: con N instancias el límite efectivo es N×600/min.
 */
@Injectable()
export class EnVivoUsuarioThrottlerGuard extends ThrottlerGuard {
  // `@Inject(Reflector)` explícito: ver `sync-device-throttler.guard.ts` (bug tsx/esbuild#257).
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super([{ name: 'usuario', ttl: 60_000, limit: 600 }], storageService, reflector);
  }

  protected async getTracker(req: RequestConUsuario): Promise<string> {
    return req.user?.userId ?? req.ip;
  }
}
