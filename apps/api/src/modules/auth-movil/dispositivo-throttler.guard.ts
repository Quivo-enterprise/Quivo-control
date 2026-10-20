import type { ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

type RequestConSesionMovil = FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

/** Con throttler nombrado la base emite `Retry-After-<nombre>`; el estándar es `Retry-After`
 * (el cliente móvil lo lee de ahí). Base común de los guards nombrados de auth-movil. */
export abstract class RetryAfterThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    detalle: ThrottlerLimitDetail,
  ): Promise<void> {
    this.getRequestResponse(context).res.header('Retry-After', detalle.timeToBlockExpire);
    return super.throwThrottlingException(context, detalle);
  }
}

/**
 * Límite por dispositivo de las rutas móviles autenticadas (`/sync/batches`, vuelta actual,
 * paquete del día, perfil, foto, etc.; ver `@LimitePorDispositivo`). El `ThrottlerGuard` global
 * usa `req.ip`, que acá reventaría: varios choferes de un operador móvil boliviano salen por el
 * mismo CGNAT y agotarían entre todos el cupo de la IP. Este guard cuenta por `deviceId`
 * (estable entre sesiones).
 *
 * Orden de guards: el global (`APP_GUARD`) corre siempre primero; en la ruta este guard va
 * DESPUÉS de `AuthMovilGuard` (necesita `req.sesionMovil`; el fallback a `req.ip` es solo un
 * cinturón defensivo). Tráfico sin sesión válida nunca llega acá: lo acota el tope por IP
 * holgado `LIMITE_IP_MOVIL` (global, throttler 'default') y la caché negativa por token de
 * `AuthMovilGuard` (historia en su docblock, QUI-240).
 *
 * Throttler 'device' (no 'default'): la metadata de `@Throttle` se indexa por nombre. El límite
 * real de cada ruta viene de `@Throttle({ device })`; el 60/min del constructor es solo el
 * default si la ruta no lo declara.
 *
 * shortcut: storage en memoria por instancia (límite efectivo N× con N instancias de Cloud
 * Run), pasar a Redis si se sube max-instances.
 */
@Injectable()
export class DispositivoThrottlerGuard extends RetryAfterThrottlerGuard {
  // `@Inject(Reflector)` explícito — ver `roles.guard.ts`/`audit.interceptor.ts` (bug
  // conocido de `tsx` con `emitDecoratorMetadata` en clases de paquetes externos, evanw/
  // esbuild#257: sin esto, `dev`/`dev:worker` no resuelven bien el tipo del parámetro).
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super([{ name: 'device', ttl: 60_000, limit: 60 }], storageService, reflector);
  }

  protected async getTracker(req: RequestConSesionMovil): Promise<string> {
    return req.sesionMovil?.deviceId ?? req.ip;
  }
}
