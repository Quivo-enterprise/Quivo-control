import { LINEAS_MOCK, TRUFIS_MOCK } from '../datos';
import { distanciaEntreAvancesM, largoTotalM } from '../geometria';
import { puntosControlActivosDe } from './config';
import { FASE_INICIAL, INTERVALO_TICK_MS, iniciarVuelta, pasoPorTickDe, posicionEnColaDe } from './flota';
import { crearRecorrido } from './recorridos';
import type { EstadoFlotaMock, LineaMock, LineaMockId, SalidaMock } from '../tipos';

/**
 * Slice `salidas` — cola de despacho por línea y el registro de salidas (E07 04:03/04:49 del
 * guion). El despacho automático está OFF a propósito (contrato: "ninguna decisión
 * automática") — la única forma de que un trufi `en_cola` pase a `en_ruta` es
 * `despacharSiguiente`/`simularFueraDeOrden`. Un trufi que TERMINA una vuelta YA NO vuelve a la
 * cola (guion delegado, ítem 1: arranca una vuelta nueva de una, sigue `en_ruta`) — la cola
 * cambia ÚNICAMENTE vía `despacharSiguiente`/`simularFueraDeOrden`/`moverEnCola`, que son las 3
 * funciones de acá que la tocan.
 */

/** Cola inicial — todos los trufis `en_cola` de `FASE_INICIAL` (`flota.ts`), en el orden de
 * `TRUFIS_MOCK`, agrupados por línea. */
export function colasInicial(): Record<LineaMockId, string[]> {
  const colas: Record<LineaMockId, string[]> = { z12: [], l120: [] };
  for (const trufi of TRUFIS_MOCK) {
    if (FASE_INICIAL[trufi.id] === 'en_cola') {
      colas[trufi.lineaId].push(trufi.id);
    }
  }
  return colas;
}

export function colaDe(estado: EstadoFlotaMock, lineaId: LineaMockId): string[] {
  return estado.colas[lineaId] ?? [];
}

export function salidasDelDia(
  estado: EstadoFlotaMock,
  filtro: { lineaId?: LineaMockId; trufiId?: string } = {},
): SalidaMock[] {
  return estado.salidas.filter(
    (s) => (!filtro.lineaId || s.lineaId === filtro.lineaId) && (!filtro.trufiId || s.trufiId === filtro.trufiId),
  );
}

function velocidadMps(trufiId: string, polilinea: [number, number][]): number {
  const distanciaPorTick = pasoPorTickDe(trufiId) * largoTotalM(polilinea);
  return distanciaPorTick / (INTERVALO_TICK_MS / 1000);
}

export interface GapTrufi {
  trufiId: string;
  minutos: number;
}

/** Entre trufis `en_ruta`/`atascado`/`desviado` de la MISMA línea, el más cercano adelante y
 * atrás de `trufiId` sobre el loop, en minutos (distancia de arco / velocidad nominal del
 * trufi vecino). Vacío si `trufiId` no está en una fase "visible en ruta" o no hay más
 * vehículos de su línea en ese estado. */
export function delanteDetras(estado: EstadoFlotaMock, trufiId: string): { adelante?: GapTrufi; atras?: GapTrufi } {
  const trufi = TRUFIS_MOCK.find((t) => t.id === trufiId);
  const sujeto = estado.trufis[trufiId];
  const FASES_VISIBLES = new Set(['en_ruta', 'atascado', 'desviado']);
  if (!trufi || !sujeto || !FASES_VISIBLES.has(sujeto.fase)) {
    return {};
  }
  const linea = LINEAS_MOCK[trufi.lineaId];
  const candidatos = TRUFIS_MOCK.filter((t) => {
    if (t.id === trufiId || t.lineaId !== trufi.lineaId) {
      return false;
    }
    const fase = estado.trufis[t.id]?.fase;
    return fase !== undefined && FASES_VISIBLES.has(fase);
  });

  let adelante: GapTrufi | undefined;
  let atras: GapTrufi | undefined;
  for (const candidato of candidatos) {
    const candEstado = estado.trufis[candidato.id]!;
    const velocidad = velocidadMps(candidato.id, linea.polilinea) || 1;

    const distAdelante = distanciaEntreAvancesM(linea.polilinea, sujeto.avance, candEstado.avance);
    const minutosAdelante = distAdelante / velocidad / 60;
    if (!adelante || minutosAdelante < adelante.minutos) {
      adelante = { trufiId: candidato.id, minutos: minutosAdelante };
    }

    const distAtras = distanciaEntreAvancesM(linea.polilinea, candEstado.avance, sujeto.avance);
    const minutosAtras = distAtras / velocidad / 60;
    if (!atras || minutosAtras < atras.minutos) {
      atras = { trufiId: candidato.id, minutos: minutosAtras };
    }
  }
  return { adelante, atras };
}

