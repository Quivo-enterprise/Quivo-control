import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerPorDispositivoGuard } from './throttler-por-dispositivo.guard.js';

/**
 * Límite por dispositivo de las rutas móviles autenticadas (`/sync/batches`, vuelta actual,
 * paquete del día, perfil, etc.; ver `@LimitePorDispositivo`). El `ThrottlerGuard` global usa
 * `req.ip`, que acá reventaría: varios choferes de un operador móvil boliviano salen por el
 * mismo CGNAT y agotarían entre todos el cupo de la IP. Este guard cuenta por `deviceId`.
 *
 * Orden de guards: el global (`APP_GUARD`) corre siempre primero; en la ruta este guard va
 * DESPUÉS de `AuthMovilGuard` (necesita `req.sesionMovil`). Tráfico sin sesión válida nunca
 * llega acá: lo acota el tope por IP holgado `LIMITE_IP_MOVIL` (global, throttler 'default') y
 * la caché negativa por token de `AuthMovilGuard` (historia en su docblock, QUI-240).
 *
 * Throttler 'device' (no 'default'): la metadata de `@Throttle` se indexa por nombre. El límite
 * real de cada ruta viene de `@Throttle({ device })`; el 60/min del constructor es solo el
 * default si la ruta no lo declara.
 *
 * shortcut: storage en memoria por instancia (límite efectivo N× con N instancias de Cloud
 * Run), pasar a Redis si se sube max-instances.
 */
@Injectable()
export class SyncDeviceThrottlerGuard extends ThrottlerPorDispositivoGuard {
  // `@Inject(Reflector)` explícito — ver `roles.guard.ts`/`audit.interceptor.ts` (bug
  // conocido de `tsx` con `emitDecoratorMetadata` en clases de paquetes externos, evanw/
  // esbuild#257: sin esto, `dev`/`dev:worker` no resuelven bien el tipo del parámetro).
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super([{ name: 'device', ttl: 60_000, limit: 60 }], storageService, reflector);
  }
}
