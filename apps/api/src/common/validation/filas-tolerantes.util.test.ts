import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapearTolerante } from './filas-tolerantes.util.js';

describe('mapearTolerante', () => {
  const schema = z.object({ id: z.string(), nombre: z.string().min(1) });
  const mapear = (fila: { id: string; nombre: string }) => schema.parse(fila);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('devuelve todas las filas cuando todas pasan el schema (sin regresión)', () => {
    const filas = [
      { id: '1', nombre: 'A' },
      { id: '2', nombre: 'B' },
    ];
    const resultado = mapearTolerante(filas, mapear, new Logger('test'), 'Fila');
    expect(resultado).toEqual(filas);
  });

  it('omite la fila que no pasa el schema y conserva las válidas', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filas = [
      { id: '1', nombre: 'A' },
      { id: '2', nombre: '' }, // inválida: min(1)
      { id: '3', nombre: 'C' },
    ];

    const resultado = mapearTolerante(filas, mapear, new Logger('test'), 'Fila');

    expect(resultado).toEqual([
      { id: '1', nombre: 'A' },
      { id: '3', nombre: 'C' },
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('2');
    expect(errorSpy.mock.calls[0]?.[0]).toContain('nombre');
  });

  it('re-lanza cualquier error que no sea ZodError (no lo confunde con una fila corrupta)', () => {
    const explota = () => {
      throw new Error('boom');
    };
    expect(() =>
      mapearTolerante([{ id: '1', nombre: 'A' }], explota, new Logger('test'), 'Fila'),
    ).toThrow('boom');
  });
});
