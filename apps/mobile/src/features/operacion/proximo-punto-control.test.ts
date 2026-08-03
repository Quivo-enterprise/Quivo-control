import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import { proximoPuntoControlPendiente } from './proximo-punto-control';

function puntoControl(id: string, orden: number): PuntoControlPaquete {
  return {
    id,
    orden,
    coord: { type: 'Point', coordinates: [0, 0] },
    radioToleranciaM: 30,
    obligatorio: true,
  };
}

describe('proximoPuntoControlPendiente', () => {
  it('devuelve el primero por orden cuando ninguno está completado', () => {
    const puntos = [puntoControl('b', 1), puntoControl('a', 0), puntoControl('c', 2)];
    expect(proximoPuntoControlPendiente(puntos, new Set())?.id).toBe('a');
  });

  it('salta los ya completados y devuelve el siguiente pendiente', () => {
    const puntos = [puntoControl('a', 0), puntoControl('b', 1), puntoControl('c', 2)];
    expect(proximoPuntoControlPendiente(puntos, new Set(['a']))?.id).toBe('b');
  });

  it('devuelve null cuando todos están completados', () => {
    const puntos = [puntoControl('a', 0), puntoControl('b', 1)];
    expect(proximoPuntoControlPendiente(puntos, new Set(['a', 'b']))).toBeNull();
  });

  it('devuelve null con una lista vacía de puntos de control', () => {
    expect(proximoPuntoControlPendiente([], new Set())).toBeNull();
  });
});
