import { describe, expect, it } from 'vitest';
import {
  avanzarVueltas,
  detectarSalidaEspera,
  resolverEspera,
  type EventoVuelta,
  type FilaVuelta,
  type FixEspera,
} from './vueltas.js';

const T0 = Date.parse('2026-10-13T12:00:00.000Z');
const min = (m: number) => new Date(T0 + m * 60_000);
const seg = (s: number) => new Date(T0 + s * 1000);

let contador = 0;
const nuevoId = () => `vuelta-${++contador}`;

const SR = 'pc-sr';
const HONDURAS = 'pc-honduras';
const MOLINOS = 'pc-molinos';

const terminal = (ts: Date): EventoVuelta => ({ clase: 'cumplimiento', ts, puntoControlId: SR, rol: 'terminal', lat: -17.4, lng: -66.2 });
const retorno = (ts: Date): EventoVuelta => ({ clase: 'cumplimiento', ts, puntoControlId: HONDURAS, rol: 'retorno', lat: -17.5, lng: -66.1 });
const espera = (ts: Date): EventoVuelta => ({ clase: 'cumplimiento', ts, puntoControlId: MOLINOS, rol: 'espera', lat: -17.6, lng: -66.0 });
const comun = (ts: Date): EventoVuelta => ({ clase: 'cumplimiento', ts, puntoControlId: 'pc-x', rol: null, lat: 0, lng: 0 });
const inicio = (ts: Date): EventoVuelta => ({ clase: 'inicio', ts });
const fin = (ts: Date): EventoVuelta => ({ clase: 'fin', ts });

function fila(parcial: Partial<FilaVuelta> = {}): FilaVuelta {
  return {
    id: 'v-prev',
    numero: 1,
    inicioTs: min(0),
    finTs: null,
    estado: 'en_curso',
    pasoRetornoTs: null,
    varianteId: null,
    puntoEsperaId: null,
    esperaLlegadaTs: null,
    esperaSalidaTs: null,
    ...parcial,
  };
}

const avanzar = (ultima: FilaVuelta | null, eventos: EventoVuelta[]) => avanzarVueltas(ultima, eventos, { nuevoId });
const ultimaDe = (r: ReturnType<typeof avanzar>) => r.cambios[r.cambios.length - 1]!.fila;

