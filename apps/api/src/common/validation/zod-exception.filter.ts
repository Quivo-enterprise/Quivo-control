import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Red de seguridad global (QUI-366): si un `ZodError` sin capturar llega hasta acá —
 * por ejemplo un `.parse()` sobre una fila de la base en un handler que no lo esperaba,
 * fuera del `.map()` de un listado que ya se blindó con `mapearTolerante` — Nest lo trata
 * como excepción no reconocida y responde el 500 genérico `{"statusCode":500,"message":
 * "Internal server error"}`, sin ninguna pista de qué pasó. Esto lo intercepta y devuelve
 * un status que dice la verdad, con un cuerpo diagnosticable.
 *
 * 422 y no 400: `ZodValidationPipe` (registrado como APP_PIPE) ya usa 400 para "el body/
 * query que mandó el cliente no cumple el schema" — eso es un error del REQUEST. Un
 * ZodError que llega hasta este filtro global es otra cosa: datos que ya estaban
 * persistidos (o derivados de ellos) y no cumplen el schema al leerlos/procesarlos — el
 * request en sí pudo ser perfectamente válido. Separar el status deja ambas causas
 * distinguibles en logs/alertas/dashboards en vez de mezclarlas bajo el mismo 400.
 *
 * El detalle completo de los issues de Zod (incluye valores recibidos, que pueden ser
 * datos de negocio) va SOLO al log. Al cliente le llega la lista de campos que fallaron
 * y el código de issue de Zod, sin los mensajes/valores crudos — suficiente para
 * diagnosticar desde el panel sin filtrar contenido de la fila.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ZodExceptionFilter.name);

  catch(exception: ZodError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const detalle = exception.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('; ');
    this.logger.error(
      `ZodError sin capturar en ${request.method} ${request.url}: ${detalle}`,
      exception.stack,
    );

    reply.status(HttpStatus.UNPROCESSABLE_ENTITY).send({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Los datos no cumplen el formato esperado.',
      camposInvalidos: exception.issues.map((issue) => ({
        campo: issue.path.join('.') || null,
        tipo: issue.code,
      })),
    });
  }
}
