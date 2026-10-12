import { describe, expect, it } from 'vitest';
import { DESVIO_UMBRAL_M } from '@quivo/shared';
import { RUTA_PROXIMIDAD_TOLERANCIA_METROS } from '../../common/geo/proximidad-ruta.js';
import {
  ESTADO_DESVIO_INICIAL,
  avanzarDesvio,
  type EstadoDesvio,
  type PuntoDesvio,
} from './desvio.js';

// Instantes fijos (sin reloj): `t(s)` = segundos desde una base arbitraria.
const BASE = Date.parse('2026-10-12T15:00:00.000Z');
const t = (segundos: number) => new Date(BASE + segundos * 1000);

// Recorrido por defecto de los puntos de test (su `inicio_recorrido`).
const REC = t(-100);

function punto(
  seg: number,
  distanciaM: number,
  accuracy: number | null = 5,
  recorridoTs: Date | null = REC,
): PuntoDesvio {
  return { ts: t(seg), lat: -17.78 - seg / 1e6, lng: -63.18, accuracy, distanciaM, recorridoTs };
}

describe('constantes de desvío', () => {
  it('DESVIO_UMBRAL_M reusa la tolerancia de proximidad a la ruta', () => {
    expect(DESVIO_UMBRAL_M).toBe(RUTA_PROXIMIDAD_TOLERANCIA_METROS);
  });
});

