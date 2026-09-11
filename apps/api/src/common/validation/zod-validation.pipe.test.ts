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

  /**
   * Regresión (auditoría post-piloto 2026-09-09, docs/plan-correccion-post-piloto-2026-09-09.md):
   * se investigó un supuesto 500 en `GET /v1/sync-errores?desde=...` con causa reportada
   * "el pipe no devuelve el `.data` parseado de Zod, llega el string crudo". Repro completa
   * contra un build real (`tsc` + `node dist/main.js`, igual que el Dockerfile de prod) no
   * reprodujo el 500: el pipe SÍ devuelve `result.data` (línea de abajo) y Nest sí resuelve
   * el `metatype` del DTO en `@Query()`. Este test fija en piedra, a nivel unitario, la
   * garantía que hace que ese mecanismo funcione: el string crudo de una querystring
   * (`z.coerce.date()`) llega al handler como `Date` real, no como string — exactamente el
   * síntoma que se reportó y que acá se demuestra que NO ocurre con el pipe actual. Ver los
   * tests de integración `sync-errores.controller.integration.test.ts` y
   * `auditoria.controller.integration.test.ts` para la prueba end-to-end (DTO real + guards +
   * Postgres real).
   */
  it('coerciona strings de querystring a Date real (z.coerce.date()) en vez de dejar el string crudo', () => {
    const querySchema = z.object({ desde: z.coerce.date().optional() });
    class QueryDto extends createZodDto(querySchema) {}

    const value = pipe.transform(
      { desde: '2026-09-03T15:20:44.583Z' },
      { type: 'query', metatype: QueryDto, data: undefined },
    ) as { desde?: Date };

    expect(value.desde).toBeInstanceOf(Date);
    expect(value.desde?.getUTCFullYear()).toBe(2026);
    expect(value.desde?.toISOString()).toBe('2026-09-03T15:20:44.583Z');
  });
});
