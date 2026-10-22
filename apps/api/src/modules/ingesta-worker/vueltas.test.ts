import { describe, expect, it } from 'vitest';
import {
  avanzarSalidaEspera,
  avanzarVueltas,
  cerrarEspera,
  crearEstadoSalidaEspera,
  cursorSalidaEspera,
  inicioVentanaEspera,
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
const inicio = (ts: Date, enTerminal?: boolean): EventoVuelta => ({ clase: 'inicio', ts, enTerminal });
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
    ultimoPcTs: null,
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

  it('un PC sin rol no abre/cierra vueltas (solo deja constancia en ultimoPcTs de la en curso)', () => {
    expect(avanzar(null, [comun(min(1))]).cambios).toEqual([]);
    const r = avanzar(fila(), [comun(min(1))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ estado: 'en_curso', pasoRetornoTs: null, ultimoPcTs: min(1) });
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

describe('avanzarVueltas — vueltas vacías (fin de recorrido normal)', () => {
  /** Vueltas que quedan realmente en la base tras aplicar los cambios (sin las eliminadas). */
  const persistidas = (r: ReturnType<typeof avanzar>) => r.cambios.filter((c) => !c.eliminada);

  it('la terminal cierra N y abre N+1; el fin 30 s después ELIMINA la N+1 vacía: no queda vuelta de más', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20), ultimoPcTs: min(20) }), [terminal(min(50)), fin(seg(50 * 60 + 30))]);
    expect(r.cambios.map((c) => [c.fila.numero, c.fila.estado, c.nueva, !!c.eliminada])).toEqual([
      [1, 'completa', false, false],
      [2, 'abierta_al_cierre', true, true],
    ]);
    // Solo la vuelta 1 (completa) llega a la base; la 2 nueva+eliminada ni se inserta.
    expect(persistidas(r).map((c) => [c.fila.numero, c.fila.estado])).toEqual([[1, 'completa']]);
    expect(r.infracciones).toEqual([]);
  });

  it('fin 60 s ANTES del terminal (tolerancia de 120 s): la vuelta N+1 ya abierta se elimina, no queda vuelta de más', () => {
    // La terminal ya abrió la vuelta 2 en un lote anterior; el fin llega tarde con ts 60 s previo.
    const abiertaPorTerminal = fila({ id: 'v-2', numero: 2, inicioTs: min(50) });
    const r = avanzar(abiertaPorTerminal, [fin(seg(50 * 60 - 60))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]).toMatchObject({ nueva: false, eliminada: true });
    expect(r.cambios[0]!.fila.id).toBe('v-2');
  });

  it('en el mismo lote: fin 60 s antes del terminal cierra la N completa y no abre ni deja otra', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20), ultimoPcTs: min(20) }), [fin(seg(50 * 60 - 60)), terminal(min(50))]);
    expect(persistidas(r).map((c) => [c.fila.numero, c.fila.estado])).toEqual([[1, 'completa']]);
    expect(r.cambios.some((c) => c.eliminada)).toBe(false);
  });

  it('tras eliminar la vacía, el inicio_recorrido siguiente reutiliza el número (sin huecos)', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20), ultimoPcTs: min(20) }), [
      terminal(min(50)), fin(min(51)), inicio(min(300)),
    ]);
    const vivas = persistidas(r).map((c) => [c.fila.numero, c.fila.estado]);
    expect(vivas).toEqual([[1, 'completa'], [2, 'en_curso']]);
  });

  it('una vuelta con retorno, con otro PC o designada NO es vacía: el fin la deja abierta_al_cierre', () => {
    const conRetorno = avanzar(fila({ pasoRetornoTs: min(20) }), [fin(min(30))]);
    expect(conRetorno.cambios[0]).toMatchObject({ eliminada: false });
    expect(conRetorno.cambios[0]!.fila.estado).toBe('abierta_al_cierre');
    const conComun = avanzar(fila(), [comun(min(10)), fin(min(30))]);
    expect(conComun.cambios[0]!.fila).toMatchObject({ estado: 'abierta_al_cierre', ultimoPcTs: min(10) });
    expect(conComun.cambios[0]!.eliminada).toBe(false);
    const designada = avanzar(fila({ varianteId: 'var-molinos', puntoEsperaId: MOLINOS }), [fin(min(30))]);
    expect(designada.cambios[0]!.eliminada).toBe(false);
    expect(designada.cambios[0]!.fila.estado).toBe('abierta_al_cierre');
  });
});

