import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import type { ZodDto } from './zod-dto.js';

/**
 * Pipe global (registrado vía APP_PIPE en AppModule): si el `metatype` del parámetro es
 * un DTO creado con `createZodDto`, valida `value` contra su schema Zod y lanza 400 con
 * los issues de Zod si falla. Si no hay schema asociado, deja pasar el valor sin tocar.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype as unknown as ZodDto | undefined;
    const schema: ZodSchema | undefined = metatype?.schema;

    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }

    return result.data;
  }
}
