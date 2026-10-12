import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import {
  claveProgresoVuelta,
  derivarProgreso,
  estadoInicialVuelta,
  fechaLocal,
  normalizarEstado,
  pasoPunto,
  reiniciarVuelta,
  separarClaveProgreso,
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
const ids = ruta.map((p) => p.id);

function pasar(estado: EstadoProgresoVuelta, pasos: string[], vigentes: readonly string[] = ids) {
  return pasos.reduce(
    (acc, id, i) => pasoPunto(acc, { puntoId: id, clave: `${id}:${acc.procesados.length}:${i}` }, vigentes),
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
    const base = pasoPunto(estadoInicialVuelta('s1'), { puntoId: 'a', clave: 'k1' }, ids);
    const sinCambio = pasoPunto(base, { puntoId: 'a', clave: 'k1' }, ids);
    expect(sinCambio).toBe(base);
    const dosVeces = pasoPunto(
      pasoPunto(base, { puntoId: 'b', clave: 'k2' }, ids),
      { puntoId: 'a', clave: 'k1' },
      ids,
    );
    expect(dosVeces.vueltasCompletadas).toBe(0);
  });

  it('acota las claves recordadas', () => {
    let e = estadoInicialVuelta('s1');
    for (let i = 0; i < 300; i++) e = pasoPunto(e, { puntoId: 'a', clave: `k${i}` }, ids);
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

  it('puntos fuera de orden: los saltados quedan omitidos (rojo) y el próximo sigue al último pasado', () => {
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

  it('pasar luego un omitido re-ancla el próximo al último pasado (c deja de ser rojo)', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'd', 'b']);
    expect(estadosDe(e)).toEqual([
      'a=pasado',
      'b=pasado',
      'c=proximo',
      'd=pasado',
      'e=pendiente',
    ]);
  });

  it('autocorrección: un paso espurio adelantado se corrige al pasar el punto real', () => {
    const larga = ['1', '2', '3', '4', '5', '6', '7', '8'].map((id, i) => punto(id, i));
    const idsLarga = larga.map((p) => p.id);
    const estadosLarga = (e: EstadoProgresoVuelta) =>
      derivarProgreso(e, larga, null).puntos.map((p) => `${p.punto.id}=${p.estado}`);
    const espurio = pasar(estadoInicialVuelta('s'), ['1', '2', '8'], idsLarga);
    expect(estadosLarga(espurio).filter((x) => x.endsWith('omitido'))).toHaveLength(5);
    const corregido = pasar(espurio, ['3'], idsLarga);
    const d = derivarProgreso(corregido, larga, null);
    expect(d.omitidos).toBe(0);
    expect(d.proximo?.id).toBe('4');
    expect(estadosLarga(corregido)).toEqual([
      '1=pasado',
      '2=pasado',
      '3=pasado',
      '4=proximo',
      '5=pendiente',
      '6=pendiente',
      '7=pendiente',
      '8=pasado',
    ]);
  });

  it('si el último pasado es el inicio (vuelta recién cerrada) no hay omitidos', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'e', 'c']);
    expect(derivarProgreso(e, ruta, null).omitidos).toBe(0);
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

describe('robustez ante puntos quitados del paquete', () => {
  it('normalizarEstado re-ancla el inicio al primer pasado vigente y el último al último vigente', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'e']);
    const n = normalizarEstado(e, ['a', 'b', 'd', 'e']);
    expect(n.pasados).toEqual(['d', 'e']);
    expect(n.inicioId).toBe('d');
    expect(n.ultimoId).toBe('e');
  });

  it('sin pasados vigentes, inicio y último quedan en null', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c']);
    const n = normalizarEstado(e, ['a', 'b']);
    expect(n.inicioId).toBeNull();
    expect(n.ultimoId).toBeNull();
    expect(n.pasados).toEqual([]);
  });

  it('devuelve el mismo objeto si no hay nada que ajustar', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd']);
    expect(normalizarEstado(e, ids)).toBe(e);
  });

  it('derivarProgreso con el inicio quitado re-ancla y no se cae', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'e']);
    const sinC = ruta.filter((p) => p.id !== 'c');
    const d = derivarProgreso(e, sinC, null);
    expect(d.puntos.map((p) => p.punto.id)).toEqual(['d', 'e', 'a', 'b']);
    expect(d.pasados).toBe(2);
    expect(d.proximo?.id).toBe('a');
    expect(d.total).toBe(4);
  });

  it('pasoPunto con el inicio quitado no cierra una vuelta fantasma y re-ancla', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd']);
    const vigentes = ['a', 'b', 'd', 'e'];
    const n = pasoPunto(e, { puntoId: 'e', clave: 'k-e' }, vigentes);
    expect(n.inicioId).toBe('d');
    expect(n.pasados).toEqual(['d', 'e']);
    expect(n.vueltasCompletadas).toBe(0);
  });

  it('el resumen de vuelta usa el total vigente', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'c'], ['a', 'c', 'd']);
    expect(e.ultimaVueltaResumen).toEqual({ numero: 1, pasados: 2, total: 3 });
  });

  it('un paso a un punto que ya no existe solo recuerda la clave', () => {
    const e = pasoPunto(estadoInicialVuelta('s'), { puntoId: 'zzz', clave: 'k' }, ids);
    expect(e.pasados).toEqual([]);
    expect(e.inicioId).toBeNull();
    expect(e.procesados).toEqual(['k']);
  });
});

describe('reiniciarVuelta', () => {
  it('limpia la vuelta en curso y conserva el conteo de vueltas', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'b', 'a', 'c']);
    expect(e.vueltasCompletadas).toBe(1);
    const r = reiniciarVuelta(e);
    expect(r.inicioId).toBeNull();
    expect(r.pasados).toEqual([]);
    expect(r.ultimoId).toBeNull();
    expect(r.vueltasCompletadas).toBe(1);
    expect(r.procesados).toEqual(e.procesados);
  });

  it('devuelve el mismo objeto si ya estaba limpia', () => {
    const e = estadoInicialVuelta('s');
    expect(reiniciarVuelta(e)).toBe(e);
  });
});

describe('clave del progreso', () => {
  it('fechaLocal usa el día local del dispositivo (YYYY-MM-DD)', () => {
    const ms = new Date(2026, 0, 5, 23, 59).getTime();
    expect(fechaLocal(ms)).toBe('2026-01-05');
    expect(fechaLocal(new Date(2026, 11, 31, 0, 1).getTime())).toBe('2026-12-31');
  });

  it('claveProgresoVuelta y separarClaveProgreso son inversas (aunque el sesionId tenga ":")', () => {
    const clave = claveProgresoVuelta('ses:ion-1', '2026-10-11');
    expect(clave).toBe('ses:ion-1:2026-10-11');
    expect(separarClaveProgreso(clave)).toEqual({ sesionId: 'ses:ion-1', fecha: '2026-10-11' });
  });
});
