import { describe, expect, it } from 'vitest';
import type { PuntoTrazaGps, TrazaEnVivo } from '@quivo/shared';
import {
  antiguedadViva,
  clavePunto,
  debeRecargar,
  desdeConSolape,
  formatearAntiguedad,
  fusionarTraza,
  intervaloPoll,
  necesitaRecargaCompleta,
  offsetRelojServidorMs,
  PRESENTACION_FRESCURA,
  SOLAPE_CURSOR_MS,
  UMBRAL_CORTE_POLL_MS,
  INTERVALO_POLL_MS,
  INTERVALO_POLL_RAPIDO_MS,
  type TrazaAcumulada,
} from './traza.js';

function punto(ts: string, lat = -17.38, lng = -66.15): PuntoTrazaGps {
  return { ts, lat, lng, accuracy: 8, speed: 5 };
}

function respuesta(overrides: Partial<TrazaEnVivo> = {}): TrazaEnVivo {
  return {
    puntos: [],
    cursor: null,
    hayMas: false,
    totalPuntos: 0,
    cumplimientos: [],
    sesionFin: null,
    sesionEstado: 'activa',
    ultimoFixTs: null,
    ultimoIngresoTs: null,
    servidorTs: '2026-08-18T14:00:00.000Z',
    antiguedadFixMs: null,
    antiguedadIngestaMs: null,
    inactivaDesdeMs: 0,
    estadoFrescura: 'sin_datos',
    ...overrides,
  };
}

describe('fusionarTraza (merge del delta contra la cache)', () => {
  it('acumula el delta sobre lo que ya había', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    const fusionada = fusionarTraza(
      previa,
      respuesta({ puntos: [punto('2026-08-18T13:00:20.000Z')], totalPuntos: 2 }),
    );

    expect(fusionada.puntos.map((p) => p.ts)).toEqual([
      '2026-08-18T13:00:00.000Z',
      '2026-08-18T13:00:20.000Z',
    ]);
    expect(fusionada.cursor).toBe('2026-08-18T13:00:20.000Z');
  });

  it('deduplica por ts|lat|lng: reaplicar el mismo delta no cambia nada (idempotente)', () => {
    const delta = respuesta({
      puntos: [punto('2026-08-18T13:00:00.000Z'), punto('2026-08-18T13:00:20.000Z')],
      totalPuntos: 2,
    });
    const unaVez = fusionarTraza(undefined, delta);
    const dosVeces = fusionarTraza(unaVez, delta);

    expect(dosVeces.puntos).toHaveLength(2);
    expect(dosVeces.cursor).toBe(unaVez.cursor);
  });

  it('distingue dos fixes con el mismo ts pero coordenadas distintas', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({
        puntos: [
          punto('2026-08-18T13:00:00.000Z', -17.38, -66.15),
          punto('2026-08-18T13:00:00.000Z', -17.39, -66.16),
        ],
        totalPuntos: 2,
      }),
    );

    expect(fusionada.puntos).toHaveLength(2);
    expect(clavePunto(fusionada.puntos[0] as PuntoTrazaGps)).not.toBe(
      clavePunto(fusionada.puntos[1] as PuntoTrazaGps),
    );
  });

  it('reordena las ráfagas post-Doze: un punto con ts viejo entra en su lugar cronológico', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({
        puntos: [punto('2026-08-18T13:00:00.000Z'), punto('2026-08-18T13:02:00.000Z')],
        totalPuntos: 2,
      }),
    );
    // El solape de 2 min hace que el server devuelva un fix capturado ANTES del último
    // dibujado (llegó tarde al servidor). Sin el sort, la polilínea saltaría hacia atrás.
    const fusionada = fusionarTraza(
      previa,
      respuesta({ puntos: [punto('2026-08-18T13:01:00.000Z', -17.385)], totalPuntos: 3 }),
    );

    expect(fusionada.puntos.map((p) => p.ts)).toEqual([
      '2026-08-18T13:00:00.000Z',
      '2026-08-18T13:01:00.000Z',
      '2026-08-18T13:02:00.000Z',
    ]);
    expect(fusionada.cursor).toBe('2026-08-18T13:02:00.000Z');
  });

  it('reemplaza (no acumula) los campos de estado y frescura del delta', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    const fusionada = fusionarTraza(
      previa,
      respuesta({
        totalPuntos: 1,
        estadoFrescura: 'detenido',
        sesionFin: '2026-08-18T14:00:00.000Z',
      }),
    );

    expect(fusionada.estadoFrescura).toBe('detenido');
    expect(fusionada.sesionFin).toBe('2026-08-18T14:00:00.000Z');
    expect(fusionada.puntos).toHaveLength(1);
  });

  it('deja `cursor` en null mientras no haya ningún punto', () => {
    expect(fusionarTraza(undefined, respuesta()).cursor).toBeNull();
  });
});

