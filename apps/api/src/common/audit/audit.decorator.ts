import { applyDecorators, SetMetadata } from '@nestjs/common';

export const AUDIT_ENTIDAD_KEY = 'audit:entidad';
export const AUDIT_ACCION_KEY = 'audit:accion';

/**
 * Marca un handler de controller para que `AuditInterceptor` registre la acción en
 * `audit_log` — sin este decorador, la request pasa sin auditar (los `GET` nunca lo llevan).
 *
 * Por defecto la acción se infiere del método HTTP (`crear`/`editar`/`anular`, ver
 * `ACCION_POR_METODO` en el interceptor) — alcanza para el CRUD estándar de QUI-220..226.
 * `accion` opcional pisa esa inferencia para endpoints `POST` que no son un alta (QUI-232:
 * `publicar`/`anular` de una rotación son ambos `POST` por contrato de API, pero no son
 * "crear" — sin este override quedarían mal etiquetados en el log de auditoría).
 */
export const Auditable = (entidad: string, accion?: string): MethodDecorator =>
  accion
    ? applyDecorators(SetMetadata(AUDIT_ENTIDAD_KEY, entidad), SetMetadata(AUDIT_ACCION_KEY, accion))
    : SetMetadata(AUDIT_ENTIDAD_KEY, entidad);
