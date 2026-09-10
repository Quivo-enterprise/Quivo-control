import { describe, expect, it } from 'vitest';
import {
  avanzarAnimacion,
  DURACION_MINIMA_SEGMENTO_MS,
  encolarNuevosPuntos,
  estadoInicialAnimacion,
  MAX_PUNTOS_ANIMADOS,
  type EstadoAnimacionVehiculo,
  type PuntoAnimable,
} from './vehicle-marker-animation.js';

function punto(ts: string, lat: number, lng: number): PuntoAnimable {
  return { ts, lat, lng };
}

describe('encolarNuevosPuntos', () => {
  it('la primera vez salta directo al último punto, sin encolar nada', () => {
    const estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t1', 1, 1), punto('t2', 2, 2)], 10_000);
    expect(estado.current).toEqual({ lat: 2, lng: 2 });
    expect(estado.lastConsumedTs).toBe('t2');
    expect(estado.queue).toEqual([]);
    expect(estado.segment).toBeNull();
  });

  it('con un solo punto nuevo encola un segmento con duración = intervalMs', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t1', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(estado, [punto('t1', 0, 0), punto('t2', 1, 1)], 10_000);
    expect(estado.current).toEqual({ lat: 0, lng: 0 }); // todavía no avanzó ningún frame
    expect(estado.queue).toEqual([{ lat: 1, lng: 1, durationMs: 10_000 }]);
    expect(estado.lastConsumedTs).toBe('t2');
  });

  it('reparte intervalMs entre los puntos nuevos del lote', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(
      estado,
      [punto('t0', 0, 0), punto('t1', 1, 1), punto('t2', 2, 2), punto('t3', 3, 3), punto('t4', 4, 4)],
      2_000,
    );
    expect(estado.queue).toHaveLength(4);
    expect(estado.queue.every((s) => s.durationMs === 500)).toBe(true);
  });

  it('no baja la duración de un segmento por debajo del piso mínimo', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    const lote = Array.from({ length: 20 }, (_, i) => punto(`t${i}`, i, i));
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), ...lote], 100 /* intervalMs chico */);
    expect(estado.queue.every((s) => s.durationMs === DURACION_MINIMA_SEGMENTO_MS)).toBe(true);
  });

  it('no reencola puntos ya consumidos (llamar dos veces con el mismo array es idempotente)', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 1, 1)], 10_000);
    const otraVez = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 1, 1)], 10_000);
    expect(otraVez).toBe(estado); // misma referencia: no hizo nada
  });

  it('un backfill enteramente más viejo que lo ya dibujado no produce cola', () => {
    const estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t5', 5, 5)], 10_000);
    // Llega una ráfaga que, fusionada, deja puntos con ts < 't5' insertados ANTES del último
    // ya dibujado — el marcador ya está en t5, no hay que retroceder.
    const fusionado = [punto('t1', 1, 1), punto('t2', 2, 2), punto('t5', 5, 5)];
    const otraVez = encolarNuevosPuntos(estado, fusionado, 10_000);
    expect(otraVez).toBe(estado);
  });

  it('lote grande (> MAX_PUNTOS_ANIMADOS) salta directo al último, sin cola', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    const lote = Array.from({ length: MAX_PUNTOS_ANIMADOS + 10 }, (_, i) => punto(`t${i + 1}`, i + 1, i + 1));
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), ...lote], 10_000);
    const ultimoPunto = lote[lote.length - 1]!;
    expect(estado.current).toEqual({ lat: ultimoPunto.lat, lng: ultimoPunto.lng });
    expect(estado.queue).toEqual([]);
    expect(estado.segment).toBeNull();
  });

  it('con prefers-reduced-motion salta directo aunque el lote sea chico', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 1, 1)], 10_000, {
      reducirMovimiento: true,
    });
    expect(estado.current).toEqual({ lat: 1, lng: 1 });
    expect(estado.queue).toEqual([]);
  });

  it('llega un punto nuevo con una animación en curso: se agrega a la cola sin tocar la posición visual actual', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 10, 10)], 10_000);
    // Arranca el segmento (frame en t=0) y lo avanza a la mitad — el marcador queda en un
    // punto intermedio real, no en el extremo.
    estado = avanzarAnimacion(estado, 0).estado;
    const avance = avanzarAnimacion(estado, 5_000);
    estado = avance.estado;
    expect(estado.current).toEqual({ lat: 5, lng: 5 });
    expect(estado.segment).not.toBeNull();

    // Llega un punto nuevo MIENTRAS la animación anterior sigue corriendo.
    const conNuevo = encolarNuevosPuntos(
      estado,
      [punto('t0', 0, 0), punto('t1', 10, 10), punto('t2', 20, 20)],
      10_000,
    );
    // La posición visual actual (a mitad de camino) no se toca ni se pisa hacia atrás.
    expect(conNuevo.current).toEqual({ lat: 5, lng: 5 });
    // El segmento en curso (t0->t1) sigue siendo el mismo objeto/valores — no se reinicia.
    expect(conNuevo.segment).toEqual(estado.segment);
    // El punto nuevo se agrega DETRÁS en la cola, no reemplaza nada.
    expect(conNuevo.queue).toEqual([{ lat: 20, lng: 20, durationMs: 10_000 }]);
  });
});

