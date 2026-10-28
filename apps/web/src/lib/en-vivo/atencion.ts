import {
  EstadoFrescuraSchema,
  GRAVEDAD_ORDEN,
  type EstadoFrescura,
  type MolinosCola,
  type MolinosResumen,
  type PosicionEnVivo,
} from '@quivo/shared';
import { ETIQUETA_NIVEL, nivelDeAlerta } from './alertas';
import { formatearHace } from './jornadas';

/**
 * Lógica pura de la pestaña "Atención" y del panel de estados de `/en-vivo` (Propuesta B,
 * `docs/plan-en-vivo.md`, fase 2a). La API de posiciones no trae el tipo de infracción: los
 * motivos son genéricos (cantidad + nivel). Molinos es salida libre: estar en cola NO es falla,
 * solo suma prioridad al ordenar.
 */

type Entrada = Pick<
  PosicionEnVivo,
  'estadoFrescura' | 'infraccionNivel' | 'infraccionesAbiertas' | 'vuelta' | 'ultimoFixTs' | 'servidorTs' | 'ultimaIncidencia'
>;

/** Una incidencia del chofer pide atención durante esta ventana desde que el servidor la recibió. */
const VENTANA_INCIDENCIA_MS = 30 * 60_000;

/** La incidencia reciente (recepción vs. reloj del servidor; el `ts` del dispositivo no cuenta), o `null`. */
function incidenciaVigente(p: Entrada) {
  const inc = p.ultimaIncidencia;
  if (!inc) return null;
  const edad = Math.max(0, Date.parse(p.servidorTs) - Date.parse(inc.recibidoTs)); // reloj desfasado: no negativo
  return edad <= VENTANA_INCIDENCIA_MS ? inc : null; // NaN (fecha inválida) no pasa
}

/** Vehículos por `estadoFrescura`; un valor desconocido (API más nueva que el panel) cuenta como `sin_datos`. */
export function conteoPorEstado(posiciones: readonly Pick<PosicionEnVivo, 'estadoFrescura'>[]): Record<EstadoFrescura, number> {
  const cuenta = Object.fromEntries(EstadoFrescuraSchema.options.map((e) => [e, 0])) as Record<EstadoFrescura, number>;
  for (const p of posiciones) cuenta[estadoDe(p)] += 1;
  return cuenta;
}

/** Lugar en la cola de Molinos por `sesionId`, tal cual lo calcula el servidor (`resumen.colas`, la misma que ve el chofer). */
export function ordenColaMolinos(resumen?: Pick<MolinosResumen, 'colas'>): Map<string, number> {
  return new Map((resumen?.colas ?? []).flatMap((c) => c.entradas.map((e) => [e.sesionId, e.posicion] as const)));
}

/** El orden viene del resumen de 15 s: solo vale si la posición fresca confirma que la vuelta espera. */
const ordenVigente = (p: Entrada, ordenCola?: number): number | undefined => (p.vuelta?.enEspera ? ordenCola : undefined);

/** Motivos por los que un vehículo pide atención, del más al menos urgente. `ordenCola` = su lugar
 * en la cola de Molinos (`ordenColaMolinos`); sin él, no está en la cola. */
export function motivosAtencion(p: Entrada, ordenCola?: number): string[] {
  const motivos: string[] = [];
  if (estadoDe(p) === 'perdido') {
    const hace = formatearHace(p.ultimoFixTs, Date.parse(p.servidorTs));
    if (hace !== '—') motivos.push(hace); // el estado ya va como etiqueta al lado
  }
  if (estadoDe(p) === 'sin_datos') motivos.push('Sin GPS aún');
  const nivel = nivelDeAlerta(p);
  if (nivel) {
    const n = p.infraccionesAbiertas ?? 0;
    motivos.push(`${n} ${n === 1 ? 'infracción' : 'infracciones'} · ${ETIQUETA_NIVEL[nivel].singular}`);
  }
  const inc = incidenciaVigente(p);
  if (inc) motivos.push(`Incidencia: ${inc.texto} · ${formatearHace(inc.recibidoTs, Date.parse(p.servidorTs))}`);
  const orden = ordenVigente(p, ordenCola);
  if (orden) motivos.push(`${orden}.º en cola de Molinos`);
  return motivos;
}

/** Estar en la cola no es una falla: solo el 1.º cuenta (el despachador puede tener que designar; está por salir). */
export const necesitaAtencion = (p: Entrada, ordenCola?: number): boolean =>
  estadoDe(p) === 'perdido' || estadoDe(p) === 'sin_datos' || nivelDeAlerta(p) !== null || incidenciaVigente(p) !== null || ordenVigente(p, ordenCola) === 1;

