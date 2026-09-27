import { LINEAS_MOCK, TRUFIS_MOCK } from '../datos';
import { paradasDe } from './config';
import { hashString } from './rng';
import type { DemandaParada, EstadoFlotaMock, LineaMockId, NivelDemanda, ParadaMock } from '../tipos';

/**
 * Slice `demanda` — paradas con alta demanda / hora pico (E07 04:32 del guion). `demandaDe` es
 * PURA a propósito y NO toma `estado` — es una curva determinística de `(paradaId, hora)` más
 * un boost opcional (`horaPicoForzada`, 3er argumento). `useFlotaMock()`/la UI le pasan
 * `estado.horaPico` ahí — así el selector se puede probar sin construir un `EstadoFlotaMock`
 * completo, y esta es la única función del contrato que NO sigue la convención
 * `selector(estado, ...)` del resto del módulo (ver el comentario de cabecera del plan sobre
 * la firma literal `demandaDe(paradaId, fecha)`).
 */

/** Ítem "hora de mayor movimiento" (bug de cámara 2026-09): también la usa
 * `recorridos.ts#sembrarHistorial` para decidir el idle/espera entre vueltas — la flota casi no
 * espera en hora pico (más recorridos/hora) y sí espera fuera de pico (menos recorridos/hora),
 * así el historial sembrado sigue la MISMA curva de demanda que ya dibuja este archivo. */
export function esHoraPico(hora: number): boolean {
  return (hora >= 7 && hora < 9) || (hora >= 12 && hora < 14) || (hora >= 18 && hora < 20);
}

function lineaDeParadaId(paradaId: string): LineaMockId | undefined {
  for (const lineaId of Object.keys(LINEAS_MOCK) as LineaMockId[]) {
    if (LINEAS_MOCK[lineaId].paradas.some((p) => p.id === paradaId)) {
      return lineaId;
    }
  }
  return undefined;
}

/** Las 2 (Línea 120) o 3 (Z12) paradas que `alternarHoraPico()` fuerza a alta demanda —
 * determinístico (ordena por hash del id, sin depender de ningún `rng`/semilla del historial:
 * tiene que dar SIEMPRE el mismo resultado, en cualquier sesión). */
function paradasForzadasDe(lineaId: LineaMockId): Set<string> {
  const paradas = LINEAS_MOCK[lineaId].paradas;
  const cantidad = lineaId === 'z12' ? 3 : 2;
  return new Set(
    [...paradas]
      .sort((a, b) => hashString(a.id) - hashString(b.id))
      .slice(0, cantidad)
      .map((p) => p.id),
  );
}

/**
 * Demanda determinística de una parada a una hora dada. Curva base con picos 7-9, 12-14,
 * 18-20 (`esperando` alto, nivel `alta`) y valle el resto del día (`baja`/`media`, variación
 * estable por parada vía `hashString`). Con `horaPicoForzada: true` (pasar `estado.horaPico`),
 * las 2-3 paradas de `paradasForzadasDe(lineaId)` de CADA línea quedan en `alta` sin importar
 * la hora real — el resto de las paradas de esa línea no cambia (el contrato pide forzar
 * "2-3 paradas por línea", no todas).
 */
export function demandaDe(paradaId: string, fecha: Date, horaPicoForzada = false): DemandaParada {
  const hora = fecha.getHours();
  const variacion = hashString(`${paradaId}:${hora}`) % 12;

  let forzada = false;
  if (horaPicoForzada) {
    const lineaId = lineaDeParadaId(paradaId);
    forzada = !!lineaId && paradasForzadasDe(lineaId).has(paradaId);
  }

  const enAlza = esHoraPico(hora) || forzada;
  const esperando = enAlza ? 18 + variacion : 3 + variacion;
  const nivel: NivelDemanda = esperando >= 18 ? 'alta' : esperando >= 8 ? 'media' : 'baja';
  return { nivel, esperando };
}