describe('avanzarVueltas — apertura y cierre', () => {
  it('la primera vuelta abre con el primer cumplimiento de la terminal', () => {
    const r = avanzar(null, [terminal(min(1))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.nueva).toBe(true);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 1, estado: 'en_curso', inicioTs: min(1) });
  });

  it('también abre con inicio_recorrido, y el que llegue primero gana (el otro no duplica)', () => {
    const porInicio = avanzar(null, [inicio(min(1))]);
    expect(porInicio.cambios[0]!.fila.inicioTs).toEqual(min(1));
    // Terminal 30 s ANTES del inicio (relojes distintos): abre la terminal, el inicio no abre otra.
    const r = avanzar(null, [inicio(min(1)), terminal(seg(30))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila.inicioTs).toEqual(seg(30));
  });

  it('SR → Honduras → SR cierra la vuelta completa y abre la siguiente con el mismo ts', () => {
    const r = avanzar(null, [terminal(min(0)), retorno(min(25)), terminal(min(50))]);
    expect(r.cambios).toHaveLength(2);
    const [v1, v2] = r.cambios.map((c) => c.fila);
    expect(v1).toMatchObject({ numero: 1, estado: 'completa', finTs: min(50), pasoRetornoTs: min(25) });
    expect(v2).toMatchObject({ numero: 2, estado: 'en_curso', inicioTs: min(50), pasoRetornoTs: null });
    expect(r.cambios[1]!.nueva).toBe(true);
    expect(r.infracciones).toEqual([]);
  });

  it('SR → SR sin pasar por Honduras NO cierra la vuelta', () => {
    const r = avanzar(null, [terminal(min(0)), terminal(min(40))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila.estado).toBe('en_curso');
  });

  it('un cumplimiento repetido de la terminal justo después de cerrar no cierra la nueva vuelta', () => {
    const r = avanzar(null, [terminal(min(0)), retorno(min(25)), terminal(min(50)), terminal(min(50))]);
    expect(r.cambios.map((c) => c.fila.numero)).toEqual([1, 2]);
    expect(ultimaDe(r).estado).toBe('en_curso');
  });

  it('un PC sin rol no mueve la máquina', () => {
    expect(avanzar(null, [comun(min(1))]).cambios).toEqual([]);
    expect(avanzar(fila(), [comun(min(1))]).cambios).toEqual([]);
  });

  it('retorno repetido conserva el primero; retorno sin vuelta abierta se ignora', () => {
    const r = avanzar(fila(), [retorno(min(10)), retorno(min(12))]);
    expect(ultimaDe(r).pasoRetornoTs).toEqual(min(10));
    expect(avanzar(null, [retorno(min(1))]).cambios).toEqual([]);
  });

  it('tres vueltas seguidas se numeran 1,2,3 y cada cierre ocurre antes de la apertura siguiente', () => {
    const r = avanzar(null, [
      terminal(min(0)), retorno(min(20)), terminal(min(40)),
      retorno(min(60)), terminal(min(80)),
    ]);
    expect(r.cambios.map((c) => [c.fila.numero, c.fila.estado])).toEqual([
      [1, 'completa'], [2, 'completa'], [3, 'en_curso'],
    ]);
  });
});

describe('avanzarVueltas — fin de recorrido', () => {
  it('fin_recorrido deja la vuelta en curso abierta_al_cierre', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20) }), [fin(min(30))]);
    expect(ultimaDe(r)).toMatchObject({ estado: 'abierta_al_cierre', finTs: min(30) });
  });

  it('un terminal que llega hasta 120 s DESPUÉS del fin (reloj del GNSS vs sistema) igual cierra la vuelta completa y no abre otra', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20) }), [fin(min(30)), terminal(new Date(min(30).getTime() + 100_000))]);
    expect(r.cambios).toHaveLength(1);
    expect(ultimaDe(r)).toMatchObject({ estado: 'completa' });
  });

  it('un terminal más de 120 s después del fin NO abre ni cierra nada (el recorrido terminó)', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20) }), [fin(min(30)), terminal(min(35))]);
    expect(ultimaDe(r).estado).toBe('abierta_al_cierre');
    expect(r.cambios).toHaveLength(1);
  });

  it('después del fin, un inicio_recorrido posterior abre la vuelta siguiente; uno anterior/duplicado no', () => {
    const cerrada = fila({ estado: 'abierta_al_cierre', finTs: min(30), pasoRetornoTs: min(20) });
    const nueva = avanzar(cerrada, [inicio(min(300))]);
    expect(nueva.cambios[0]!.fila).toMatchObject({ numero: 2, estado: 'en_curso' });
    expect(avanzar(cerrada, [inicio(min(10))]).cambios).toEqual([]);
  });

  it('un inicio_recorrido con la vuelta en curso SIN retorno es el mismo recorrido (no hace nada)', () => {
    expect(avanzar(fila(), [inicio(min(5))]).cambios).toEqual([]);
  });

  it('un inicio_recorrido con la vuelta en curso CON retorno es un recorrido nuevo: cierra abierta_al_cierre y abre otra', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20) }), [inicio(min(40))]);
    expect(r.cambios.map((c) => [c.fila.numero, c.fila.estado])).toEqual([[1, 'abierta_al_cierre'], [2, 'en_curso']]);
  });

  it('un fin viejo (anterior a la vuelta actual) no la cierra', () => {
    const r = avanzar(fila({ inicioTs: min(60) }), [fin(min(10))]);
    expect(r.cambios).toEqual([]);
  });
});

