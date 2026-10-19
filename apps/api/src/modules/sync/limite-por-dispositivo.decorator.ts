import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';

/**
 * Tope por IP de las rutas móviles autenticadas: holgado a propósito (CGNAT de operadores
 * móviles: decenas de teléfonos comparten una IP pública, ver `sync-device-throttler.guard.ts`)
 * pero no infinito — es el único freno al flood de Bearer aleatorios (cada uno cuesta SHA-256 +
 * lookup en DB) porque el límite por dispositivo corre DESPUÉS de `AuthMovilGuard`.
 */
// 60 teléfonos × ~30 req/min = 1.800/min tras un CGNAT + margen; solo frena el flood de tokens aleatorios previo al login.
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
