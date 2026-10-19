import {
  PRECISION_MAX_M,
  VecinosRutaSchema,
  type FaseCircuito,
  type VecinosRuta,
} from '@quivo/shared';
import { ApiError, parseResponse, request } from './http-client';

export type PosicionVecinos = { lat: number; lng: number; accuracy?: number | null };

/**
 * Query string de la consulta. `lat`/`lng` son opcionales (sin ellas el servidor usa la última
 * posición buena del resumen GPS): si no se conocen NO se envían, nunca como string vacío. Un fix con
 * `accuracy` > `PRECISION_MAX_M` tampoco se envía (el servidor usa el último bueno); sin `accuracy`
 * se envía como siempre. `fase`
 * (ida/regreso del circuito) también: sin ella el servidor la deriva de la vuelta en curso.
 */
export function construirQueryVecinos(
  posicion?: PosicionVecinos | null,
  fase?: FaseCircuito | null,
): string {
  const params = new URLSearchParams();
  const precisa = posicion?.accuracy == null || posicion.accuracy <= PRECISION_MAX_M;
  if (posicion && precisa && Number.isFinite(posicion.lat) && Number.isFinite(posicion.lng)) {
    params.set('lat', String(posicion.lat));
    params.set('lng', String(posicion.lng));
  }
  if (fase) params.set('fase', fase);
  return params.toString();
}

export const vecinosRutaApi = {
  /**
   * Vecinos delante/detrás en la misma ruta (ver `construirQueryVecinos`).
   * Lanza `ApiError` — el hook decide qué hacer (conserva el último dato bueno).
   */
  async obtener(
    accessToken: string,
    posicion?: PosicionVecinos | null,
    fase?: FaseCircuito | null,
  ): Promise<VecinosRuta> {
    const query = construirQueryVecinos(posicion, fase);
    const payload = await request(`/v1/mobile/vecinos-ruta${query ? `?${query}` : ''}`, {
      method: 'GET',
      accessToken,
    });
    if (!payload) throw new ApiError('contract', 'Respuesta vacía de vecinos de ruta');
    return parseResponse(VecinosRutaSchema, payload);
  },
};