describe('avanzarAnimacion', () => {
  it('sin ningún punto todavía, no hay nada que animar', () => {
    const resultado = avanzarAnimacion(estadoInicialAnimacion(), 0);
    expect(resultado.posicion).toBeNull();
    expect(resultado.enMovimiento).toBe(false);
  });

  it('arranca el segmento en el mismo frame en que se lo consulta (progreso 0% ya resuelto)', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 10, 0)], 10_000);
    const resultado = avanzarAnimacion(estado, 1_000);
    expect(resultado.posicion).toEqual({ lat: 0, lng: 0 });
    expect(resultado.enMovimiento).toBe(true);
  });

  it('interpola linealmente entre from y to según el progreso del segmento', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 10, 20)], 10_000);
    let resultado = avanzarAnimacion(estado, 0);
    resultado = avanzarAnimacion(resultado.estado, 2_500);
    expect(resultado.posicion).toEqual({ lat: 2.5, lng: 5 });
  });

  it('al completar un segmento hace snap exacto al punto final (sin arrastre de punto flotante)', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 300);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 1, 1)], 300);
    let resultado = avanzarAnimacion(estado, 0);
    resultado = avanzarAnimacion(resultado.estado, 1_000); // muy por encima de durationMs (300)
    expect(resultado.posicion).toEqual({ lat: 1, lng: 1 });
    expect(resultado.estado.segment).toBeNull();
  });

  it('al terminar un segmento y quedar cola pendiente, sigue en movimiento y arranca el próximo', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 6_000);
    estado = encolarNuevosPuntos(
      estado,
      [punto('t0', 0, 0), punto('t1', 1, 1), punto('t2', 2, 2)],
      6_000,
    );
    let resultado = avanzarAnimacion(estado, 0); // arranca t0->t1 (duración 3000)
    resultado = avanzarAnimacion(resultado.estado, 3_000); // termina t0->t1 exacto
    expect(resultado.posicion).toEqual({ lat: 1, lng: 1 });
    expect(resultado.enMovimiento).toBe(true); // todavía queda t1->t2 en la cola
    resultado = avanzarAnimacion(resultado.estado, 3_100); // arranca t1->t2 en este mismo frame
    expect(resultado.posicion).toEqual({ lat: 1, lng: 1 }); // progreso 0% del segmento nuevo
    expect(resultado.enMovimiento).toBe(true);
  });

  it('con la cola vacía y sin segmento activo, deja de pedir frames (enMovimiento: false)', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 1_000);
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), punto('t1', 1, 1)], 1_000);
    let resultado = avanzarAnimacion(estado, 0);
    resultado = avanzarAnimacion(resultado.estado, 5_000); // termina, cola vacía
    expect(resultado.enMovimiento).toBe(false);
    // Un frame de más no reactiva nada: sigue devolviendo la misma posición final.
    const otraVez = avanzarAnimacion(resultado.estado, 5_100);
    expect(otraVez.posicion).toEqual({ lat: 1, lng: 1 });
    expect(otraVez.enMovimiento).toBe(false);
  });

  it('lote grande: salto directo, avanzarAnimacion no tiene nada que interpolar', () => {
    let estado = encolarNuevosPuntos(estadoInicialAnimacion(), [punto('t0', 0, 0)], 10_000);
    const lote = Array.from({ length: MAX_PUNTOS_ANIMADOS + 1 }, (_, i) => punto(`t${i + 1}`, i + 1, i + 1));
    estado = encolarNuevosPuntos(estado, [punto('t0', 0, 0), ...lote], 10_000);
    const resultado = avanzarAnimacion(estado, 0);
    const ultimoPunto = lote[lote.length - 1]!;
    expect(resultado.posicion).toEqual({ lat: ultimoPunto.lat, lng: ultimoPunto.lng });
    expect(resultado.enMovimiento).toBe(false);
  });
});

describe('estadoInicialAnimacion', () => {
  it('empieza sin posición, sin cola y sin segmento', () => {
    const estado: EstadoAnimacionVehiculo = estadoInicialAnimacion();
    expect(estado).toEqual({ lastConsumedTs: null, current: null, queue: [], segment: null });
  });
});
