import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import { completadosTrasDeteccion, proximoPuntoControlPendiente } from './proximo-punto-control';

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

describe('completadosTrasDeteccion (plan §2.5, reset del próximo punto por vuelta)', () => {
  it('agrega el punto detectado sin reiniciar mientras falten puntos de la ruta', () => {
    const resultado = completadosTrasDeteccion(new Set(['a']), 'b', 3);
    expect(resultado).toEqual(new Set(['a', 'b']));
  });

  it('reinicia a un Set vacío cuando la detección completa TODOS los puntos de la ruta', () => {
    const resultado = completadosTrasDeteccion(new Set(['a', 'b']), 'c', 3);
    expect(resultado).toEqual(new Set());
  });

  it('permite que la vuelta siguiente vuelva a apuntar al primer punto por orden', () => {
    const puntos = [puntoControl('a', 0), puntoControl('b', 1), puntoControl('c', 2)];
    let completados = new Set<string>();
    completados = completadosTrasDeteccion(completados, 'a', puntos.length);
    completados = completadosTrasDeteccion(completados, 'b', puntos.length);
    // Cierra la vuelta 1 (los 3 puntos vistos) — antes de este fix, `completados` seguía
    // creciendo y el próximo punto quedaba `null` el resto del día.
    completados = completadosTrasDeteccion(completados, 'c', puntos.length);
    expect(completados.size).toBe(0);
    expect(proximoPuntoControlPendiente(puntos, completados)?.id).toBe('a');

    // Vuelta 2 en curso: el primer punto de la vuelta nueva vuelve a apuntar a "b".
    completados = completadosTrasDeteccion(completados, 'a', puntos.length);
    expect(proximoPuntoControlPendiente(puntos, completados)?.id).toBe('b');
  });

  it('no reinicia con una ruta vacía (0 puntos de control)', () => {
    const resultado = completadosTrasDeteccion(new Set(), 'a', 0);
    expect(resultado).toEqual(new Set(['a']));
  });

  it('no muta el Set recibido (pureza)', () => {
    const original = new Set(['a']);
    completadosTrasDeteccion(original, 'b', 5);
    expect(original).toEqual(new Set(['a']));
  });
});
