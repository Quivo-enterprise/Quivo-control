import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import {
  derivarProgreso,
  estadoInicialVuelta,
  pasoPunto,
  type EstadoProgresoVuelta,
} from './progreso-vuelta';

function punto(id: string, orden: number, lng = 0, lat = 0): PuntoControlPaquete {
  return {
    id,
    orden,
    coord: { type: 'Point', coordinates: [lng, lat] },
    radioToleranciaM: 30,
    obligatorio: true,
  };
}

const ruta = ['a', 'b', 'c', 'd', 'e'].map((id, i) => punto(id, i));

function pasar(estado: EstadoProgresoVuelta, ids: string[], total = ruta.length) {
  return ids.reduce(
    (acc, id, i) => pasoPunto(acc, { puntoId: id, clave: `${id}:${acc.procesados.length}:${i}` }, total),
    estado,
  );
}

const estadosDe = (e: EstadoProgresoVuelta, pos: { lat: number; lng: number } | null = null) =>
  derivarProgreso(e, ruta, pos).puntos.map((p) => `${p.punto.id}=${p.estado}`);

describe('pasoPunto', () => {
  it('el primer punto pasado es el inicio de la vuelta', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c']);
    expect(e.inicioId).toBe('c');
    expect(e.pasados).toEqual(['c']);
  });

  it('acepta cualquier orden y no duplica un punto ya pasado', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c', 'e', 'd', 'e']);
    expect(e.pasados).toEqual(['c', 'e', 'd']);
    expect(e.vueltasCompletadas).toBe(0);
  });

  it('cierra la vuelta al volver al punto de inicio y arranca la nueva con él ya pasado', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c', 'd', 'e', 'c']);
    expect(e.vueltasCompletadas).toBe(1);
    expect(e.pasados).toEqual(['c']);
    expect(e.ultimaVueltaResumen).toEqual({ numero: 1, pasados: 3, total: 5 });
  });

  it('pasar de nuevo el inicio sin haber pasado nada más no cuenta vuelta', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c', 'c']);
    expect(e.vueltasCompletadas).toBe(0);
    expect(e.pasados).toEqual(['c']);
  });

  it('ignora una clave ya procesada (idempotencia)', () => {
    const base = pasoPunto(estadoInicialVuelta('s1'), { puntoId: 'a', clave: 'k1' }, 5);
    const sinCambio = pasoPunto(base, { puntoId: 'a', clave: 'k1' }, 5);
    expect(sinCambio).toBe(base);
    const dosVeces = pasoPunto(
      pasoPunto(base, { puntoId: 'b', clave: 'k2' }, 5),
      { puntoId: 'a', clave: 'k1' },
      5,
    );
    expect(dosVeces.vueltasCompletadas).toBe(0);
  });

  it('acota las claves recordadas', () => {
    let e = estadoInicialVuelta('s1');
    for (let i = 0; i < 300; i++) e = pasoPunto(e, { puntoId: 'a', clave: `k${i}` }, 5);
    expect(e.procesados).toHaveLength(200);
    expect(e.procesados.at(-1)).toBe('k299');
  });

  it('cuenta varias vueltas', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['a', 'b', 'a', 'c', 'a']);
    expect(e.vueltasCompletadas).toBe(2);
    expect(e.ultimaVueltaResumen?.numero).toBe(2);
  });
});

describe('derivarProgreso', () => {
  it('sin pasos: todo pendiente y próximo = el más cercano a la posición', () => {
    const cercanos = ['a', 'b', 'c'].map((id, i) => punto(id, i, i * 0.01, 0));
    const d = derivarProgreso(estadoInicialVuelta('s'), cercanos, { lat: 0, lng: 0.0199 });
    expect(d.proximo?.id).toBe('c');
    expect(d.puntos.map((p) => p.estado)).toEqual(['pendiente', 'pendiente', 'proximo']);
  });

  it('sin pasos y sin posición: próximo = menor orden', () => {
    expect(derivarProgreso(estadoInicialVuelta('s'), ruta, null).proximo?.id).toBe('a');
  });

  it('arrancar a mitad de ruta (#c primero) rota el orden y el próximo es el siguiente circular', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c']);
    const d = derivarProgreso(e, ruta, null);
    expect(d.puntos.map((p) => p.punto.id)).toEqual(['c', 'd', 'e', 'a', 'b']);
    expect(d.proximo?.id).toBe('d');
    expect(d.vueltaActual).toBe(1);
  });

  it('puntos fuera de orden: los saltados quedan omitidos (rojo) y el próximo sigue al más lejano', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'd']);
    expect(estadosDe(e)).toEqual([
      'a=pasado',
      'b=omitido',
      'c=omitido',
      'd=pasado',
      'e=proximo',
    ]);
    const d = derivarProgreso(e, ruta, null);
    expect(d.omitidos).toBe(2);
    expect(d.pasados).toBe(2);
  });

  it('pasar luego un omitido lo marca pasado sin mover el próximo', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'd', 'b']);
    expect(estadosDe(e)).toEqual([
      'a=pasado',
      'b=pasado',
      'c=omitido',
      'd=pasado',
      'e=proximo',
    ]);
  });

  it('si no queda nada adelante, el próximo es el punto de inicio (cierra la vuelta)', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'e', 'a', 'b']);
    const d = derivarProgreso(e, ruta, null);
    expect(d.proximo?.id).toBe('c');
    expect(d.puntos[0]?.estado).toBe('proximo');
    expect(d.pasados).toBe(5);
    expect(d.omitidos).toBe(0);
  });

  it('tras cerrar la vuelta, la nueva arranca con el inicio ya pasado', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'e', 'c']);
    const d = derivarProgreso(e, ruta, null);
    expect(d.vueltaActual).toBe(2);
    expect(d.pasados).toBe(1);
    expect(d.proximo?.id).toBe('d');
  });

  it('lista vacía', () => {
    const d = derivarProgreso(estadoInicialVuelta('s'), [], null);
    expect(d.proximo).toBeNull();
    expect(d.puntos).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('inicio que ya no está en la ruta (paquete refrescado) cae al modo sin inicio', () => {
    const e = pasar(estadoInicialVuelta('s'), ['zzz']);
    expect(derivarProgreso(e, ruta, null).proximo?.id).toBe('a');
  });
});
