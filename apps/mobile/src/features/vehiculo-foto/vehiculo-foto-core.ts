import { FOTO_VEHICULO_MAX_BYTES } from '@quivo/shared';

/**
 * Lógica pura de la foto del vehículo (PR D): mensajes, reintentos, tope de tamaño y fechas.
 * Sin React ni módulos nativos para poder testearla con vitest.
 */

export const LADO_FOTO_PX = 512;
export const CALIDAD_JPEG = 0.7;
export const MAX_INTENTOS_SUBIDA = 3;
const BACKOFF_BASE_MS = 1_000;

/** Bolivia es UTC-4 todo el año (sin horario de verano). */
const OFFSET_BOLIVIA_MS = -4 * 60 * 60 * 1000;

export type EstadoFoto = 'idle' | 'procesando' | 'enviando' | 'pendiente' | 'enviada' | 'error';

/** Bytes que ocupa un base64 ya decodificado (sin decodificarlo). */
export function bytesDecodificados(base64: string): number {
  const largo = base64.length;
  if (largo === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((largo * 3) / 4) - padding;
}

export function excedeTopeFoto(base64: string): boolean {
  return bytesDecodificados(base64) > FOTO_VEHICULO_MAX_BYTES;
}

export const MENSAJE_FOTO_GRANDE =
  'La foto es demasiado pesada. Toma otra con menos detalle y vuelve a intentar.';

/** Backoff exponencial: intento 1 -> 1 s, 2 -> 2 s, 3 -> 4 s. */
export function backoffMs(intento: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, intento - 1);
}

export interface ErrorSubida {
  /** Código HTTP, o `undefined` si fue un fallo de red/timeout/configuración. */
  status?: number;
  red: boolean;
}

/** Solo se reintenta lo transitorio: red caída/timeout y 5xx. 409/422/429/401 no se reintentan. */
export function esReintentable(error: ErrorSubida): boolean {
  if (error.red) return true;
  return error.status !== undefined && error.status >= 500;
}

export function mensajeErrorSubida(error: ErrorSubida): string {
  if (error.red) return 'Se enviará al reconectar.';
  switch (error.status) {
    case 401:
      return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    case 409:
      return 'No hay un recorrido o vehículo activo para asociar la foto.';
    case 413:
      return MENSAJE_FOTO_GRANDE;
    case 422:
      return 'La imagen no es válida. Toma otra foto.';
    case 429:
      return 'Enviaste muchas fotos seguidas. Intenta de nuevo en una hora.';
    default:
      return 'No se pudo enviar la foto. Intenta nuevamente.';
  }
}

export type ResultadoSubida<T> =
  | { tipo: 'ok'; valor: T }
  /** Se agotaron los reintentos por falta de red: queda pendiente hasta reconectar. */
  | { tipo: 'pendiente'; mensaje: string }
  | { tipo: 'error'; mensaje: string; status?: number };

export interface OpcionesSubida<T> {
  /** Un intento de subida. Debe lanzar un error clasificable por `clasificar`. */
  intentar: () => Promise<T>;
  clasificar: (error: unknown) => ErrorSubida;
  dormir: (ms: number) => Promise<void>;
  maxIntentos?: number;
  /** Se consulta antes de cada reintento: si devuelve `true` se corta y queda según el último error. */
  cancelado?: () => boolean;
}

/** Máquina de reintentos: ok | pendiente (red) | error (no reintentable, o 5xx agotado). */
export async function subirConReintentos<T>(op: OpcionesSubida<T>): Promise<ResultadoSubida<T>> {
  const max = op.maxIntentos ?? MAX_INTENTOS_SUBIDA;
  let ultimo: ErrorSubida = { red: true };
  for (let intento = 1; intento <= max; intento += 1) {
    try {
      return { tipo: 'ok', valor: await op.intentar() };
    } catch (error) {
      ultimo = op.clasificar(error);
      if (!esReintentable(ultimo)) {
        return { tipo: 'error', mensaje: mensajeErrorSubida(ultimo), status: ultimo.status };
      }
      if (intento === max || op.cancelado?.()) break;
      await op.dormir(backoffMs(intento));
    }
  }
  if (ultimo.red) return { tipo: 'pendiente', mensaje: mensajeErrorSubida(ultimo) };
  return { tipo: 'error', mensaje: mensajeErrorSubida(ultimo), status: ultimo.status };
}

function aHoraBolivia(fecha: Date): Date {
  return new Date(fecha.getTime() + OFFSET_BOLIVIA_MS);
}

function dos(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` del día calendario en Bolivia (America/La_Paz). */
export function claveDiaBolivia(fecha: Date): string {
  const b = aHoraBolivia(fecha);
  return `${b.getUTCFullYear()}-${dos(b.getUTCMonth() + 1)}-${dos(b.getUTCDate())}`;
}

/** `14/10/2026 09:05` en hora de Bolivia, o `null` si la fecha no parsea. */
export function formatearFechaBolivia(iso: string): string | null {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  const b = aHoraBolivia(fecha);
  return `${dos(b.getUTCDate())}/${dos(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${dos(b.getUTCHours())}:${dos(b.getUTCMinutes())}`;
}

/** El aviso de la pantalla de operación se muestra salvo que ya haya foto, se descartó hoy o haya recorrido activo. */
export function debeMostrarAviso(opts: {
  cargando: boolean;
  tieneFoto: boolean;
  descartadoDia: string | null;
  ahora: Date;
  tracking: boolean;
}): boolean {
  if (opts.tracking || opts.cargando || opts.tieneFoto) return false;
  return opts.descartadoDia !== claveDiaBolivia(opts.ahora);
}
