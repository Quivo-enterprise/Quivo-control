import { FOTO_VEHICULO_MAX_BYTES } from '@quivo/shared';
import { diaBolivia } from '../jornada/jornada-store-core';

/**
 * Lógica pura de la foto del vehículo (PR D): mensajes, reintentos, tope de tamaño y fechas.
 * Sin React ni módulos nativos para poder testearla con vitest.
 */

export const LADO_FOTO_PX = 512;
export const CALIDAD_JPEG = 0.7;
export const MAX_INTENTOS_SUBIDA = 3;
const BACKOFF_BASE_MS = 1_000;

/** Margen de desfase de reloj entre el teléfono y el servidor al decidir si una subida ya llegó. */
export const MARGEN_RELOJ_MS = 2 * 60 * 1000;

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

/** Solo se reintenta lo transitorio: red caída/timeout y 5xx. 400/401/409/413/429 no se reintentan. */
export function esReintentable(error: ErrorSubida): boolean {
  if (error.red) return true;
  return error.status !== undefined && error.status >= 500;
}

export function mensajeErrorSubida(error: ErrorSubida): string {
  if (error.red) return 'Se enviará al reconectar.';
  switch (error.status) {
    case 401:
      return 'Tu sesión expiró. Vuelve a ingresar para enviar la foto.';
    case 409:
      return 'No hay un recorrido o vehículo activo para asociar la foto.';
    // El API responde 400 (BadRequestException y ZodValidationPipe) para imagen inválida o
    // pasada de tamaño; 413 solo lo devuelve el límite de body de Fastify (3 MB). 422 no existe.
    case 400:
      return 'La foto no es válida. Toma otra foto.';
    case 413:
      return MENSAJE_FOTO_GRANDE;
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
  /** El POST no es idempotente: un timeout puede haber llegado igual al servidor. Antes de cada
   * reintento (y del primer intento si `verificarPrimero`) se consulta el estado actual; si
   * devuelve un valor, la subida ya se hizo y se da por exitosa. Un fallo al verificar se ignora. */
  yaExistente?: () => Promise<T | null>;
  verificarPrimero?: boolean;
}

/** Máquina de reintentos: ok | pendiente (red) | error (no reintentable, o 5xx agotado). */
export async function subirConReintentos<T>(op: OpcionesSubida<T>): Promise<ResultadoSubida<T>> {
  const max = op.maxIntentos ?? MAX_INTENTOS_SUBIDA;
  let ultimo: ErrorSubida = { red: true };
  for (let intento = 1; intento <= max; intento += 1) {
    if (op.yaExistente && (intento > 1 || op.verificarPrimero)) {
      try {
        const existente = await op.yaExistente();
        if (existente !== null) return { tipo: 'ok', valor: existente };
      } catch {
        // Sin poder verificar se intenta la subida: peor caso, el servidor reemplaza la foto.
      }
    }
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

/**
 * `true` si la foto del servidor es posterior al inicio de ESTA captura (menos el margen de
 * reloj), o sea que un POST anterior sin respuesta sí llegó. `previaEn` es la fecha que ya había
 * antes de capturar: si el servidor aún la devuelve, no hubo reemplazo.
 */
export function subidaYaAplicada(opts: {
  fotoActualizadaEn: string;
  inicioMs: number;
  previaEn?: string | null;
  margenMs?: number;
}): boolean {
  if (opts.previaEn && opts.fotoActualizadaEn === opts.previaEn) return false;
  const servidor = Date.parse(opts.fotoActualizadaEn);
  if (Number.isNaN(servidor)) return false;
  return servidor >= opts.inicioMs - (opts.margenMs ?? MARGEN_RELOJ_MS);
}

/** La foto pendiente solo se envía en la sesión que la capturó. */
export function pendientePerteneceASesion(
  pendienteSesionId: string | null,
  sesionActual: string,
): boolean {
  return pendienteSesionId === sesionActual;
}

/** El estado del módulo debe reiniciarse cuando lo ve otra sesión distinta a la que lo creó. */
export function debeReiniciarPorSesion(sesionModulo: string | null, sesionActual: string): boolean {
  return sesionModulo !== null && sesionModulo !== sesionActual;
}

export interface RectRecorte {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Recorte cuadrado centrado sobre el lado menor, o `null` si no hay dimensiones válidas. */
export function recorteCuadradoCentrado(ancho: number, alto: number): RectRecorte | null {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) return null;
  const lado = Math.floor(Math.min(ancho, alto));
  return {
    originX: Math.floor((ancho - lado) / 2),
    originY: Math.floor((alto - lado) / 2),
    width: lado,
    height: lado,
  };
}

export type EstadoFotoVehiculo = 'cargando' | 'sin_foto' | 'con_foto' | 'desconocido';

/** Estado de la foto del servidor; un error de la consulta es `desconocido`, nunca `sin_foto`. */
export function estadoFotoVehiculo(opts: {
  cargando: boolean;
  error: boolean;
  datos: unknown;
}): EstadoFotoVehiculo {
  if (opts.datos) return 'con_foto';
  if (opts.cargando) return 'cargando';
  if (opts.error || opts.datos === undefined) return 'desconocido';
  return 'sin_foto';
}

/** El aviso de la pantalla de operación se muestra solo con certeza de que no hay foto (no durante la carga ni ante un error), salvo que se descartó hoy o haya recorrido activo. */
export function debeMostrarAviso(opts: {
  estadoFoto: EstadoFotoVehiculo;
  descartadoDia: string | null;
  ahora: Date;
  tracking: boolean;
}): boolean {
  if (opts.tracking || opts.estadoFoto !== 'sin_foto') return false;
  return opts.descartadoDia !== diaBolivia(opts.ahora);
}
