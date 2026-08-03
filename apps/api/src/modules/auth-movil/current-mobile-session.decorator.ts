import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

export const CurrentMobileSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SesionMovilAutenticada => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { sesionMovil: SesionMovilAutenticada }>();
    return request.sesionMovil;
  },
);