/**
 * Próxima salida PROGRAMADA de `lineaId` a partir de `nowIso` (frecuencia de la línea sumada a
 * la ÚLTIMA `programada` cronológica) — ítem 8 del guion delegado, dos bugs corregidos acá:
 *
 * 1. Las `salidas` sembradas están agrupadas POR VEHÍCULO (`sembrarHistorial` itera
 *    `TRUFIS_MOCK` y arma toda la línea de tiempo de CADA trufi antes de pasar al siguiente),
 *    no en orden cronológico — `estado.salidas[estado.salidas.length - 1]` no es la última
 *    programada, es la última que se empujó al array (la del ÚLTIMO trufi sembrado). Hay que
 *    buscar el MÁXIMO `programada` de la línea, no el último índice.
 * 2. Si esa "última programada + frecuencia" ya quedó en el PASADO (típico cuando el historial
 *    sembrado termina bastante antes de `now`, p. ej. temprano en la mañana), hay que
 *    encadenar sumando `frecuenciaMs` las veces que hagan falta hasta pasar `nowIso` — y
 *    redondear hacia el próximo minuto, para que la cola nunca muestre una hora ya pasada (bug
 *    real observado: 10:45 con la cola mostrando 10:08 y despachos con 37 min de "retraso").
 */
function proximaProgramadaDe(estado: EstadoFlotaMock, lineaId: LineaMockId, nowIso: string): string {
  const frecuenciaMs = (estado.config[lineaId]?.frecuenciaMin ?? 10) * 60_000;
  const salidasLinea = estado.salidas.filter((s) => s.lineaId === lineaId);
  const nowMs = Date.parse(nowIso);
  const ahoraRedondeadaMs = Math.ceil(nowMs / 60_000) * 60_000;

  if (salidasLinea.length === 0) {
    return new Date(ahoraRedondeadaMs).toISOString();
  }

  const ultimaProgramadaMs = Math.max(...salidasLinea.map((s) => Date.parse(s.programada)));
  let candidataMs = ultimaProgramadaMs + frecuenciaMs;
  if (candidataMs < ahoraRedondeadaMs) {
    const vueltas = Math.ceil((ahoraRedondeadaMs - candidataMs) / frecuenciaMs);
    candidataMs += vueltas * frecuenciaMs;
  }
  return new Date(Math.max(candidataMs, ahoraRedondeadaMs)).toISOString();
}

/**
 * Vista previa de la cola (E07 04:03: "orden de salida, horarios") — próxima salida programada
 * de CADA trufi en `colaDe(estado, lineaId)`, en orden. Cada entrada asume que los que la
 * preceden en la cola ya salieron (van encadenando `frecuenciaMin`), así que se calcula
 * simulando `proximaProgramadaDe` sobre una lista de salidas "hipotéticas" que crece con cada
 * trufi — el reducer y la UI comparten este único cálculo (contrato: "the UI will switch to
 * it, so the reducer and the UI share the same calculation").
 */
export function horariosCola(estado: EstadoFlotaMock, lineaId: LineaMockId, now: Date): { trufiId: string; programada: string }[] {
  const cola = colaDe(estado, lineaId);
  const nowIso = now.toISOString();
  let salidasSimuladas = estado.salidas;
  const resultado: { trufiId: string; programada: string }[] = [];
  for (const trufiId of cola) {
    const estadoParcial: EstadoFlotaMock = { ...estado, salidas: salidasSimuladas };
    const programada = proximaProgramadaDe(estadoParcial, lineaId, nowIso);
    resultado.push({ trufiId, programada });
    salidasSimuladas = [...salidasSimuladas, { id: `preview-${trufiId}`, trufiId, lineaId, programada, fueraDeOrden: false }];
  }
  return resultado;
}

/**
 * Posiciones EXPUESTAS (`lat`/`lng`) de los trufis `en_cola` de `lineaId`, según su índice
 * ACTUAL en `colaDe` — ítem 2 del guion delegado: sin esto, todos los trufis en cola quedan
 * apilados en el mismo punto (el origen de la línea). Se llama después de CUALQUIER cambio de
 * orden de la cola (despacho, fuera de orden, `moverEnCola`) y en `estado/index.ts#estadoInicial`
 * para la escena inicial. No-op (misma referencia) si ningún trufi en cola cambió de posición.
 */
export function reposicionarCola(estado: EstadoFlotaMock, lineaId: LineaMockId): EstadoFlotaMock {
  const cola = estado.colas[lineaId] ?? [];
  const linea: LineaMock = LINEAS_MOCK[lineaId];
  let trufisActualizados = estado.trufis;
  let cambio = false;
  cola.forEach((trufiId, indice) => {
    const actual = trufisActualizados[trufiId];
    if (!actual || actual.fase !== 'en_cola') {
      return;
    }
    const { lat, lng } = posicionEnColaDe(linea, indice);
    if (actual.lat !== lat || actual.lng !== lng) {
      trufisActualizados = { ...trufisActualizados, [trufiId]: { ...actual, lat, lng } };
      cambio = true;
    }
  });
  return cambio ? { ...estado, trufis: trufisActualizados } : estado;
}

