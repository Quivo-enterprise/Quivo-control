import { createHash } from 'node:crypto';
import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
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
 * (limita 'default' global a un tope holgado por IP, pre-auth) y este guard, con nombre propio
 * 'usuario', va DESPUÉS de `JwtAuthGuard` y ANTES de `RolesGuard` en el `@UseGuards(...)` (así
 * también se cuentan usuarios autenticados con rol equivocado). Mismo patrón que
 * `SyncDeviceThrottlerGuard`.
 *
 * Fuente única del límite: 600/60 s vive SOLO en el constructor de abajo; el controller NO
 * lleva `@Throttle({ usuario })` (un decorator ganaría sobre el constructor y duplicaría el valor).
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

  /**
   * La key base incluye clase+handler, o sea un contador por handler (4 handlers = 4×600).
   * Acá el cupo es por usuario en TODO el controller: la key no depende del handler.
   */
  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return createHash('sha256').update(`en-vivo-usuario-${name}-${tracker}`).digest('hex');
  }
}