describe('desdeConSolape (cursor con 2 min de solape)', () => {
  it('resta el solape al cursor', () => {
    const desde = desdeConSolape('2026-08-18T13:05:00.000Z');
    expect(desde?.toISOString()).toBe(
      new Date(Date.parse('2026-08-18T13:05:00.000Z') - SOLAPE_CURSOR_MS).toISOString(),
    );
  });

  it('sin cursor pide la ventana completa', () => {
    expect(desdeConSolape(null)).toBeUndefined();
    expect(desdeConSolape(undefined)).toBeUndefined();
  });
});

describe('necesitaRecargaCompleta (auto-heal)', () => {
  it('dispara la recarga cuando lo acumulado quedó por debajo de totalPuntos', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 40 }),
    );

    expect(fusionada.completa).toBe(false);
    expect(necesitaRecargaCompleta(fusionada)).toBe(true);
  });

  it('NO dispara cuando el delta vino truncado por `limite` (hayMas)', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 40, hayMas: true }),
    );

    expect(necesitaRecargaCompleta(fusionada)).toBe(false);
  });

  it('NO dispara cuando la traza está completa', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({
        puntos: [punto('2026-08-18T13:00:00.000Z'), punto('2026-08-18T13:00:20.000Z')],
        totalPuntos: 2,
      }),
    );

    expect(fusionada.completa).toBe(true);
    expect(necesitaRecargaCompleta(fusionada)).toBe(false);
  });

  it('una recarga completa cura el hueco', () => {
    const conHueco = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:40.000Z')], totalPuntos: 3 }),
    );
    expect(necesitaRecargaCompleta(conHueco)).toBe(true);

    // La recarga descarta lo acumulado (`previa` = undefined) a propósito.
    const curada = fusionarTraza(
      undefined,
      respuesta({
        puntos: [
          punto('2026-08-18T13:00:00.000Z'),
          punto('2026-08-18T13:00:20.000Z'),
          punto('2026-08-18T13:00:40.000Z'),
        ],
        totalPuntos: 3,
      }),
    );
    expect(curada.completa).toBe(true);
    expect(necesitaRecargaCompleta(curada)).toBe(false);
  });
});

describe('debeRecargar (guarda contra el bucle de recargas)', () => {
  const incompleta = (recargaFallida: boolean, totalPuntos = 40): TrazaAcumulada => ({
    ...fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos }),
    ),
    recargaFallida,
  });

  it('recarga la primera vez que detecta el hueco', () => {
    expect(debeRecargar(undefined, incompleta(false))).toBe(true);
  });

  it('NO vuelve a recargar si la recarga anterior ya falló contra el mismo total', () => {
    // Pasa con dos filas distintas en la base con el mismo ts/lat/lng (reingesta del mismo
    // fix): el dedupe las colapsa y el acumulado nunca alcanza `totalPuntos`.
    expect(debeRecargar(incompleta(true), incompleta(false))).toBe(false);
  });

  it('vuelve a intentar cuando el total cambió (hueco nuevo y real)', () => {
    expect(debeRecargar(incompleta(true, 40), incompleta(false, 41))).toBe(true);
  });

  it('nunca recarga si la traza está completa', () => {
    const completa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    expect(debeRecargar(incompleta(true), completa)).toBe(false);
  });
});

