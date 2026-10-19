import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

type RequestConSesionMovil = FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

/**
 * Base de los throttlers por dispositivo móvil: clave = `sesionMovil.deviceId` (estable entre
 * sesiones), no la IP, porque varios teléfonos comparten IP pública tras el CGNAT del operador.
 * Debe correr DESPUÉS de `AuthMovilGuard` (quien setea `req.sesionMovil`); el fallback a `req.ip`
 * es solo un cinturón defensivo: sin sesión válida `AuthMovilGuard` ya cortó con 401.
 * Las subclases solo fijan el nombre de throttler y su config en el constructor.
 */
export abstract class ThrottlerPorDispositivoGuard extends ThrottlerGuard {
  protected async getTracker(req: RequestConSesionMovil): Promise<string> {
    return req.sesionMovil?.deviceId ?? req.ip;
  }

  // Con throttler nombrado la base emite `Retry-After-<nombre>`; el estándar es `Retry-After`.
  protected async throwThrottlingException(
    context: ExecutionContext,
    detalle: ThrottlerLimitDetail,
  ): Promise<void> {
    this.getRequestResponse(context).res.header('Retry-After', detalle.timeToBlockExpire);
    return super.throwThrottlingException(context, detalle);
  }
}