/**
 * Saca `trufiId` de la cola de `lineaId` (de CUALQUIER posición — así sirve tanto para
 * `despacharSiguiente`, la cabeza, como para `simularFueraDeOrden`, la posición 1) y lo manda
 * a ruta: crea su `SalidaMock` y abre un `RecorridoMock` nuevo. No-op si `trufiId` no está
 * `en_cola` en esa línea.
 */
function despacharTrufi(
  estado: EstadoFlotaMock,
  lineaId: LineaMockId,
  trufiId: string,
  nowIso: string,
  salidaId: string,
  recorridoId: string,
  fueraDeOrden: boolean,
): EstadoFlotaMock {
  const cola = estado.colas[lineaId];
  const trufiActual = estado.trufis[trufiId];
  if (!cola || !cola.includes(trufiId) || !trufiActual || trufiActual.fase !== 'en_cola') {
    return estado;
  }
  const linea = LINEAS_MOCK[lineaId];
  const salida: SalidaMock = {
    id: salidaId,
    trufiId,
    lineaId,
    programada: proximaProgramadaDe(estado, lineaId, nowIso),
    real: nowIso,
    fueraDeOrden,
  };
  const recorrido = crearRecorrido(recorridoId, trufiId, lineaId, nowIso, puntosControlActivosDe(estado, lineaId).length);
  const siguiente: EstadoFlotaMock = {
    ...estado,
    trufis: { ...estado.trufis, [trufiId]: iniciarVuelta(trufiActual, linea, nowIso) },
    colas: { ...estado.colas, [lineaId]: cola.filter((id) => id !== trufiId) },
    salidas: [...estado.salidas, salida],
    recorridos: [...estado.recorridos, recorrido],
  };
  // El resto de la cola avanzó un puesto — reposiciona los marcadores (ítem 2).
  return reposicionarCola(siguiente, lineaId);
}

/** Despacha la CABEZA de la cola de `lineaId` — no-op si está vacía. */
export function despacharSiguiente(
  estado: EstadoFlotaMock,
  lineaId: LineaMockId,
  nowIso: string,
  salidaId: string,
  recorridoId: string,
): EstadoFlotaMock {
  const cola = estado.colas[lineaId];
  if (!cola || cola.length === 0) {
    return estado;
  }
  return despacharTrufi(estado, lineaId, cola[0]!, nowIso, salidaId, recorridoId, false);
}

/** Despacha `trufiId` SALTEANDO al que tiene adelante en la cola — marca `SalidaMock.fueraDeOrden`.
 * No-op si `trufiId` no está en cola o ya es la cabeza (eso es un despacho normal, no "fuera de
 * orden"). */
export function despacharFueraDeOrden(
  estado: EstadoFlotaMock,
  lineaId: LineaMockId,
  trufiId: string,
  nowIso: string,
  salidaId: string,
  recorridoId: string,
): EstadoFlotaMock {
  const cola = estado.colas[lineaId];
  if (!cola || cola.indexOf(trufiId) <= 0) {
    return estado;
  }
  return despacharTrufi(estado, lineaId, trufiId, nowIso, salidaId, recorridoId, true);
}

/** Mueve a `trufiId` un puesto dentro de la cola de su línea, hacia el índice `idx + delta`:
 * como el índice 0 es la CABEZA (el próximo a despachar), `delta: -1` lo acerca a la cabeza —
 * ADELANTA su turno — y `delta: 1` lo aleja — lo ATRASA. (Antes este comentario decía lo
 * contrario — ítem 16 del guion delegado; el comportamiento siempre fue este, era solo el
 * comentario el que estaba invertido.) */
export function moverEnCola(estado: EstadoFlotaMock, trufiId: string, delta: 1 | -1): EstadoFlotaMock {
  const trufi = TRUFIS_MOCK.find((t) => t.id === trufiId);
  if (!trufi) {
    return estado;
  }
  const cola = estado.colas[trufi.lineaId];
  const idx = cola.indexOf(trufiId);
  const nuevoIdx = idx + delta;
  if (idx === -1 || nuevoIdx < 0 || nuevoIdx >= cola.length) {
    return estado;
  }
  const nuevaCola = [...cola];
  const tmp = nuevaCola[idx]!;
  nuevaCola[idx] = nuevaCola[nuevoIdx]!;
  nuevaCola[nuevoIdx] = tmp;
  const siguiente: EstadoFlotaMock = { ...estado, colas: { ...estado.colas, [trufi.lineaId]: nuevaCola } };
  // Los dos trufis que intercambiaron posición necesitan sus marcadores reubicados (ítem 2).
  return reposicionarCola(siguiente, trufi.lineaId);
}
