import { EstadoFrescuraSchema, GRAVEDAD_ORDEN, type EstadoFrescura, type MolinosResumen, type PosicionEnVivo } from '@quivo/shared';
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
  'estadoFrescura' | 'infraccionNivel' | 'infraccionesAbiertas' | 'vuelta' | 'ultimoFixTs' | 'servidorTs'
>;

/** Vehículos por `estadoFrescura`; un valor desconocido (API más nueva que el panel) cuenta como `sin_datos`. */
export function conteoPorEstado(posiciones: Pick<PosicionEnVivo, 'estadoFrescura'>[]): Record<EstadoFrescura, number> {
  const cuenta = Object.fromEntries(EstadoFrescuraSchema.options.map((e) => [e, 0])) as Record<EstadoFrescura, number>;
  for (const p of posiciones) {
    cuenta[(Object.hasOwn(cuenta, p.estadoFrescura) ? p.estadoFrescura : 'sin_datos') as EstadoFrescura] += 1;
  }
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
  if (p.estadoFrescura === 'perdido') {
    const hace = formatearHace(p.ultimoFixTs, Date.parse(p.servidorTs));
    motivos.push(hace === '—' ? 'Perdido' : `Perdido ${hace}`);
  }
  if (p.estadoFrescura === 'sin_datos') motivos.push('Sin GPS aún');
  const nivel = nivelDeAlerta(p);
  if (nivel) {
    const n = p.infraccionesAbiertas ?? 0;
    motivos.push(`${n} ${n === 1 ? 'infracción' : 'infracciones'} · ${ETIQUETA_NIVEL[nivel].singular}`);
  }
  const orden = ordenVigente(p, ordenCola);
  if (orden) motivos.push(`${orden}.º en cola de Molinos`);
  return motivos;
}

/** Estar en la cola no es una falla: solo el 1.º cuenta (el despachador puede tener que designar; está por salir). */
export const necesitaAtencion = (p: Entrada, ordenCola?: number): boolean =>
  p.estadoFrescura === 'perdido' || p.estadoFrescura === 'sin_datos' || nivelDeAlerta(p) !== null || ordenVigente(p, ordenCola) === 1;

/** Prioridad para ordenar "Atención" (mayor = más urgente): infracción por nivel, perdido 85, sin datos 70, Molinos 20 - orden. */
export function puntajeAtencion(p: Entrada, ordenCola?: number): number {
  const nivel = nivelDeAlerta(p);
  let s = nivel ? GRAVEDAD_ORDEN[nivel] * 30 + (p.infraccionesAbiertas ?? 0) : 0;
  if (p.estadoFrescura === 'perdido') s += 85;
  if (p.estadoFrescura === 'sin_datos') s += 70;
  const orden = ordenVigente(p, ordenCola);
  if (orden) s += Math.max(1, 20 - orden);
  return s;
}
