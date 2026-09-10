import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, ThrottlerGuard, type ThrottlerStorage } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

type RequestConSesionMovil = FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

/**
 * `POST /sync/batches` recibe la posición GPS de cada vehículo activo con la frecuencia
 * sostenida de la app móvil nueva (~6 req/min por teléfono durante toda la jornada). El
 * `ThrottlerGuard` global (`app.module.ts`, QUI-251) usa `req.ip` como key de rate limit —
 * correcto para el resto de la API, pero acá revienta: varios choferes de un mismo operador
 * móvil boliviano salen a internet por el mismo CGNAT y comparten una única IP pública, así
 * que el cupo de esa IP se agota entre todos aunque cada dispositivo individual esté muy por
 * debajo de cualquier límite razonable. El resultado es 429 para choferes que no hicieron
 * nada mal, justo cuando más vehículos hay en la calle (más chances de compartir CGNAT).
 *
 * La clave correcta acá es el dispositivo autenticado (`sesionMovil.deviceId`, resuelto por
 * `AuthMovilGuard`), no la IP: cada teléfono tiene su propio cupo, sin importar cuántos otros
 * choferes compartan su NAT. Fallback a `req.ip` si `sesionMovil` no está seteado — no
 * debería pasar en la práctica (`AuthMovilGuard` corre antes que este guard en
 * `SyncController.recibirLote` y ya habría cortado con 401 sin sesión válida), pero así una
 * request sin sesión nunca queda CON CERO límite.
 *
 * Orden de guards: en Nest, los guards se resuelven [globales] + [de clase] + [de método], en
 * ese orden — el `ThrottlerGuard` global (registrado como `APP_GUARD`) corre SIEMPRE antes
 * que cualquier guard de ruta. Este guard debe ir DESPUÉS de `AuthMovilGuard` en el
 * `@UseGuards(...)` de la ruta (mismo array, mismo nivel — ahí sí importa el orden) para que
 * `request.sesionMovil` ya exista cuando `getTracker` lo lee. Si se pusiera antes, siempre
 * caería al fallback de IP y este guard no serviría de nada.
 *
 * Nombre de throttler propio ('device', no 'default'): `recibirLote` lleva `@SkipThrottle()`
 * para apagar el guard GLOBAL (nombre 'default') en esta ruta — si no, el 100/60 por IP se
 * seguiría aplicando ADEMÁS de este, y el cupo compartido por IP volvería a reventar en el
 * mismo escenario de CGNAT que se está arreglando. `@SkipThrottle()` apaga a CUALQUIER guard
 * que consulte el nombre 'default' en esa ruta (la metadata de skip se indexa por nombre de
 * throttler, no por clase de guard) — si este guard también usara 'default' se apagaría a sí
 * mismo. Por eso recibe su config de throttlers directo en el constructor (no inyectada desde
 * `ThrottlerModule.forRoot()` de `app.module.ts`), con nombre 'device': queda desacoplada del
 * guard global y no afecta ninguna otra ruta de la API.
 *
 * Storage en memoria por instancia: `ThrottlerStorage` (inyectado acá, el mismo que usa el
 * guard global) vive en el heap del proceso Node — con N instancias de Cloud Run detrás del
 * balanceador, cada una lleva su propio contador y el límite EFECTIVO total es N×60 req/min,
 * no 60/min duro. Aceptable para este caso (el objetivo es amortiguar el CGNAT compartido, no
 * fijar un techo exacto), pero que quede escrito para que nadie lo lea como una garantía dura.
 */
@Injectable()
export class SyncDeviceThrottlerGuard extends ThrottlerGuard {
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