describe('avanzarVueltas — Molinos', () => {
  const designada = (parcial: Partial<FilaVuelta> = {}) =>
    fila({ varianteId: 'var-molinos', puntoEsperaId: MOLINOS, pasoRetornoTs: min(20), ...parcial });

  it('la llegada se registra con el cumplimiento del PC de espera durante la vuelta designada', () => {
    const r = avanzar(designada(), [espera(min(30))]);
    expect(ultimaDe(r).esperaLlegadaTs).toEqual(min(30));
  });

  it('sin designación, pasar por el PC de espera no registra llegada', () => {
    expect(avanzar(fila({ pasoRetornoTs: min(20) }), [espera(min(30))]).cambios).toEqual([]);
  });

  it('el cumplimiento de OTRO PC de espera no cuenta como llegada de la variante', () => {
    const otro: EventoVuelta = { clase: 'cumplimiento', ts: min(30), puntoControlId: 'otro', rol: 'espera', lat: 0, lng: 0 };
    expect(avanzar(designada(), [otro]).cambios).toEqual([]);
  });

  it('designada que pasó por Molinos y cierra en SR: sin molinos_omitido', () => {
    const r = avanzar(designada(), [espera(min(30)), terminal(min(70))]);
    expect(r.infracciones).toEqual([]);
    expect(r.cambios[0]!.fila.estado).toBe('completa');
  });

  it('designada que NO pasa por Molinos y cierra en SR genera molinos_omitido (dedupe por vuelta)', () => {
    const r = avanzar(designada({ id: 'v-7', numero: 7 }), [terminal(min(50))]);
    expect(r.infracciones).toEqual([
      expect.objectContaining({
        tipo: 'molinos_omitido',
        vueltaId: 'v-7',
        dedupeKey: 'molinos_omitido:v-7',
        inicioTs: min(50),
        detalle: { vueltaId: 'v-7', numero: 7, varianteId: 'var-molinos' },
      }),
    ]);
  });

  it('una vuelta directa (sin designación) que cierra en SR no genera molinos_omitido', () => {
    expect(avanzar(fila({ pasoRetornoTs: min(20) }), [terminal(min(50))]).infracciones).toEqual([]);
  });

  it('la designación que llega con la vuelta ya cerrada cae en la vuelta nueva (no se evalúa la anterior)', () => {
    // La vuelta 1 cerró sin designación; la designada es la 2.
    const r1 = avanzar(null, [terminal(min(0)), retorno(min(20)), terminal(min(40))]);
    expect(r1.infracciones).toEqual([]);
    const v2 = { ...ultimaDe(r1), varianteId: 'var-molinos', puntoEsperaId: MOLINOS };
    const r2 = avanzar(v2, [retorno(min(60)), terminal(min(80))]);
    expect(r2.infracciones).toHaveLength(1);
    expect(r2.infracciones[0]!.vueltaId).toBe(v2.id);
  });
});

