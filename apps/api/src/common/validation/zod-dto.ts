import type { ZodSchema } from 'zod';

/**
 * Envuelve un schema Zod en una "clase DTO" para que NestJS la reconozca como `metatype`
 * de un parámetro (`@Body()`, `@Query()`, ...). `ZodValidationPipe` la detecta y valida
 * contra el schema real — así los contratos de `@quivo/shared` se usan directo, sin
 * reescribir validación en class-validator.
 */
export interface ZodDto<T = unknown> {
  new (): T;
  schema: ZodSchema<T>;
}

export function createZodDto<T>(schema: ZodSchema<T>): ZodDto<T> {
  class SchemaHolder {
    static readonly schema = schema;
  }
  return SchemaHolder as unknown as ZodDto<T>;
}
