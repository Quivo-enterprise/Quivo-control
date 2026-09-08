import { HttpException, HttpStatus } from '@nestjs/common';

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
