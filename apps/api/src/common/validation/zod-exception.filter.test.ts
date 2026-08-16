import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodExceptionFilter } from './zod-exception.filter.js';

function crearHostFalso(reply: { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }) {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ method: 'GET', url: '/v1/vehiculos' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('ZodExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('convierte un ZodError sin capturar en 422 con el detalle de campos, sin exponer el mensaje crudo de Zod', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filtro = new ZodExceptionFilter();
    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const host = crearHostFalso({ status, send });

    const schema = z.object({ color: z.enum(['blanco', 'negro']) });
    const resultado = schema.safeParse({ color: 'PLACEHOLDER' });
    if (resultado.success) throw new Error('el fixture debería fallar la validación');

    filtro.catch(resultado.error, host);

    expect(status).toHaveBeenCalledWith(422);
    const cuerpo = send.mock.calls[0]?.[0];
    expect(cuerpo.statusCode).toBe(422);
    expect(cuerpo.camposInvalidos).toEqual([{ campo: 'color', tipo: 'invalid_enum_value' }]);
    // El valor recibido ('PLACEHOLDER') y el mensaje crudo de Zod no deben viajar al cliente.
    expect(JSON.stringify(cuerpo)).not.toContain('PLACEHOLDER');
  });

  it('loguea el detalle completo (incluye la ruta y el request) aunque el cliente reciba una versión resumida', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filtro = new ZodExceptionFilter();
    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const host = crearHostFalso({ status, send });

    const schema = z.object({ color: z.enum(['blanco', 'negro']) });
    const resultado = schema.safeParse({ color: 'PLACEHOLDER' });
    if (resultado.success) throw new Error('el fixture debería fallar la validación');

    filtro.catch(resultado.error, host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const mensajeLogueado = errorSpy.mock.calls[0]?.[0] as string;
    expect(mensajeLogueado).toContain('/v1/vehiculos');
    expect(mensajeLogueado).toContain('color');
  });
});