describe('avanzarDesvio', () => {
  it('no abre con puntos dentro de la ruta', () => {
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 10),
      punto(15, 40),
      punto(30, 99),
    ]);
    expect(acciones).toEqual([]);
    expect(estado.abierta).toBe(false);
    expect(estado.puntosFuera).toBe(0);
  });

  it('no abre con 2 puntos fuera aunque pasen los 45 s (mínimo 3 puntos)', () => {
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(60, 150),
    ]);
    expect(acciones).toEqual([]);
    expect(estado.puntosFuera).toBe(2);
  });

  it('no abre con 3 puntos fuera en menos de 45 s', () => {
    const { acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(20, 160),
      punto(44, 170),
    ]);
    expect(acciones).toEqual([]);
  });

  it('abre con 3 puntos fuera que abarcan >= 45 s, con lat/lng/inicio del PRIMER punto fuera', () => {
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 10),
      punto(10, 150),
      punto(30, 180),
      punto(55, 200),
    ]);
    expect(acciones).toHaveLength(1);
    const abrir = acciones[0]!;
    expect(abrir.tipo).toBe('abrir');
    if (abrir.tipo !== 'abrir') throw new Error('inesperado');
    expect(abrir.inicioTs).toEqual(t(10));
    expect(abrir.lat).toBeCloseTo(-17.78 - 10 / 1e6, 9);
    expect(abrir.detalle).toEqual({ distanciaMaxM: 200, duracionS: 45, puntos: 3 });
    expect(estado.abierta).toBe(true);
  });

  it('un punto a <= umbral antes de abrir reinicia la racha', () => {
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(20, 150),
      punto(30, 100), // exactamente en el umbral: dentro (la regla es "> 100 m")
      punto(50, 150),
      punto(80, 150),
    ]);
    expect(acciones).toEqual([]);
    expect(estado.puntosFuera).toBe(2);
    expect(estado.fueraDesdeTs).toEqual(t(50));
  });

  it('con la infracción abierta sigue el máximo y publica una sola actualización', () => {
    const abierto = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(25, 150),
      punto(50, 150),
    ]);
    expect(abierto.estado.abierta).toBe(true);
    const { estado, acciones } = avanzarDesvio(abierto.estado, [
      punto(60, 300),
      punto(70, 250),
    ]);
    expect(acciones).toEqual([
      { tipo: 'actualizar', detalle: { distanciaMaxM: 300, duracionS: 70, puntos: 5 } },
    ]);
    expect(estado.abierta).toBe(true);
  });

  it('histéresis: entre 60 y 100 m la infracción sigue abierta; cierra con 2 puntos < 60 m', () => {
    const abierto = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(25, 150),
      punto(50, 150),
    ]).estado;
    // 80 m: dentro del umbral de apertura pero NO del de regreso → sigue abierta.
    const zonaGris = avanzarDesvio(abierto, [punto(60, 80), punto(70, 80)]);
    expect(zonaGris.estado.abierta).toBe(true);
    expect(zonaGris.acciones.some((a) => a.tipo === 'cerrar')).toBe(false);
    // Un solo punto < 60 m no alcanza.
    const uno = avanzarDesvio(zonaGris.estado, [punto(80, 30)]);
    expect(uno.estado.abierta).toBe(true);
    expect(uno.estado.dentroConsecutivos).toBe(1);
    // Un punto fuera en el medio reinicia el conteo de regreso.
    const reinicia = avanzarDesvio(uno.estado, [punto(90, 120), punto(100, 30)]);
    expect(reinicia.estado.dentroConsecutivos).toBe(1);
    // Segundo consecutivo → cierra con el ts del punto que confirma.
    const cierra = avanzarDesvio(reinicia.estado, [punto(110, 20)]);
    expect(cierra.acciones).toHaveLength(1);
    expect(cierra.acciones[0]).toMatchObject({ tipo: 'cerrar', finTs: t(110) });
    expect(cierra.estado.abierta).toBe(false);
    expect(cierra.estado.puntosFuera).toBe(0);
  });

  it('abre y cierra dentro del mismo lote, y puede abrir una segunda infracción distinta', () => {
    const lote = [
      punto(0, 150),
      punto(25, 150),
      punto(50, 150),
      punto(60, 10),
      punto(70, 10),
      punto(100, 200),
      punto(130, 200),
      punto(160, 200),
    ];
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, lote);
    expect(acciones.map((a) => a.tipo)).toEqual(['abrir', 'cerrar', 'abrir']);
    const segunda = acciones[2]!;
    if (segunda.tipo !== 'abrir') throw new Error('inesperado');
    expect(segunda.inicioTs).toEqual(t(100));
    expect(estado.abierta).toBe(true);
  });

  it('se abre a través de lotes: el estado persistido continúa la racha', () => {
    const lote1 = avanzarDesvio(ESTADO_DESVIO_INICIAL, [punto(0, 150), punto(20, 150)]);
    expect(lote1.acciones).toEqual([]);
    // Lo que el worker guarda y relee de sesion_desvio_estado.
    const persistido: EstadoDesvio = { ...lote1.estado };
    const lote2 = avanzarDesvio(persistido, [punto(50, 150)]);
    expect(lote2.acciones).toHaveLength(1);
    expect(lote2.acciones[0]).toMatchObject({ tipo: 'abrir', inicioTs: t(0) });
  });

  it('ignora puntos tardíos (ts <= ultimoTs) y reprocesar el mismo lote es inocuo', () => {
    const lote = [punto(0, 150), punto(25, 150), punto(50, 150)];
    const primero = avanzarDesvio(ESTADO_DESVIO_INICIAL, lote);
    const reproceso = avanzarDesvio(primero.estado, lote);
    expect(reproceso.acciones).toEqual([]);
    expect(reproceso.estado).toEqual(primero.estado);
    // Un punto viejo (outbox) tampoco mueve nada, ni siquiera ultimoTs.
    const tardio = avanzarDesvio(primero.estado, [punto(10, 5), punto(50, 5)]);
    expect(tardio.estado).toEqual(primero.estado);
    expect(tardio.acciones).toEqual([]);
  });

  it('ignora puntos con accuracy > 30 m; accuracy nula se acepta; 30 m exactos se acepta', () => {
    const ruido = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150, 31),
      punto(25, 150, 80),
      punto(50, 150, 500),
    ]);
    expect(ruido.estado).toEqual(ESTADO_DESVIO_INICIAL);

    const aceptados = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150, null),
      punto(25, 150, 30),
      punto(50, 150, 12),
    ]);
    expect(aceptados.acciones).toHaveLength(1);

    // Un punto "de regreso" con mala precisión no cierra una infracción abierta.
    const sinCerrar = avanzarDesvio(aceptados.estado, [punto(60, 5, 90), punto(70, 5, 90)]);
    expect(sinCerrar.estado.abierta).toBe(true);
  });

  it('ordena por ts: el orden de llegada dentro del lote no cambia el resultado', () => {
    const lote = [punto(50, 150), punto(0, 150), punto(25, 150)];
    const { acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, lote);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ tipo: 'abrir', inicioTs: t(0) });
  });

  it('no muta el estado de entrada', () => {
    const entrada = { ...ESTADO_DESVIO_INICIAL };
    avanzarDesvio(entrada, [punto(0, 150), punto(25, 150), punto(50, 150)]);
    expect(entrada).toEqual(ESTADO_DESVIO_INICIAL);
  });
});

