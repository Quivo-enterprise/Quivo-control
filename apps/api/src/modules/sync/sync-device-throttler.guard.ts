import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerStorage,
} from '@nestjs/throttler';
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
 * choferes compartan su NAT. Fallback a `req.ip` si `sesionMovil` no está seteado — pero OJO,
 * este fallback es un cinturón defensivo que en la práctica NUNCA se ejecuta: `AuthMovilGuard`
 * corre antes que este guard en `SyncController.recibirLote` y corta con 401 antes de llegar
 * acá si no hay sesión válida, así que `req.sesionMovil` siempre está seteado cuando
 * `getTracker` lee. Por lo mismo, este fallback NO protege al tráfico sin sesión — ese
 * tráfico nunca llega a instanciar este guard (código sale por el 401 de `AuthMovilGuard`
 * antes de que Nest siga con el resto del array de guards). Quien de verdad acota el costo
 * de ese tráfico es `AuthMovilGuard` (`auth-movil.guard.ts`, docblock de `canActivate` —
 * caché negativa por TOKEN agregada en QUI-240 code-review, tercera vuelta, tras descartar
 * dos diseños por IP que terminaban castigando a choferes con credencial válida que
 * compartían CGNAT con un teléfono en bucle de reintentos). A propósito NO es un bloqueo por
 * IP corriendo antes que `AuthMovilGuard`: eso contaría también el tráfico autenticado
 * legítimo contra un cupo compartido por IP y reintroduciría el mismo reventón de CGNAT que
 * este guard existe para evitar.
 *
 * Orden de guards: en Nest, los guards se resuelven [globales] + [de clase] + [de método], en
 * ese orden — el `ThrottlerGuard` global (registrado como `APP_GUARD`) corre SIEMPRE antes
 * que cualquier guard de ruta. Este guard debe ir DESPUÉS de `AuthMovilGuard` en el
 * `@UseGuards(...)` de la ruta (mismo array, mismo nivel — ahí sí importa el orden) para que
 * `request.sesionMovil` ya exista cuando `getTracker` lo lee. Si se pusiera antes, siempre
 * caería al fallback de IP y este guard no serviría de nada.
 *
 * Nombre de throttler propio ('device', no 'default'): la metadata de `@Throttle`/`@SkipThrottle`
 * se indexa por nombre, no por clase de guard. El guard global lee 'default' (100/min por IP
 * por defecto; las rutas móviles lo suben a `LIMITE_IP_MOVIL` vía `@LimitePorDispositivo`, que
 * NO lo apaga: sigue siendo el único tope previo a `AuthMovilGuard`) y este lee 'device' (límite
 * por ruta). Recibe su config directo en el constructor (no de `ThrottlerModule.forRoot()`),
 * así queda desacoplado del guard global y no afecta ninguna otra ruta de la API.
 *
 * Storage en memoria por instancia: `ThrottlerStorage` (inyectado acá, el mismo que usa el
 * guard global) vive en el heap del proceso Node — con N instancias de Cloud Run detrás del
 * balanceador, cada una lleva su propio contador y el límite EFECTIVO total es N× el límite de
 * la ruta (`@LimitePorDispositivo`), no un tope duro. Aceptable para este caso (el objetivo es
 * amortiguar el CGNAT compartido, no fijar un techo exacto), pero que quede escrito para que
 * nadie lo lea como una garantía dura.
 *
 * shortcut: límite por instancia (N× con N instancias), pasar a Redis si se sube max-instances
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

  // Con throttler nombrado la base emite `Retry-After-device`; el estándar es `Retry-After`.
  protected async throwThrottlingException(
    context: ExecutionContext,
    detalle: ThrottlerLimitDetail,
  ): Promise<void> {
    this.getRequestResponse(context).res.header('Retry-After', detalle.timeToBlockExpire);
    return super.throwThrottlingException(context, detalle);
  }
}