/** Prioridad para ordenar "Atención" (mayor = más urgente): infracción por nivel, incidencia (salud 100, otras 40), perdido 85, sin datos 70, Molinos 20 - orden. */
export function puntajeAtencion(p: Entrada, ordenCola?: number): number {
  const nivel = nivelDeAlerta(p);
  let s = nivel ? GRAVEDAD_ORDEN[nivel] * 30 + (p.infraccionesAbiertas ?? 0) : 0;
  if (estadoDe(p) === 'perdido') s += 85;
  if (estadoDe(p) === 'sin_datos') s += 70;
  const inc = incidenciaVigente(p);
  if (inc) s += inc.categoria === 'salud' ? 100 : 40; // salud sobre todo; el resto, como una infracción grave
  const orden = ordenVigente(p, ordenCola);
  if (orden) s += Math.max(1, 20 - orden);
  return s;
}

/** Orden de los 6 estados en el panel de flota: normales primero, fallas al final. */
export const ORDEN_ESTADOS_FRESCURA: readonly EstadoFrescura[] = [
  'reportando',
  'detenido',
  'en_pausa',
  'perdido',
  'sin_datos',
  'finalizado',
];

/** Estado normalizado: lo desconocido cuenta como `sin_datos`, igual que en `conteoPorEstado`. */
export const estadoDe = (p: Pick<PosicionEnVivo, 'estadoFrescura'>): EstadoFrescura =>
  Object.hasOwn(EstadoFrescuraSchema.enum, p.estadoFrescura) ? p.estadoFrescura : 'sin_datos';

/** Filtro por estado del panel (`null` = todos). Conserva `conservarId` (el vehículo con el cajón abierto). */
export function filtrarPorEstado<T extends Pick<PosicionEnVivo, 'id' | 'estadoFrescura'>>(
  posiciones: T[],
  estado: EstadoFrescura | null,
  conservarId?: string | null,
): T[] {
  return estado ? posiciones.filter((p) => p.id === conservarId || estadoDe(p) === estado) : posiciones;
}

/** Total de la flota y los que siguen en servicio (todo menos `finalizado`; `sin_datos` sí: ya inició sesión). */
export function resumenFlota(conteo: Record<EstadoFrescura, number>): { total: number; enServicio: number } {
  const total = Object.values(conteo).reduce((a, n) => a + n, 0);
  return { total, enServicio: total - conteo.finalizado };
}

export interface FilaFlota<T> {
  posicion: T;
  motivos: string[];
}

/** Pestaña "Atención": solo los que la necesitan, del más al menos urgente (empate: por placa). */
export function listaAtencion<T extends Entrada & Pick<PosicionEnVivo, 'id' | 'vehiculoPlaca'>>(
  posiciones: readonly T[],
  ordenCola: ReadonlyMap<string, number>,
): FilaFlota<T>[] {
  return posiciones
    .filter((p) => necesitaAtencion(p, ordenCola.get(p.id)))
    .map((p) => ({ posicion: p, puntaje: puntajeAtencion(p, ordenCola.get(p.id)) }))
    .sort((a, b) => b.puntaje - a.puntaje || a.posicion.vehiculoPlaca.localeCompare(b.posicion.vehiculoPlaca, 'es'))
    .map(({ posicion }) => ({ posicion, motivos: motivosAtencion(posicion, ordenCola.get(posicion.id)) }));
}

/** Pestaña "Toda la flota": orden estable por placa (no salta con cada poll). */
export function listaFlota<T extends Entrada & Pick<PosicionEnVivo, 'id' | 'vehiculoPlaca'>>(
  posiciones: readonly T[],
  ordenCola: ReadonlyMap<string, number>,
): FilaFlota<T>[] {
  return [...posiciones]
    .sort((a, b) => a.vehiculoPlaca.localeCompare(b.vehiculoPlaca, 'es') || a.id.localeCompare(b.id))
    .map((p) => ({ posicion: p, motivos: motivosAtencion(p, ordenCola.get(p.id)) }));
}

/** Las colas con solo los que la posición fresca confirma en espera: la misma verdad que usa "Atención". */
export function colasVerificadas(
  colas: readonly MolinosCola[] | undefined,
  posiciones: readonly Pick<PosicionEnVivo, 'id' | 'vuelta'>[],
): MolinosCola[] {
  const enEspera = new Set(posiciones.filter((p) => p.vuelta?.enEspera).map((p) => p.id));
  return (colas ?? []).map((c) => ({ ...c, entradas: c.entradas.filter((e) => enEspera.has(e.sesionId)) }));
}

/** Colas de Molinos con gente, de la línea elegida (`''` = todas). */
export function colasVisibles(colas: readonly MolinosCola[] | undefined, lineaId: string): MolinosCola[] {
  return (colas ?? []).filter((c) => c.entradas.length > 0 && (!lineaId || c.lineas.some((l) => l.lineaId === lineaId)));
}
