import { RutaCalculadaSchema, type RutaCalculada } from '@quivo/shared';
import { parseResponse, request } from './http-client';

export const ruteoApi = {
  /** `null` si el servidor respondió sin ruta (OSRM apagado o puntos inalcanzables): el mapa cae
   * a la línea recta y no se reintenta. Todo error LANZA `ApiError`: el llamador reintenta
   * pasados 15 s solo si es de transporte (`network` o HTTP >= 500); 4xx, contrato y
   * configuración no se reintentan y se reportan. */
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