describe('antigüedad medida contra el reloj del servidor', () => {
  const servidorTs = '2026-08-18T14:00:00.000Z';
  const ultimoFixTs = '2026-08-18T13:58:00.000Z'; // 2 min antes según el server

  it('con el reloj del navegador en hora da la antigüedad real', () => {
    const recibidoEn = Date.parse(servidorTs);
    expect(offsetRelojServidorMs(servidorTs, recibidoEn)).toBe(0);
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn)).toBe(120_000);
  });

  it('con el navegador 3 h adelantado da EXACTAMENTE lo mismo', () => {
    const desfase = 3 * 60 * 60_000;
    const recibidoEn = Date.parse(servidorTs) + desfase;
    expect(offsetRelojServidorMs(servidorTs, recibidoEn)).toBe(-desfase);
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn)).toBe(120_000);
  });

  it('con el navegador 3 h atrasado da EXACTAMENTE lo mismo', () => {
    const recibidoEn = Date.parse(servidorTs) - 3 * 60 * 60_000;
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn)).toBe(120_000);
  });

  it('sigue corriendo entre polls: 30 s de reloj del cliente suman 30 s de antigüedad', () => {
    const recibidoEn = Date.parse(servidorTs) + 5 * 60 * 60_000; // reloj cualquiera
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn + 30_000)).toBe(150_000);
  });

  it('nunca devuelve negativo (skew de milisegundos entre relojes)', () => {
    const recibidoEn = Date.parse(servidorTs);
    expect(antiguedadViva('2026-08-18T14:00:05.000Z', servidorTs, recibidoEn, recibidoEn)).toBe(0);
  });

  it('sin timestamp devuelve null (se pinta como "—", no como "hace 56 años")', () => {
    expect(
      antiguedadViva(null, servidorTs, Date.parse(servidorTs), Date.parse(servidorTs)),
    ).toBeNull();
  });
});

describe('intervaloPoll', () => {
  it('sin datos todavía usa la cadencia normal', () => {
    expect(intervaloPoll(undefined)).toBe(INTERVALO_POLL_MS);
  });

  it('acelera mientras el server avisa hayMas', () => {
    expect(intervaloPoll({ hayMas: true, inactivaDesdeMs: 0 })).toBe(INTERVALO_POLL_RAPIDO_MS);
  });

  it('corta por inactividad real (`inactivaDesdeMs`), no por `fin`', () => {
    expect(intervaloPoll({ hayMas: false, inactivaDesdeMs: UMBRAL_CORTE_POLL_MS + 1 })).toBe(false);
  });

  it('NO corta a un teléfono solo atrasado: el p95 del lag de ingesta (~814 s) sigue polleando', () => {
    expect(intervaloPoll({ hayMas: false, inactivaDesdeMs: 814_000 })).toBe(INTERVALO_POLL_MS);
  });

  it('tampoco corta con el máximo de lag medido en campo si el vehículo sigue vivo', () => {
    expect(UMBRAL_CORTE_POLL_MS).toBeGreaterThan(15 * 60_000);
  });
});

describe('presentación de estadoFrescura', () => {
  it('`detenido` NO es una falla (vehículo esperando en terminal)', () => {
    expect(PRESENTACION_FRESCURA.detenido.esFalla).toBe(false);
  });

  it('la única falla es `perdido`', () => {
    expect(PRESENTACION_FRESCURA.perdido.esFalla).toBe(true);
    expect(PRESENTACION_FRESCURA.reportando.esFalla).toBe(false);
    expect(PRESENTACION_FRESCURA.sin_datos.esFalla).toBe(false);
  });

  it('cada estado tiene un color propio', () => {
    const colores = Object.values(PRESENTACION_FRESCURA).map((p) => p.color);
    expect(new Set(colores).size).toBe(colores.length);
  });
});

describe('formatearAntiguedad', () => {
  it('formatea segundos, minutos y horas', () => {
    expect(formatearAntiguedad(null)).toBe('—');
    expect(formatearAntiguedad(12_000)).toBe('12 s');
    expect(formatearAntiguedad(200_000)).toBe('3 min 20 s');
    expect(formatearAntiguedad(3_900_000)).toBe('1 h 05 min');
  });
});

describe('tipos acumulados', () => {
  it('TrazaAcumulada conserva todo el payload del server', () => {
    const acumulada: TrazaAcumulada = fusionarTraza(
      undefined,
      respuesta({ estadoFrescura: 'reportando', inactivaDesdeMs: 1_000 }),
    );
    expect(acumulada.inactivaDesdeMs).toBe(1_000);
    expect(acumulada.estadoFrescura).toBe('reportando');
  });
});