describe('avanzarDesvio — recorridos', () => {
  const abierto = () =>
    avanzarDesvio(ESTADO_DESVIO_INICIAL, [punto(0, 150), punto(25, 150), punto(50, 150)]);

  it('los puntos fuera de recorrido (recorridoTs null) no mueven la máquina', () => {
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 500, 5, null),
      punto(25, 500, 5, null),
      punto(50, 500, 5, null),
    ]);
    expect(acciones).toEqual([]);
    expect(estado).toEqual(ESTADO_DESVIO_INICIAL);
  });

  it('un punto en vacío entre medias no reinicia ni cuenta la racha de un recorrido', () => {
    const { estado } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(10, 5, 5, null),
      punto(25, 150),
    ]);
    expect(estado.puntosFuera).toBe(2);
  });

  it('el marcador fin cierra la infracción abierta con el ts del último punto evaluado y reinicia la máquina', () => {
    const previo = abierto();
    const { estado, acciones } = avanzarDesvio(previo.estado, [], [{ tipo: 'fin', ts: t(200), recorridoTs: REC }]);
    expect(acciones).toEqual([
      { tipo: 'cerrar', finTs: t(50), detalle: { distanciaMaxM: 150, duracionS: 50, puntos: 3 } },
    ]);
    expect(estado).toEqual({ ...ESTADO_DESVIO_INICIAL, ultimoTs: t(50) });
  });

  it('un fin de OTRO recorrido (o sin recorrido en curso) no toca el estado', () => {
    const previo = abierto();
    const { estado, acciones } = avanzarDesvio(
      previo.estado,
      [],
      [{ tipo: 'fin', ts: t(200), recorridoTs: t(-5000) }],
    );
    expect(acciones).toEqual([]);
    expect(estado).toEqual(previo.estado);
  });

  it('el marcador inicio de un recorrido nuevo reinicia la racha y cierra lo abierto', () => {
    const racha = avanzarDesvio(ESTADO_DESVIO_INICIAL, [punto(0, 150), punto(20, 150)]);
    const nuevo = t(100);
    const sinAbrir = avanzarDesvio(racha.estado, [], [{ tipo: 'inicio', ts: nuevo, recorridoTs: nuevo }]);
    expect(sinAbrir.acciones).toEqual([]);
    expect(sinAbrir.estado.puntosFuera).toBe(0);
    expect(sinAbrir.estado.recorridoTs).toEqual(nuevo);

    const cierra = avanzarDesvio(abierto().estado, [], [{ tipo: 'inicio', ts: nuevo, recorridoTs: nuevo }]);
    expect(cierra.acciones).toHaveLength(1);
    expect(cierra.acciones[0]).toMatchObject({ tipo: 'cerrar', finTs: t(50) });
  });

  it('una racha NO se arrastra entre recorridos: 2 puntos fuera + 1 fuera del siguiente recorrido no abren', () => {
    const REC2 = t(300);
    const { estado, acciones } = avanzarDesvio(ESTADO_DESVIO_INICIAL, [
      punto(0, 150),
      punto(25, 150),
      punto(310, 150, 5, REC2),
    ]);
    expect(acciones).toEqual([]);
    expect(estado.puntosFuera).toBe(1);
    expect(estado.recorridoTs).toEqual(REC2);
  });

  it('en el mismo lote: fin cierra, el traslado en vacío no abre y el recorrido siguiente arranca limpio', () => {
    const REC2 = t(500);
    const { estado, acciones } = avanzarDesvio(
      ESTADO_DESVIO_INICIAL,
      [
        punto(0, 150),
        punto(25, 150),
        punto(50, 150),
        punto(250, 900, 5, null),
        punto(300, 900, 5, null),
        punto(350, 900, 5, null),
        punto(510, 10, 5, REC2),
      ],
      [
        { tipo: 'fin', ts: t(200), recorridoTs: REC },
        { tipo: 'inicio', ts: REC2, recorridoTs: REC2 },
      ],
    );
    expect(acciones.map((a) => a.tipo)).toEqual(['abrir', 'cerrar']);
    expect(acciones[1]).toMatchObject({ tipo: 'cerrar', finTs: t(50) });
    expect(estado.abierta).toBe(false);
    expect(estado.recorridoTs).toEqual(REC2);
  });

  it('el marcador fin reprocesado (estado ya sin recorrido) es inocuo', () => {
    const una = avanzarDesvio(abierto().estado, [], [{ tipo: 'fin', ts: t(200), recorridoTs: REC }]);
    const dos = avanzarDesvio(una.estado, [], [{ tipo: 'fin', ts: t(200), recorridoTs: REC }]);
    expect(dos.acciones).toEqual([]);
    expect(dos.estado).toEqual(una.estado);
  });
});
