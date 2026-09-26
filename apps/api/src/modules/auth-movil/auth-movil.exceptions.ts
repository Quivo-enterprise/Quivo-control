import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { CODIGO_SESION_NO_VIGENTE } from '@quivo/shared';

/**
 * 429 del login móvil de un paso: lockout progresivo POR VEHÍCULO (nunca por IP, ver
 * `auth-movil.service.ts`). `retryAfterSeconds` viaja tanto en el cuerpo como en el header
 * `Retry-After` (agregado por `LockoutMovilExceptionFilter`).
 */
export class LockoutMovilException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super({ retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Entrega 28 (`docs/plan-correccion-post-piloto-2026-09-09.md`, causa raíz del
 * `refresh-agotado` de Sentry `QUIVO-CONTROL-CONDUCTOR-2`): `AuthMovilService.refresh` la
 * lanza en vez del `UnauthorizedException` genérico cuando la sesión asociada al
 * `refreshToken` recibido YA NO ES VIGENTE — no existe (hash desconocido/ya rotado por otra
 * sesión), está revocada/cerrada, o venció. Sigue siendo HTTP 401 (esta clase EXTIENDE
 * `UnauthorizedException`, no la reemplaza — `instanceof UnauthorizedException` sigue dando
 * `true`, así que ningún test/guard existente que dependa de eso se rompe) y el body sigue
 * teniendo el MISMO `message` que antes — sólo se agrega el campo `codigo`, que un cliente
 * viejo simplemente ignora. No filtra más de lo que el 401 genérico ya filtraba: las cuatro
 * causas (token desconocido, revocado, cerrado, vencido) ya eran indistinguibles entre sí
 * antes de este cambio, así que agruparlas bajo un único código no abre ninguna distinción
 * nueva observable por un atacante — sólo por el cliente legítimo, que ya demostró posesión
 * de un `refreshToken` que en algún momento fue real (si no lo fuera, el `findUnique` por
 * hash de `refresh()` ya habría devuelto `null` de la misma forma).
 */
export class SesionNoVigenteException extends UnauthorizedException {
  constructor() {
    super({
      statusCode: HttpStatus.UNAUTHORIZED,
      message: 'Sesión móvil inválida o expirada',
      error: 'Unauthorized',
      codigo: CODIGO_SESION_NO_VIGENTE,
    });
  }
}
