import {
  RespuestaFilaMovilSchema,
  type LlegadaFila,
  type RespuestaFilaMovil,
  type SalidaFilaMovil,
} from '@quivo/shared';
import { ApiError, parseResponse, request } from './http-client';

/**
 * Fila de salida de la terminal. Ambas llamadas son idempotentes en el servidor. Lanzan `ApiError`:
 * 422 (fuera de zona / precisión > 100 m) y 409 (sin terminal, sesión inactiva, recorrido
 * finalizado) traen en `message` el texto del servidor, ya legible para el chofer.
 */
export const filaApi = {
  async llegada(accessToken: string, cuerpo: LlegadaFila): Promise<RespuestaFilaMovil> {
    const payload = await request('/v1/mobile/fila/llegada', { method: 'POST', accessToken, body: cuerpo });
    if (!payload) throw new ApiError('contract', 'Respuesta vacía de la llegada a la fila');
    return parseResponse(RespuestaFilaMovilSchema, payload);
  },

  async salida(accessToken: string, cuerpo: SalidaFilaMovil): Promise<RespuestaFilaMovil> {
    const payload = await request('/v1/mobile/fila/salida', { method: 'POST', accessToken, body: cuerpo });
    if (!payload) throw new ApiError('contract', 'Respuesta vacía de la salida de la fila');
    return parseResponse(RespuestaFilaMovilSchema, payload);
  },
};
