import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { LockoutMovilException } from './auth-movil.exceptions.js';

/**
 * Nest no traduce automáticamente el cuerpo de una `HttpException` en headers HTTP: sin
 * este filtro, `Retry-After` nunca llegaría al cliente aunque `retryAfterSeconds` sí vaya
 * en el JSON. Scoped a `POST /mobile/auth/sesion` (`@UseFilters` en el controller), no
 * global — es el único endpoint con esta semántica de retry.
 */
@Catch(LockoutMovilException)
export class LockoutMovilExceptionFilter implements ExceptionFilter {
  catch(exception: LockoutMovilException, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .header('Retry-After', String(exception.retryAfterSeconds))
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .send({ retryAfterSeconds: exception.retryAfterSeconds });
  }
}
