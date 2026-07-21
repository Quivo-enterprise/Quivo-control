import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createZodDto } from './zod-dto.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const schema = z.object({ nombre: z.string().min(1) });
  class DemoDto extends createZodDto(schema) {}
  const pipe = new ZodValidationPipe();

  it('deja pasar el valor sin schema asociado (metatype nativo, ej. String)', () => {
    const value = pipe.transform('hola', { type: 'param', metatype: String, data: 'x' });
    expect(value).toBe('hola');
  });

  it('valida y transforma cuando el metatype trae schema Zod', () => {
    const value = pipe.transform(
      { nombre: 'Sindicato Central' },
      { type: 'body', metatype: DemoDto, data: undefined },
    );
    expect(value).toEqual({ nombre: 'Sindicato Central' });
  });

  it('lanza BadRequestException cuando el body no cumple el schema', () => {
    expect(() =>
      pipe.transform({ nombre: '' }, { type: 'body', metatype: DemoDto, data: undefined }),
    ).toThrow();
  });
});
