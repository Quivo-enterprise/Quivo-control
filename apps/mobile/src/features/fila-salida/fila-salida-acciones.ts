import { ApiError } from '../../shared/api/http-client';
import { filaApi } from '../../shared/api/fila-api';
import { esErrorAcusePermanente } from '../vuelta-actual/vuelta-actual-core';
import {
  incorporarFilaDeAccion,
  solicitarRefresco,
} from '../vuelta-actual/vuelta-actual-oportunista';
import type { FixFila } from './zona-terminal';

/**
 * Acciones de red de la fila de salida (sin React: las usan el botón y la detección de zona, que
 * también corre en headless). Tras un éxito se incorpora la `fila` que devuelve el POST al estado
 * local y se pide un refresco de la vuelta actual (el canal normal del estado). Nunca rechazan.
 */

export type ResultadoFila = { ok: true } | { ok: false; mensaje: string };

type ObtenerToken = () => Promise<string | null>;

const PAUSAS_REINTENTO_MS = [1_500, 3_000];
const MENSAJE_SIN_RED = 'No se pudo conectar. Revisá la conexión y volvé a intentar.';
const MENSAJE_SESION = 'Tu sesión expiró. Volvé a iniciar sesión.';

/** 422/409 traen el motivo en español desde el servidor; el resto va con un texto genérico. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return MENSAJE_SIN_RED;
    if (error.kind === 'http' && (error.status === 422 || error.status === 409) && error.message) {
      return error.message;
    }
    if (error.status === 401) return MENSAJE_SESION;
  }
  return 'No se pudo completar la acción. Intentá de nuevo.';
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `POST /mobile/fila/salida`. Idempotente, así que ante red/5xx reintenta (`intentos` en total,
 * con pausa corta) como el acuse de Molinos; un 4xx permanente corta de inmediato. El botón usa 3
 * intentos; la salida por geocerca en headless, 1 (el siguiente fix reintenta, con anti-rebote).
 */
export async function registrarSalida(
  obtenerToken: ObtenerToken,
  origen: 'boton' | 'geocerca',
  intentos = 3,
): Promise<ResultadoFila> {
  let ultimo: unknown = null;
  for (let i = 0; i < intentos; i += 1) {
    if (i > 0) await esperar(PAUSAS_REINTENTO_MS[i - 1] ?? 3_000);
    try {
      const token = await obtenerToken();
      if (!token) return { ok: false, mensaje: MENSAJE_SESION };
      const r = await filaApi.salida(token, { origen });
      await incorporarFilaDeAccion(r.fila);
      await solicitarRefresco(obtenerToken);
      return { ok: true };
    } catch (error) {
      ultimo = error;
      if (esErrorAcusePermanente(error)) break;
    }
  }
  return { ok: false, mensaje: mensajeDeError(ultimo) };
}

/** `POST /mobile/fila/llegada`: un solo intento (quien llama decide cuándo repetir). */
export async function registrarLlegada(
  obtenerToken: ObtenerToken,
  fix: FixFila,
): Promise<ResultadoFila> {
  try {
    const token = await obtenerToken();
    if (!token) return { ok: false, mensaje: MENSAJE_SESION };
    const r = await filaApi.llegada(token, {
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      tsFix: fix.ts,
    });
    await incorporarFilaDeAccion(r.fila);
    await solicitarRefresco(obtenerToken);
    return { ok: true };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}
