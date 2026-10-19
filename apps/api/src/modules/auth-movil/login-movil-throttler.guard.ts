import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import { normalizarPlacaVehiculo, PlacaVehiculoSchema } from '@quivo/shared';
import { RetryAfterThrottlerGuard } from './dispositivo-throttler.guard.js';

// Firma que exige `ThrottlerGetTrackerFunction` (`Record<string, any>`); se afina adentro.
type Req = Record<string, unknown>;

function ip(req: Req): string {
  return req['ip'] as string;
}

function campoDelBody(req: Req, campo: string): string | null {
  const body = req['body'];
  if (typeof body !== 'object' || body === null) return null;
  const valor = (body as Record<string, unknown>)[campo];
  return typeof valor === 'string' ? valor : null;
}

/** `ip` + placa normalizada con el MISMO schema/normalizador que el request, así mayúsculas,
 * espacios o guiones no abren cubos nuevos. */
function claveMovil(req: Req): string {
  const placa = PlacaVehiculoSchema.safeParse(campoDelBody(req, 'placa'));
  return placa.success ? `${ip(req)}|${normalizarPlacaVehiculo(placa.data)}` : ip(req);
}

const TTL = 60_000;

/**
 * Throttle de los logins con credencial (`POST /mobile/auth/sesion`) en DOS cubos
 * de 60 s: `cuenta` (ip + placa normalizada, estricto: frena el adivinar un
 * PIN) e `ip` (solo ip, holgado). Con una sola key por IP, 30 choferes que entran a
 * turno detrás de la misma IP pública (CGNAT, WiFi de la parada) agotaban el cupo de 5 y el
 * 6.º recibía 429 sin reintento.
 *
 * Bypass del guard global (`APP_GUARD`, que corre primero): el controller lleva
 * `@SkipThrottle()` (salta solo el throttler 'default'); estos dos nombres no son 'default'
 * así que siguen activos acá. Los límites viven SOLO en el constructor de abajo.
 *
 * Los guards corren antes que los pipes: el body es crudo, se lee de forma defensiva y, si la
 * clave de cuenta no se puede derivar (inválida/ausente), el cubo `cuenta` cae a solo la IP.
 *
 * shortcut: storage en memoria por instancia (máx 3×), pasar a Redis si se sube max-instances
 */
@Injectable()
export class LoginMovilThrottlerGuard extends RetryAfterThrottlerGuard {
  // `@Inject(Reflector)` explícito: ver `dispositivo-throttler.guard.ts` (bug tsx/esbuild#257).
  constructor(
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(
      [
        { name: 'cuenta', ttl: TTL, limit: 5, getTracker: claveMovil },
        { name: 'ip', ttl: TTL, limit: 60, getTracker: ip },
      ],
      storageService,
      reflector,
    );
  }
}
