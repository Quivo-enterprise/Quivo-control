import { MARGEN_DEMORADO_MS, type EstadoFilaSalida } from '@quivo/shared';
import { formatHoraBolivia } from '../../shared/format-hora';

/**
 * Lógica pura de la fila de salida en la terminal (sin React ni módulos nativos). El reloj del
 * teléfono no es confiable: cada respuesta trae `servidorTs` y la cuenta regresiva se calcula con
 * el desfase `servidorTs - momento de recepción local`. El servidor valida igual al tocar SALIR.
 */

/** Cuánto antes de la hora de salida se avisa ("En 1 minuto es tu turno de salida"). */
export const AVISO_ANTES_MS = 60_000;
export const TEXTO_AVISO_FILA = 'En 1 minuto es tu turno de salida';
export const TITULO_AVISO_FILA = 'Fila de salida';

/** `servidor - local` en ms (positivo = el teléfono va atrasado). 0 si `servidorTs` no parsea. */
export function desfaseReloj(
  fila: Pick<EstadoFilaSalida, 'servidorTs'>,
  recibidoLocalMs: number,
): number {
  const servidor = Date.parse(fila.servidorTs);
  return Number.isFinite(servidor) ? servidor - recibidoLocalMs : 0;
}

/** ms que faltan para la hora de salida (negativo = ya pasó). `NaN` si `etaTs` no parsea. */
export function restanteMs(
  fila: Pick<EstadoFilaSalida, 'etaTs'>,
  ahoraCorregidoMs: number,
): number {
  return Date.parse(fila.etaTs) - ahoraCorregidoMs;
}

/** Instante LOCAL (epoch ms) en que debe sonar el aviso T-1; `null` si no es calculable. */
export function momentoLocalAviso(
  fila: Pick<EstadoFilaSalida, 'etaTs'>,
  desfaseMs: number,
): number | null {
  const eta = Date.parse(fila.etaTs);
  if (!Number.isFinite(eta)) return null;
  return eta - desfaseMs - AVISO_ANTES_MS;
}

/** SALIR se habilita cuando el servidor lo dice o, siendo el primero, cuando llegó su hora (con
 * el reloj corregido). Los de atrás nunca se habilitan solos: dependen de que salga el de adelante. */
export function habilitadoLocal(fila: EstadoFilaSalida, ahoraCorregidoMs: number): boolean {
  if (fila.habilitado) return true;
  const resto = restanteMs(fila, ahoraCorregidoMs);
  return fila.posicion === 1 && Number.isFinite(resto) && resto <= 0;
}

/** Pasada la hora de salida por más de `DEMORA_VISIBLE_MS` (mismo margen que el servidor: el chofer
 * necesita tiempo para tocar SALIR). Se ignora `fila.demorado` del servidor a propósito. */
export const DEMORA_VISIBLE_MS = MARGEN_DEMORADO_MS;

export function estaDemorado(fila: EstadoFilaSalida, ahoraCorregidoMs: number): boolean {
  return (
    habilitadoLocal(fila, ahoraCorregidoMs) &&
    restanteMs(fila, ahoraCorregidoMs) < -DEMORA_VISIBLE_MS
  );
}

/**
 * ¿Toca avisar "falta 1 minuto"? Solo al primero de la fila, una sola vez por `etaTs`
 * (`etaAvisado`), cuando faltan entre 0 (excluido) y 60 s; nunca si el servidor ya la traía habilitada.
 */
export function debeAvisar(
  fila: EstadoFilaSalida,
  ahoraCorregidoMs: number,
  etaAvisado: string | null,
): boolean {
  if (fila.posicion !== 1 || fila.habilitado || etaAvisado === fila.etaTs) return false;
  const resto = restanteMs(fila, ahoraCorregidoMs);
  return Number.isFinite(resto) && resto > 0 && resto <= AVISO_ANTES_MS;
}

/** `m:ss` (o `h:mm:ss` desde 1 h); redondea los segundos hacia arriba y no baja de `0:00`. */
export function formatearCuenta(restante: number): string {
  const total = Number.isFinite(restante) ? Math.max(0, Math.ceil(restante / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function textoPosicion(
  fila: Pick<EstadoFilaSalida, 'posicion' | 'total' | 'delantePlaca'>,
): string {
  const base = `Posición ${fila.posicion} de ${fila.total}`;
  return fila.delantePlaca ? `${base} · delante ${fila.delantePlaca}` : base;
}

/** "Salís a las 07:24" (hora de Bolivia); `null` si la hora no parsea. */
export function textoHoraSalida(fila: Pick<EstadoFilaSalida, 'etaTs'>): string | null {
  const hora = formatHoraBolivia(fila.etaTs);
  return hora ? `Salís a las ${hora}` : null;
}

/** La cuenta regresiva va solo en el botón (`textoBoton`): acá no se repite. */
export function textoTurno(habilitado: boolean): string {
  return habilitado ? 'Es tu turno' : 'En espera';
}

/** Antes de la hora: cuánto falta. Pasada la hora: en negativo, para que el chofer vea cuánto lleva
 * de retraso (desde el primer segundo completo, para no mostrar "−0:00"). En la hora justa: "SALIR". */
export function textoBoton(habilitado: boolean, restante: number): string {
  if (!habilitado) return `SALIR · ${formatearCuenta(restante)}`;
  if (Number.isFinite(restante) && restante <= -1000)
    return `SALIR · −${formatearCuenta(-restante)}`;
  return 'SALIR';
}

/** Texto para el lector de pantalla: cambia solo al cambiar de minuto o al habilitarse. */
export function textoAccesible(habilitado: boolean, restante: number): string {
  if (habilitado) return 'Es tu turno. Ya podés salir';
  const min = Number.isFinite(restante) ? Math.max(1, Math.ceil(restante / 60_000)) : 1;
  return min === 1 ? 'Te toca en 1 minuto' : `Te toca en ${min} minutos`;
}

/** Identificador de la notificación (programada o presentada) del aviso T-1 de un `etaTs`. */
export function idAvisoFila(etaTs: string): string {
  return `fila-salida-t1|${etaTs}`;
}