describe('avanzarVueltas — eventos tardíos o desordenados', () => {
  it('dentro del lote el orden de llegada no importa: se ordena por ts', () => {
    const r = avanzar(null, [terminal(min(50)), retorno(min(25)), terminal(min(0))]);
    expect(r.cambios.map((c) => [c.fila.numero, c.fila.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
  });

  it('un cumplimiento anterior al inicio de la vuelta actual (tardío) no mueve la máquina', () => {
    const actual = fila({ numero: 3, inicioTs: min(100) });
    expect(avanzar(actual, [retorno(min(20)), terminal(min(30))]).cambios).toEqual([]);
  });

  it('reprocesar el mismo lote es inocuo (idempotente)', () => {
    const lote = [terminal(min(0)), retorno(min(25)), terminal(min(50))];
    const primero = avanzar(null, lote);
    const estado = ultimaDe(primero);
    const otraVez = avanzar(estado, lote);
    expect(otraVez.cambios).toEqual([]);
    expect(otraVez.infracciones).toEqual([]);
  });

  it('un retorno que llega tarde (después de Molinos) igual se aplica mientras la vuelta siga en curso', () => {
    const actual = fila({ varianteId: 'v', puntoEsperaId: MOLINOS, esperaLlegadaTs: min(30) });
    expect(ultimaDe(avanzar(actual, [retorno(min(20))])).pasoRetornoTs).toEqual(min(20));
  });
});

describe('detectarSalidaEspera / resolverEspera', () => {
  const RADIO = 150;
  const LLEGADA = min(0);
  // distanciaM > 180 = fuera (radio + 30 m).
  const fix = (s: number, distanciaM: number, accuracy: number | null = 5): FixEspera => ({
    ts: new Date(LLEGADA.getTime() + s * 1000), lat: -17.6, lng: -66.0, accuracy, distanciaM,
  });

  it('la salida es el primero de dos fixes consecutivos fuera de radio + 30 m', () => {
    const s = detectarSalidaEspera(LLEGADA, [fix(10, 50), fix(60, 200), fix(90, 400)], RADIO);
    expect(s?.ts).toEqual(new Date(LLEGADA.getTime() + 60_000));
  });

  it('un solo fix fuera (salto de GPS) o la franja radio..radio+30 no cuentan', () => {
    expect(detectarSalidaEspera(LLEGADA, [fix(60, 200), fix(90, 100)], RADIO)).toBeNull();
    expect(detectarSalidaEspera(LLEGADA, [fix(60, 170), fix(90, 175)], RADIO)).toBeNull();
  });

  it('un fix dentro corta la racha', () => {
    expect(detectarSalidaEspera(LLEGADA, [fix(10, 200), fix(20, 50), fix(30, 200)], RADIO)).toBeNull();
  });

  it('los fixes imprecisos (accuracy > 30 m) se ignoran sin cortar ni sumar', () => {
    const s = detectarSalidaEspera(LLEGADA, [fix(10, 200), fix(20, 500, 80), fix(30, 220)], RADIO);
    expect(s?.ts).toEqual(new Date(LLEGADA.getTime() + 10_000));
    expect(detectarSalidaEspera(LLEGADA, [fix(10, 200, 80), fix(20, 220, 80)], RADIO)).toBeNull();
  });

  it('ignora fixes anteriores a la llegada y los posteriores al tope', () => {
    expect(detectarSalidaEspera(LLEGADA, [fix(-30, 300), fix(-20, 300)], RADIO)).toBeNull();
    const hasta = new Date(LLEGADA.getTime() + 30_000);
    expect(detectarSalidaEspera(LLEGADA, [fix(60, 300), fix(90, 300)], RADIO, hasta)).toBeNull();
  });

  const vuelta = (parcial: Partial<FilaVuelta> = {}) => ({
    id: 'v-1', varianteId: 'var', esperaLlegadaTs: LLEGADA, esperaSalidaTs: null, ...parcial,
  });
  const fixesSalida = (minutos: number) => [fix(60, 20), fix(minutos * 60, 300), fix(minutos * 60 + 20, 400)];

  it('vía Molinos con 35 min de espera: NO hay alerta', () => {
    const r = resolverEspera(vuelta(), fixesSalida(35), { radioM: RADIO, esperaMin: 30 });
    expect(r?.esperaSalidaTs).toEqual(new Date(LLEGADA.getTime() + 35 * 60_000));
    expect(r?.infraccion).toBeNull();
  });

  it('esperó justo los 30 min: NO hay alerta', () => {
    expect(resolverEspera(vuelta(), fixesSalida(30), { radioM: RADIO, esperaMin: 30 })?.infraccion).toBeNull();
  });

  it('con 20 min de espera: espera_corta con detalle {esperaMin, requeridoMin}', () => {
    const r = resolverEspera(vuelta(), fixesSalida(20), { radioM: RADIO, esperaMin: 30 });
    expect(r?.infraccion).toMatchObject({
      tipo: 'espera_corta',
      vueltaId: 'v-1',
      dedupeKey: 'espera_corta:v-1',
      detalle: { esperaMin: 20, requeridoMin: 30, vueltaId: 'v-1' },
    });
  });

  it('29 min 40 s cuenta como 29 (hacia abajo) y sigue siendo alerta', () => {
    const fixes = [fix(29 * 60 + 40, 300), fix(29 * 60 + 60, 400)];
    const r = resolverEspera(vuelta(), fixes, { radioM: RADIO, esperaMin: 30 });
    expect(r?.infraccion?.detalle).toMatchObject({ esperaMin: 29, requeridoMin: 30 });
  });

  it('sin salida confirmada, sin designación, sin llegada o con salida ya resuelta: null', () => {
    expect(resolverEspera(vuelta(), [fix(60, 20)], { radioM: RADIO, esperaMin: 30 })).toBeNull();
    expect(resolverEspera(vuelta({ varianteId: null }), fixesSalida(20), { radioM: RADIO, esperaMin: 30 })).toBeNull();
    expect(resolverEspera(vuelta({ esperaLlegadaTs: null }), fixesSalida(20), { radioM: RADIO, esperaMin: 30 })).toBeNull();
    expect(resolverEspera(vuelta({ esperaSalidaTs: min(1) }), fixesSalida(20), { radioM: RADIO, esperaMin: 30 })).toBeNull();
  });
});