/** Paradas (objeto completo, no solo el id) con `demandaDe(...).nivel === 'alta'` ahora mismo,
 * de las líneas visibles. Toma `estado.horaPico` internamente (a diferencia de `demandaDe`,
 * esta SÍ sigue la convención `selector(estado, ...)` del resto del módulo). Usa `paradasDe`
 * (ítem 14 del guion delegado), NO `LINEAS_MOCK` directo — así respeta un `nombre` editado
 * desde Configuración en vez de mostrar siempre el de semilla. */
export function paradasConAltaDemanda(estado: EstadoFlotaMock, fecha: Date, lineaId?: LineaMockId): ParadaMock[] {
  const lineaIds = lineaId ? [lineaId] : (Object.keys(LINEAS_MOCK) as LineaMockId[]);
  const resultado: ParadaMock[] = [];
  for (const id of lineaIds) {
    for (const parada of paradasDe(estado, id)) {
      if (demandaDe(parada.id, fecha, estado.horaPico).nivel === 'alta') {
        resultado.push(parada);
      }
    }
  }
  return resultado;
}

/** Movimiento por hora (0-23) — cantidad de recorridos INICIADOS en cada hora local,
 * consistente con el historial sembrado (`recorridos.ts#sembrarHistorial`) más los que se
 * disparen en vivo durante la demo. OJO: después de la hora actual da 0 en TODAS las horas
 * futuras (todavía no pasaron) — para el gráfico de Análisis, combinar con
 * `movimientoTipicoPorHora` (abajo) para esas horas, así el chart no se ve "cortado" en cámara. */
export function movimientoPorHora(estado: EstadoFlotaMock, lineaId?: LineaMockId): number[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const recorrido of estado.recorridos) {
    if (lineaId && recorrido.lineaId !== lineaId) {
      continue;
    }
    const hora = new Date(recorrido.inicio).getHours();
    buckets[hora] = (buckets[hora] ?? 0) + 1;
  }
  return buckets;
}

/** Intensidad relativa (recorridos/trufi/hora) de un día TÍPICO — mismos 3 picos que
 * `esHoraPico` (7-9, 12-14, 18-20), valle fuera de pico, y 0 fuera del horario operativo de
 * ambas líneas (antes de las 05:00 o desde las 23:00). Números "de demo" (no salen de datos
 * reales), a propósito redondos para que la curva se vea prolija en el chart. Exportada:
 * `recorridos.ts#sembrarHistorial` también la usa para decidir cuántos arranques sembrar por
 * hora — el historial sembrado sigue la MISMA curva que dibuja `movimientoTipicoPorHora`. */
export function intensidadTipicaDe(hora: number): number {
  if (hora < 5 || hora >= 23) {
    return 0;
  }
  return esHoraPico(hora) ? 1.3 : 0.6;
}

/**
 * Ítem 18 — curva "típica" de movimiento por hora, en la MISMA escala que `movimientoPorHora`
 * (recorridos iniciados esa hora) pero determinística y completa para las 24 h, sin importar
 * la hora actual: hoy `movimientoPorHora` solo cuenta lo YA sembrado/disparado hasta `now`, así
 * que en cámara el gráfico de Análisis se ve plano en 0 desde la hora actual hasta las 23 —
 * roto visualmente. Se deriva de `intensidadTipicaDe` (la curva base de demanda: mismos 3
 * picos) multiplicada por el tamaño de la flota visible — la UI dibuja barras REALES
 * (`movimientoPorHora`) hasta la hora actual y barras "típico" (esta función), más claras o
 * punteadas, para el resto.
 */
export function movimientoTipicoPorHora(lineaId?: LineaMockId): number[] {
  const cantidadTrufis = (lineaId ? TRUFIS_MOCK.filter((t) => t.lineaId === lineaId) : TRUFIS_MOCK).length || 1;
  return Array.from({ length: 24 }, (_, hora) => Math.round(cantidadTrufis * intensidadTipicaDe(hora)));
}

export function alternarHoraPico(estado: EstadoFlotaMock): EstadoFlotaMock {
  return { ...estado, horaPico: !estado.horaPico };
}