describe('avanzarVueltas — Molinos', () => {
  const designada = (parcial: Partial<FilaVuelta> = {}) =>
    fila({ varianteId: 'var-molinos', puntoEsperaId: MOLINOS, pasoRetornoTs: min(20), ...parcial });

  it('la llegada se registra con el cumplimiento del PC de espera durante la vuelta designada', () => {
    const r = avanzar(designada(), [espera(min(30))]);
    expect(ultimaDe(r).esperaLlegadaTs).toEqual(min(30));
  });

  it('sin designación, pasar por el PC de espera no registra llegada pero SÍ cuenta como progreso (ultimoPcTs)', () => {
    const r = avanzar(fila({ pasoRetornoTs: min(20) }), [espera(min(30))]);
    expect(ultimaDe(r)).toMatchObject({ esperaLlegadaTs: null, ultimoPcTs: min(30) });
    // También en una vuelta sin retorno (no vacía: el fin la deja abierta_al_cierre, no la elimina).
    const r2 = avanzar(fila(), [espera(min(30)), fin(min(40))]);
    expect(ultimaDe(r2)).toMatchObject({ estado: 'abierta_al_cierre', ultimoPcTs: min(30) });
    expect(r2.cambios[0]!.eliminada).toBeFalsy();
  });

  it('el cumplimiento de OTRO PC de espera no cuenta como llegada de la variante', () => {
    const otro: EventoVuelta = { clase: 'cumplimiento', ts: min(30), puntoControlId: 'otro', rol: 'espera', lat: 0, lng: 0 };
    const r = avanzar(designada(), [otro]);
    expect(ultimaDe(r)).toMatchObject({ esperaLlegadaTs: null, ultimoPcTs: min(30) });
  });

  it('designada con la variante SIN puntoEsperaId (dato inconsistente): ningún PC de espera cuenta como llegada', () => {
    const r = avanzar(designada({ puntoEsperaId: null }), [espera(min(30))]);
    expect(ultimaDe(r)).toMatchObject({ esperaLlegadaTs: null, ultimoPcTs: min(30) });
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

  it('designada sin llegada a Molinos y cerrada por fin_recorrido: molinos_omitido (sin posición, la completa el worker)', () => {
    const r = avanzar(designada({ id: 'v-8', numero: 8 }), [fin(min(40))]);
    expect(r.cambios[0]!.fila.estado).toBe('abierta_al_cierre');
    expect(r.infracciones).toEqual([
      expect.objectContaining({
        tipo: 'molinos_omitido',
        vueltaId: 'v-8',
        dedupeKey: 'molinos_omitido:v-8',
        inicioTs: min(40),
        lat: null,
        lng: null,
        detalle: { vueltaId: 'v-8', numero: 8, varianteId: 'var-molinos' },
      }),
    ]);
  });

  it('designada sin llegada y cerrada por un inicio_recorrido nuevo: molinos_omitido', () => {
    const r = avanzar(designada({ id: 'v-9', numero: 9 }), [inicio(min(45))]);
    expect(r.cambios.map((c) => [c.fila.numero, c.fila.estado])).toEqual([[9, 'abierta_al_cierre'], [10, 'en_curso']]);
    expect(r.infracciones.map((i) => i.vueltaId)).toEqual(['v-9']);
  });

  it('designada que SÍ pasó por Molinos y cierra por fin_recorrido: sin molinos_omitido', () => {
    const r = avanzar(designada({ esperaLlegadaTs: min(30) }), [fin(min(60))]);
    expect(r.infracciones).toEqual([]);
  });

  it('designada, fin_recorrido y terminal tardío (misma vuelta): una sola infracción por la dedupeKey', () => {
    const r = avanzar(designada({ id: 'v-7', numero: 7 }), [fin(min(40)), terminal(seg(40 * 60 + 30))]);
    expect(r.cambios[0]!.fila.estado).toBe('completa');
    expect(new Set(r.infracciones.map((i) => i.dedupeKey)).size).toBe(1);
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

describe('avanzarVueltas — primera vuelta y recorrido en curso', () => {
  it('sin vuelta previa y con el recorrido terminado, un terminal NO reabre una vuelta (bus estacionado)', () => {
    const r = avanzarVueltas(null, [terminal(min(60))], { nuevoId, recorridoEnCurso: false });
    expect(r.cambios).toEqual([]);
  });

  it('un inicio_recorrido del lote reactiva el recorrido: el terminal posterior ya no se ignora (y no duplica)', () => {
    const r = avanzarVueltas(null, [inicio(min(60)), terminal(min(61))], { nuevoId, recorridoEnCurso: false });
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 1, inicioTs: min(60), estado: 'en_curso' });
  });

  it('un fin del lote apaga el recorrido: terminal tras el fin, sin vuelta, no abre', () => {
    const r = avanzarVueltas(null, [fin(min(10)), terminal(min(20))], { nuevoId, recorridoEnCurso: true });
    expect(r.cambios).toEqual([]);
  });

  it('por defecto (recorrido desconocido = en curso) el terminal abre la primera vuelta', () => {
    expect(avanzar(null, [terminal(min(1))]).cambios).toHaveLength(1);
  });
});

describe('avanzarVueltas — ancla en la terminal (vuelta = terminal → terminal)', () => {
  const anclado = (ultima: FilaVuelta | null, eventos: EventoVuelta[], recorridoEnCurso = true) =>
    avanzarVueltas(ultima, eventos, { nuevoId, anclaEnTerminal: true, recorridoEnCurso });

  it('inicio lejos, retorno y luego terminal: ninguna vuelta completa; la 1 abre en el terminal', () => {
    const r = anclado(null, [inicio(min(0)), retorno(min(10)), terminal(min(20))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 1, estado: 'en_curso', inicioTs: min(20), pasoRetornoTs: null });
    expect(r.cambios.some((c) => c.fila.estado === 'completa')).toBe(false);
  });

  it('inicio y luego terminal (arranca en SR): la vuelta 1 abre en el terminal', () => {
    const r = anclado(null, [inicio(min(0)), terminal(min(1))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 1, inicioTs: min(1) });
  });

  it('inicio enTerminal sin vuelta abre en el inicio (FIN -> COMENZAR parado en la terminal)', () => {
    const r = anclado(null, [inicio(min(0), true)]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 1, estado: 'en_curso', inicioTs: min(0) });
  });

  it('terminal -> retorno -> terminal -> fin -> inicio enTerminal: la vuelta vacía 2 se elimina y la nueva reutiliza el 2 (sin hueco)', () => {
    const r1 = anclado(null, [inicio(min(0)), terminal(min(1)), retorno(min(10)), terminal(min(20))]);
    const r2 = anclado(ultimaDe(r1), [fin(min(21)), inicio(min(25), true)], true);
    expect(r2.cambios.find((c) => c.eliminada)?.fila.numero).toBe(2);
    expect(ultimaDe(r2)).toMatchObject({ numero: 2, estado: 'en_curso', inicioTs: min(25) });
  });

  it('inicio lejos (enTerminal false/undefined) sigue sin abrir', () => {
    expect(anclado(null, [inicio(min(0), false)]).cambios).toEqual([]);
  });

  it('inicio solo no abre vuelta', () => {
    expect(anclado(null, [inicio(min(0))]).cambios).toEqual([]);
  });

  it('tras el anclaje, terminal -> retorno -> terminal cierra completa y abre la 2', () => {
    const r = anclado(null, [inicio(min(0)), terminal(min(1)), retorno(min(10)), terminal(min(20))]);
    const ult = ultimaDe(r);
    expect(ult).toMatchObject({ numero: 2, estado: 'en_curso', inicioTs: min(20) });
    expect(r.cambios.find((c) => c.fila.numero === 1)!.fila).toMatchObject({ estado: 'completa', finTs: min(20) });
  });

  it('inicio con vuelta en curso con retorno: la deja abierta_al_cierre y no abre otra hasta el terminal', () => {
    const r1 = anclado(fila({ pasoRetornoTs: min(10), ultimoPcTs: min(10) }), [inicio(min(30))]);
    expect(r1.cambios).toHaveLength(1);
    expect(r1.cambios[0]!.fila).toMatchObject({ estado: 'abierta_al_cierre', finTs: min(30) });
    const r2 = anclado(fila({ pasoRetornoTs: min(10), ultimoPcTs: min(10) }), [inicio(min(30)), retorno(min(35)), terminal(min(40))]);
    expect(r2.cambios).toHaveLength(2);
    expect(ultimaDe(r2)).toMatchObject({ numero: 2, estado: 'en_curso', inicioTs: min(40) });
  });

  it('inicio tras un fin (vuelta abierta_al_cierre de un lote anterior): el terminal siguiente abre la N+1', () => {
    const previa = fila({ estado: 'abierta_al_cierre', finTs: min(30), pasoRetornoTs: min(10), ultimoPcTs: min(10) });
    const r = anclado(previa, [inicio(min(60)), terminal(min(70))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 2, inicioTs: min(70), estado: 'en_curso' });
  });

  it('inicio tras una vuelta completa (la N+1 vacía se eliminó): el terminal siguiente abre la N+1', () => {
    const previa = fila({ estado: 'completa', finTs: min(30), pasoRetornoTs: min(10) });
    const r = anclado(previa, [inicio(min(60)), terminal(min(70))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ numero: 2, inicioTs: min(70) });
  });

  it('terminal tras el fin con el recorrido terminado no reabre (bus estacionado)', () => {
    const previa = fila({ estado: 'abierta_al_cierre', finTs: min(30), pasoRetornoTs: min(10), ultimoPcTs: min(10) });
    expect(anclado(previa, [terminal(min(60))], false).cambios).toEqual([]);
  });

  it('PC común y espera antes del terminal se ignoran: sin vuelta ni ultimoPcTs', () => {
    const r = anclado(null, [inicio(min(0)), comun(min(2)), espera(min(4)), terminal(min(10))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ inicioTs: min(10), ultimoPcTs: null });
  });
});

describe('avanzarVueltas — cierre tardío (sesión ya cerrada)', () => {
  const CIERRE = min(60);
  const cerrada = (parcial: Partial<FilaVuelta> = {}) =>
    fila({ estado: 'abierta_al_cierre', finTs: CIERRE, pasoRetornoTs: min(20), ...parcial });
  const tardio = (ultima: FilaVuelta | null, eventos: EventoVuelta[]) =>
    avanzarVueltas(ultima, eventos, { nuevoId, cierreTardio: { cierreTs: CIERRE } });

  it('un terminal con retorno, anterior al cierre, cierra la vuelta completa en ese ts y NO abre la N+1', () => {
    const r = tardio(cerrada(), [terminal(min(50))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.fila).toMatchObject({ estado: 'completa', finTs: min(50) });
    expect(r.cambios[0]!.nueva).toBe(false);
  });

  it('retorno, llegada a la espera y ultimoPcTs se aplican; sin terminal sigue abierta_al_cierre con su finTs', () => {
    const r = tardio(cerrada({ pasoRetornoTs: null, varianteId: 'var-molinos', puntoEsperaId: MOLINOS }), [
      retorno(min(20)),
      espera(min(30)),
    ]);
    expect(ultimaDe(r)).toMatchObject({
      estado: 'abierta_al_cierre',
      finTs: CIERRE,
      pasoRetornoTs: min(20),
      esperaLlegadaTs: min(30),
      ultimoPcTs: min(30),
    });
  });

  it('el terminal tardío de una designada sin llegada emite molinos_omitido', () => {
    const r = tardio(cerrada({ varianteId: 'var-molinos', puntoEsperaId: MOLINOS }), [terminal(min(50))]);
    expect(ultimaDe(r).estado).toBe('completa');
    expect(r.infracciones.map((i) => i.tipo)).toEqual(['molinos_omitido']);
  });

  it('ignora lo posterior al cierre + tolerancia y lo anterior al inicio de la vuelta', () => {
    expect(tardio(cerrada(), [terminal(seg(60 * 60 + 130))]).cambios).toEqual([]);
    expect(tardio(cerrada({ inicioTs: min(10) }), [retorno(min(5)), terminal(min(5))]).cambios).toEqual([]);
  });

  it('un terminal 20 s después del cierre (GNSS vs servidor, tolerancia de 120 s) se acepta', () => {
    const r = tardio(cerrada(), [terminal(seg(60 * 60 + 20))]);
    expect(ultimaDe(r)).toMatchObject({ estado: 'completa', finTs: seg(60 * 60 + 20) });
    expect(r.cambios).toHaveLength(1);
  });

  it('nunca abre: sin vuelta o con una completa no hace nada, ni por terminal ni por inicio', () => {
    expect(tardio(null, [terminal(min(30)), inicio(min(31))]).cambios).toEqual([]);
    expect(tardio(cerrada({ estado: 'completa' }), [terminal(min(50)), inicio(min(51))]).cambios).toEqual([]);
  });

  it('un terminal SIN retorno no cierra; la vuelta vacía NO se elimina (un lote posterior aún podría traer su avance)', () => {
    const r = tardio(cerrada({ pasoRetornoTs: null }), [terminal(min(50))]);
    expect(r.cambios).toEqual([]);
    // Ningún lote tardío elimina nunca una vuelta, tenga o no avance.
    expect(tardio(cerrada({ pasoRetornoTs: null }), [comun(min(30))]).cambios.some((c) => c.eliminada)).toBe(false);
  });

  it('no cerrada en el lote: finTs = max(cierre, hitos aplicados) y la fila se sigue reconociendo como la del trigger', () => {
    // Retorno + PC común a los 62 y 64 min (dentro de la tolerancia de 120 s tras el cierre a los 60).
    const r1 = tardio(cerrada({ pasoRetornoTs: null }), [retorno(seg(60 * 60 + 62)), comun(seg(60 * 60 + 64))]);
    expect(ultimaDe(r1)).toMatchObject({ estado: 'abierta_al_cierre', finTs: seg(60 * 60 + 64) });
    expect(ultimaDe(r1).finTs!.getTime()).toBeGreaterThanOrEqual(ultimaDe(r1).pasoRetornoTs!.getTime());
    // Un hito anterior al cierre no baja el finTs.
    const r2 = tardio(cerrada({ pasoRetornoTs: null }), [retorno(min(20))]);
    expect(ultimaDe(r2)).toMatchObject({ estado: 'abierta_al_cierre', finTs: CIERRE });
    // Con finTs elevado (lote anterior) el siguiente lote tardío la reabre y la cierra completa.
    const elevada = ultimaDe(r1);
    const r3 = tardio(elevada, [terminal(seg(60 * 60 + 70))]);
    expect(ultimaDe(r3)).toMatchObject({ estado: 'completa', finTs: seg(60 * 60 + 70) });
    // También considera los hitos ya guardados de lotes anteriores.
    const r4 = tardio(cerrada({ ultimoPcTs: seg(60 * 60 + 70), esperaLlegadaTs: seg(60 * 60 + 90) }), [comun(min(10))]);
    expect(ultimaDe(r4).finTs).toEqual(seg(60 * 60 + 90));
  });

  it('un lote tardío sin eventos aplicables (todos posteriores al cierre) deja la vuelta vacía tal cual: no la toca', () => {
    expect(tardio(cerrada({ pasoRetornoTs: null }), []).cambios).toEqual([]);
  });

  it('fin a las :00 y terminal :20 en el mismo lote tardío: abierta_al_cierre con finTs del fin, no completa', () => {
    const r = tardio(cerrada({ pasoRetornoTs: min(5) }), [fin(min(30)), terminal(min(50))]);
    expect(ultimaDe(r)).toMatchObject({ estado: 'abierta_al_cierre', finTs: min(30) });
    expect(r.cambios).toHaveLength(1);
  });

  it('inicio_recorrido tras el retorno en modo tardío cierra la abierta_al_cierre y NO abre otra', () => {
    const r = tardio(cerrada(), [inicio(min(30))]);
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.nueva).toBe(false);
    expect(ultimaDe(r)).toMatchObject({ estado: 'abierta_al_cierre', finTs: min(30) });
  });

  it('fin + terminal a 1 min + logout a 2 min, procesado tarde: completa (rama normal de abierta_al_cierre)', () => {
    const cierre = seg(60 * 60 + 120);
    // El trigger cerró la vuelta con el logout (finTs = cierre); el fin y el terminal llegan tarde.
    const r = avanzarVueltas(
      cerrada({ finTs: cierre }),
      [fin(seg(60 * 60)), terminal(seg(60 * 60 + 60))],
      { nuevoId, cierreTardio: { cierreTs: cierre } },
    );
    expect(ultimaDe(r)).toMatchObject({ estado: 'completa', finTs: seg(60 * 60 + 60) });
  });

  it('abierta_al_cierre por un fin_recorrido anterior (finTs != cierre) no se reabre: el terminal en tolerancia la cierra completa', () => {
    const r = tardio(cerrada({ finTs: min(30) }), [terminal(seg(30 * 60 + 60))]);
    expect(ultimaDe(r)).toMatchObject({ estado: 'completa', finTs: seg(30 * 60 + 60) });
    // Más allá de la tolerancia del fin, no.
    expect(tardio(cerrada({ finTs: min(30) }), [terminal(min(50))]).cambios).toEqual([]);
  });
});

describe('salida de la espera (camino de producción: avanzarSalidaEspera / cerrarEspera)', () => {
  const RADIO = 150;
  const LLEGADA = min(0);
  // distanciaM > 180 = fuera (radio + 30 m).
  const fix = (s: number, distanciaM: number, accuracy: number | null = 5): FixEspera => ({
    ts: new Date(LLEGADA.getTime() + s * 1000), lat: -17.6, lng: -66.0, accuracy, distanciaM,
  });

  const salidaDe = (fixes: readonly FixEspera[], hasta: Date | null = null) =>
    avanzarSalidaEspera(crearEstadoSalidaEspera(), fixes, { llegadaTs: LLEGADA, radioM: RADIO, hastaTs: hasta });

  it('la salida es el primero de dos fixes consecutivos fuera de radio + 30 m', () => {
    const s = salidaDe([fix(10, 50), fix(60, 200), fix(90, 400)]);
    expect(s?.ts).toEqual(new Date(LLEGADA.getTime() + 60_000));
  });

  it('un solo fix fuera (salto de GPS) o la franja radio..radio+30 no cuentan', () => {
    expect(salidaDe([fix(60, 200), fix(90, 100)])).toBeNull();
    expect(salidaDe([fix(60, 170), fix(90, 175)])).toBeNull();
  });

  it('un fix dentro corta la racha', () => {
    expect(salidaDe([fix(10, 200), fix(20, 50), fix(30, 200)])).toBeNull();
  });

  it('los fixes imprecisos (accuracy > 30 m) se ignoran sin cortar ni sumar', () => {
    const s = salidaDe([fix(10, 200), fix(20, 500, 80), fix(30, 220)]);
    expect(s?.ts).toEqual(new Date(LLEGADA.getTime() + 10_000));
    expect(salidaDe([fix(10, 200, 80), fix(20, 220, 80)])).toBeNull();
  });

  it('un fix duplicado (mismo ts y posición) nunca suma dos veces a la racha', () => {
    expect(salidaDe([fix(60, 200), fix(60, 200)])).toBeNull();
    expect(salidaDe([fix(60, 200), fix(60, 200), fix(90, 220)])?.ts).toEqual(
      new Date(LLEGADA.getTime() + 60_000),
    );
  });

  it('evaluar por páginas equivale a evaluar todo junto (el estado de la racha pasa de una página a otra)', () => {
    const todos = [fix(10, 50), fix(60, 200), fix(90, 400), fix(120, 500)];
    const estado = crearEstadoSalidaEspera();
    const params = { llegadaTs: LLEGADA, radioM: RADIO };
    expect(avanzarSalidaEspera(estado, todos.slice(0, 2), params)).toBeNull();
    expect(estado.racha).toBe(1);
    expect(avanzarSalidaEspera(estado, todos.slice(2), params)?.ts).toEqual(new Date(LLEGADA.getTime() + 60_000));
    // Un duplicado en el borde de página tampoco suma.
    const e2 = crearEstadoSalidaEspera();
    avanzarSalidaEspera(e2, [fix(60, 200)], params);
    expect(avanzarSalidaEspera(e2, [fix(60, 200)], params)).toBeNull();
  });

  describe('cursor y ventana de la espera pendiente', () => {
    const MARGEN = 120_000;
    const params = { llegadaTs: LLEGADA, radioM: RADIO };

    it('el cursor es el último fix válido que cerró una racha (quedó dentro del radio)', () => {
      const e = crearEstadoSalidaEspera();
      avanzarSalidaEspera(e, [fix(10, 50), fix(20, 60), fix(25, 900, 80)], params);
      expect(cursorSalidaEspera(e)).toEqual(new Date(LLEGADA.getTime() + 20_000));
      expect(cursorSalidaEspera(crearEstadoSalidaEspera())).toBeNull();
    });

    it('con una racha fuera de radio en curso (sin confirmar) el cursor queda justo ANTES de su primer fix', () => {
      const e = crearEstadoSalidaEspera();
      expect(avanzarSalidaEspera(e, [fix(10, 50), fix(60, 300)], params)).toBeNull();
      expect(cursorSalidaEspera(e)).toEqual(new Date(LLEGADA.getTime() + 60_000 - 1));
    });

    it('ventana = max(llegada, min(cursor, mínimo GPS del lote) - margen); sin cursor, desde la llegada', () => {
      const cursor = new Date(LLEGADA.getTime() + 10 * 60_000);
      const gpsMin = new Date(LLEGADA.getTime() + 4 * 60_000);
      const ventana = (p: { cursor: Date | null; gpsMinTs: Date | null }) =>
        inicioVentanaEspera({ llegadaTs: LLEGADA, margenMs: MARGEN, ...p });
      expect(ventana({ cursor, gpsMinTs: null })).toEqual(new Date(cursor.getTime() - MARGEN));
      expect(ventana({ cursor, gpsMinTs: gpsMin })).toEqual(new Date(gpsMin.getTime() - MARGEN));
      expect(ventana({ cursor, gpsMinTs: new Date(cursor.getTime() + 60_000) })).toEqual(new Date(cursor.getTime() - MARGEN));
      expect(ventana({ cursor: new Date(LLEGADA.getTime() + 30_000), gpsMinTs: null })).toEqual(LLEGADA);
      expect(ventana({ cursor: null, gpsMinTs: gpsMin })).toEqual(LLEGADA);
    });

    it('fixes confirmados fuera de orden: un lote más viejo procesado DESPUÉS de uno más nuevo igual detecta la salida', () => {
      // Lote nuevo (ya procesado): fix a 10 min, dentro del radio → cursor = 10 min.
      const nuevo = crearEstadoSalidaEspera();
      avanzarSalidaEspera(nuevo, [fix(600, 40)], params);
      const cursor = cursorSalidaEspera(nuevo)!;
      // Llega el lote viejo (fixes a 100 s y 130 s fuera del radio = salida a los 100 s).
      const viejos = [fix(100, 300), fix(130, 400)];
      const todos = [...viejos, fix(600, 40)];
      const desde = (gpsMinTs: Date | null) => inicioVentanaEspera({ llegadaTs: LLEGADA, cursor, gpsMinTs, margenMs: MARGEN });
      const leer = (ventana: Date) => todos.filter((f) => f.ts.getTime() >= ventana.getTime());
      // Sin el mínimo del lote la ventana arranca en cursor - margen y se pierde la salida...
      expect(salidaDe(leer(desde(null)))).toBeNull();
      // ...con el mínimo GPS del lote retrocede y la encuentra.
      expect(salidaDe(leer(desde(viejos[0]!.ts)))?.ts).toEqual(viejos[0]!.ts);
    });
  });

  it('ignora fixes anteriores a la llegada y los posteriores al tope', () => {
    expect(salidaDe([fix(-30, 300), fix(-20, 300)])).toBeNull();
    const hasta = new Date(LLEGADA.getTime() + 30_000);
    expect(salidaDe([fix(60, 300), fix(90, 300)], hasta)).toBeNull();
  });

  const vuelta = { id: 'v-1', esperaLlegadaTs: LLEGADA };
  const fixesSalida = (minutos: number) => [fix(60, 20), fix(minutos * 60, 300), fix(minutos * 60 + 20, 400)];
  // Mismo camino que el worker: salida confirmada (estado incremental) y luego `cerrarEspera`.
  const resolver = (fixes: FixEspera[], esperaMin: number) => {
    const salida = salidaDe(fixes);
    return salida ? cerrarEspera(vuelta, salida, esperaMin) : null;
  };

  it('vía Molinos con 35 min de espera: NO hay alerta', () => {
    const r = resolver(fixesSalida(35), 30);
    expect(r?.esperaSalidaTs).toEqual(new Date(LLEGADA.getTime() + 35 * 60_000));
    expect(r?.infraccion).toBeNull();
  });

  it('esperó justo los 30 min: NO hay alerta', () => {
    expect(resolver(fixesSalida(30), 30)?.infraccion).toBeNull();
  });

  it('con 20 min de espera: espera_corta con detalle {esperaMin, requeridoMin}', () => {
    const r = resolver(fixesSalida(20), 30);
    expect(r?.infraccion).toMatchObject({
      tipo: 'espera_corta',
      vueltaId: 'v-1',
      dedupeKey: 'espera_corta:v-1',
      detalle: { esperaMin: 20, requeridoMin: 30, vueltaId: 'v-1' },
    });
  });

  it('salida libre (esperaMin null): cierra la espera y no hay alerta aunque salga al instante', () => {
    const salida = salidaDe([fix(60, 20), fix(120, 300), fix(140, 400)]);
    const r = cerrarEspera(vuelta, salida!, null);
    expect(r.esperaSalidaTs).toEqual(new Date(LLEGADA.getTime() + 120_000));
    expect(r.infraccion).toBeNull();
  });

  it('29 min 40 s cuenta como 29 (hacia abajo) y sigue siendo alerta', () => {
    const r = resolver([fix(29 * 60 + 40, 300), fix(29 * 60 + 60, 400)], 30);
    expect(r?.infraccion?.detalle).toMatchObject({ esperaMin: 29, requeridoMin: 30 });
  });

  it('sin salida confirmada (hueco de GPS) no hay cierre ni alerta', () => {
    expect(resolver([fix(60, 20)], 30)).toBeNull();
  });

  it('multi-página incremental: la racha cruza páginas, el cursor no pasa del primer fix y cerrarEspera da la alerta', () => {
    const paginas = [
      [fix(60, 20), fix(10 * 60, 30)],
      [fix(20 * 60, 300)], // primero de la racha, sin confirmar
      [fix(20 * 60 + 20, 400), fix(21 * 60, 500)], // confirma la salida
    ];
    const estado = crearEstadoSalidaEspera();
    const params = { llegadaTs: LLEGADA, radioM: RADIO };
    expect(avanzarSalidaEspera(estado, paginas[0]!, params)).toBeNull();
    expect(cursorSalidaEspera(estado)).toEqual(new Date(LLEGADA.getTime() + 10 * 60_000));
    expect(avanzarSalidaEspera(estado, paginas[1]!, params)).toBeNull();
    expect(cursorSalidaEspera(estado)).toEqual(new Date(LLEGADA.getTime() + 20 * 60_000 - 1));
    const salida = avanzarSalidaEspera(estado, paginas[2]!, params);
    expect(salida?.ts).toEqual(new Date(LLEGADA.getTime() + 20 * 60_000));
    const cierre = cerrarEspera(vuelta, salida!, 30);
    expect(cierre.esperaSalidaTs).toEqual(salida!.ts);
    expect(cierre.infraccion?.detalle).toMatchObject({ esperaMin: 20, requeridoMin: 30 });
    // Equivale a evaluar todo junto.
    expect(salidaDe(paginas.flat())?.ts).toEqual(salida!.ts);
  });
});
