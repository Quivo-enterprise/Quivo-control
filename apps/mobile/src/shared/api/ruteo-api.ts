import { RutaCalculadaSchema, type RutaCalculada } from '@quivo/shared';
import { parseResponse, request } from './http-client';

export const ruteoApi = {
  /** `null` si el servidor respondió sin ruta (OSRM apagado o puntos inalcanzables): el mapa cae
   * a la línea recta y no se reintenta. Red, timeout o 5xx LANZAN `ApiError`: el llamador
   * distingue el fallo (reintenta pasados 15 s) de la respuesta vacía. */
  async rutaAPunto(
    origen: { lat: number; lng: number },
    destino: { lat: number; lng: number },
    accessToken: string,
  ): Promise<RutaCalculada | null> {
    const params = new URLSearchParams({
      origenLat: String(origen.lat),
      origenLng: String(origen.lng),
      destinoLat: String(destino.lat),
      destinoLng: String(destino.lng),
    });
    const payload = await request(`/v1/mobile/ruta-a-punto?${params.toString()}`, {
      method: 'GET',
      accessToken,
    });
    if (!payload) return null;
    return parseResponse(RutaCalculadaSchema, payload);
  },
};
