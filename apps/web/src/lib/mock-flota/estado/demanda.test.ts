import { describe, expect, it } from 'vitest';
import { TRUFIS_MOCK } from '../datos';
import type { ConfigLineaInput } from '../tipos';
import { configDe } from './config';
import { movimientoPorHora, movimientoTipicoPorHora, paradasConAltaDemanda } from './demanda';
import { estadoInicial } from './index';
import { guardarConfigLinea } from './config';

const AHORA = new Date('2026-09-27T12:00:00-04:00');

describe('movimientoTipicoPorHora (ítem 18)', () => {
  it('devuelve 24 valores, todos no-negativos', () => {
    const curva = movimientoTipicoPorHora();
    expect(curva).toHaveLength(24);
    for (const v of curva) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('es 0 fuera del horario operativo (antes de las 05:00 y desde las 23:00)', () => {
    const curva = movimientoTipicoPorHora();
    for (let h = 0; h < 5; h++) expect(curva[h]).toBe(0);
    for (let h = 23; h < 24; h++) expect(curva[h]).toBe(0);
  });

  it('las horas pico (7-9, 12-14, 18-20) son MAYORES que una hora fuera de pico (10)', () => {
    const curva = movimientoTipicoPorHora();
    for (const pico of [7, 8, 12, 13, 18, 19]) {
      expect(curva[pico]!).toBeGreaterThan(curva[10]!);
    }
  });

  it('es determinística (misma llamada, mismo resultado)', () => {
    expect(movimientoTipicoPorHora()).toEqual(movimientoTipicoPorHora());
    expect(movimientoTipicoPorHora('z12')).toEqual(movimientoTipicoPorHora('z12'));
  });

  it('filtrada por línea, usa una flota más chica → valores <= que sin filtro', () => {
    const total = movimientoTipicoPorHora();
    const soloZ12 = movimientoTipicoPorHora('z12');
    const soloL120 = movimientoTipicoPorHora('l120');
    for (let h = 0; h < 24; h++) {
      expect(soloZ12[h]!).toBeLessThanOrEqual(total[h]!);
      expect(soloL120[h]!).toBeLessThanOrEqual(total[h]!);
    }
  });
});

describe('paradasConAltaDemanda usa paradasDe (ítem 14)', () => {
  it('si se edita el nombre de una parada con alta demanda forzada, el resultado refleja el nombre editado', () => {
    let estado = estadoInicial(AHORA);
    estado = { ...estado, horaPico: true };

    // Fuerza alta demanda y encuentra una parada afectada.
    const antes = paradasConAltaDemanda(estado, AHORA, 'z12');
    expect(antes.length).toBeGreaterThan(0);
    const objetivo = antes[0]!;

    const config = configDe(estado, 'z12');
    const nuevaConfig: ConfigLineaInput = {
      frecuenciaMin: config.frecuenciaMin,
      horaInicio: config.horaInicio,
      horaFin: config.horaFin,
      paradas: config.paradas.map((p) => (p.id === objetivo.id ? { ...p, nombre: 'Parada Renombrada' } : p)),
    };
    const siguiente = guardarConfigLinea(estado, 'z12', nuevaConfig);

    const despues = paradasConAltaDemanda(siguiente, AHORA, 'z12');
    const mismaParada = despues.find((p) => p.id === objetivo.id);
    expect(mismaParada?.nombre).toBe('Parada Renombrada');
  });
});

describe('sanity — TRUFIS_MOCK sigue siendo 8', () => {
  it('5 Z12 + 3 Línea 120', () => {
    expect(TRUFIS_MOCK.filter((t) => t.lineaId === 'z12')).toHaveLength(5);
    expect(TRUFIS_MOCK.filter((t) => t.lineaId === 'l120')).toHaveLength(3);
  });
});

/**
 * Bug de cámara 2026-09, segunda vuelta: el primer fix (entrada escalonada + espera fija fuera
 * de pico, `recorridos.ts`) sacó el pico artificial de la hora 05 pero introdujo un PHASE-LOCK —
 * con espaciados y esperas fijas, los 8 trufis terminan arrancando su vuelta N-ésima ~sincronizados,
 * así que una hora pico podía caer en el "valle" entre dos arranques masivos (p. ej. con
 * `now=13:00`, hora pico 12 con solo 2 recorridos; con `now=20:30`, hora valle 09 con 1). El
 * segundo fix (demand-driven, `recorridos.ts#sembrarLinea`) reemplaza el enfoque: cada hora
 * decide cuántos arranques le tocan según la curva de demanda y los reparte entre los trufis
 * libres — sin espaciados fijos que se puedan alinear entre sí.
 *
 * Este test verifica la FORMA resultante de `movimientoPorHora`, fleet-wide y por línea, para
 * tres `now` a lo largo del día (13:30, 18:45, 20:30): toda hora pico (7,8,12,13,18,19) COMPLETA
 * y ya pasada tiene que tener un conteo >= el de toda hora valle completa y ya pasada, el máximo
 * de las horas completas tiene que caer en una hora pico, y ninguna hora operativa completa
 * puede quedar en 0. La hora PARCIAL (la de `now`) queda afuera de estas comparaciones — todavía
 * no terminó de acumular arranques.
 */
describe('movimientoPorHora sigue la curva de demanda, sin phase-lock (bug de cámara 2026-09)', () => {
  const HORAS_PICO = new Set([7, 8, 12, 13, 18, 19]);
  const HORAS_VALLE = new Set([5, 6, 9, 10, 11, 14, 15, 16, 17, 20, 21, 22]);

  function verificarForma(curva: number[], nowHour: number, etiqueta: string): void {
    const horasCompletas = Array.from({ length: nowHour - 5 }, (_, i) => i + 5);
    const conteosPico = horasCompletas.filter((h) => HORAS_PICO.has(h)).map((h) => curva[h]!);
    const conteosValle = horasCompletas.filter((h) => HORAS_VALLE.has(h)).map((h) => curva[h]!);

    for (const h of horasCompletas) {
      expect(curva[h]!, `${etiqueta}: hora ${h} completa no puede quedar en 0`).toBeGreaterThan(0);
    }
    if (conteosPico.length > 0 && conteosValle.length > 0) {
      const minPico = Math.min(...conteosPico);
      const maxValle = Math.max(...conteosValle);
      expect(minPico, `${etiqueta}: la hora pico más floja (${minPico}) tiene que ser >= la hora valle más cargada (${maxValle})`).toBeGreaterThanOrEqual(maxValle);

      const maxCompleto = Math.max(...horasCompletas.map((h) => curva[h]!));
      const argmax = horasCompletas.find((h) => curva[h] === maxCompleto)!;
      expect(HORAS_PICO.has(argmax), `${etiqueta}: el máximo (hora ${argmax}) tiene que caer en una hora pico`).toBe(true);
    }
  }

  it.each([
    ['13:30', new Date(2026, 8, 27, 13, 30, 0, 0)],
    ['18:45', new Date(2026, 8, 27, 18, 45, 0, 0)],
    ['20:30', new Date(2026, 8, 27, 20, 30, 0, 0)],
  ])('para now=%s, la forma pico/valle se cumple fleet-wide y por línea', (etiqueta, now) => {
    const estado = estadoInicial(now);
    const nowHour = now.getHours();

    verificarForma(movimientoPorHora(estado), nowHour, `${etiqueta} total`);
    verificarForma(movimientoPorHora(estado, 'z12'), nowHour, `${etiqueta} z12`);
    verificarForma(movimientoPorHora(estado, 'l120'), nowHour, `${etiqueta} l120`);
  });
});
