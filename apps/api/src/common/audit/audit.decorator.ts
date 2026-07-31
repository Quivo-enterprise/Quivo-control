import { SetMetadata } from '@nestjs/common';

export const AUDIT_ENTIDAD_KEY = 'audit:entidad';

/** Marca un handler de controller para que `AuditInterceptor` registre la acción en
 * `audit_log` — sin este decorador, la request pasa sin auditar (los `GET` nunca lo llevan). */
export const Auditable = (entidad: string): MethodDecorator => SetMetadata(AUDIT_ENTIDAD_KEY, entidad);
