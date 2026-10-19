import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthMovilGuard } from './auth-movil.guard.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';

/**
 * Tope por IP de las rutas móviles autenticadas: holgado a propósito (CGNAT: decenas de teléfonos
 * comparten una IP pública) pero no infinito — es el único freno al flood de Bearer aleatorios
 * (cada uno cuesta SHA-256 + lookup en DB) porque el límite por dispositivo corre DESPUÉS de
 * `AuthMovilGuard`. Se cuenta POR RUTA, por IP y por instancia (la key del throttler hashea
 * clase+handler). Dimensionado para la ruta más pesada: sync ≤ 20 req/min por teléfono × 60
 * teléfonos = 1.200/min, con margen.
 */
export const LIMITE_IP_MOVIL = { limit: 3000, ttl: 60_000 } as const;

/**
 * Límite por dispositivo (`limitePorMinuto`) para una ruta móvil autenticada, más el tope por IP
 * holgado `LIMITE_IP_MOVIL`. Los dos guards leen nombres de throttler distintos: el global
 * (`APP_GUARD`, siempre primero) lee `default` → el tope por IP; `SyncDeviceThrottlerGuard` lee
 * `device`, con clave = deviceId. Orden fijo `AuthMovilGuard` → `SyncDeviceThrottlerGuard`: el
 * segundo necesita `req.sesionMovil` ya seteado. No usar `@SkipThrottle()` en estas rutas.
 */
export const LimitePorDispositivo = (limitePorMinuto: number): MethodDecorator =>
  applyDecorators(
    Throttle({ default: LIMITE_IP_MOVIL, device: { limit: limitePorMinuto, ttl: 60_000 } }),
    UseGuards(AuthMovilGuard, SyncDeviceThrottlerGuard),
  );
