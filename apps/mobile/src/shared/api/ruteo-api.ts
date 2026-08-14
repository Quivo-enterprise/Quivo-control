import { RutaCalculadaSchema, type RutaCalculada } from '@quivo/shared';
import { parseResponse, request } from './http-client';

export const ruteoApi = {
  /** `null` si OSRM no pudo calcular una ruta (sin red, servicio caído, puntos
   * inalcanzables) — el mapa cae a la línea recta existente, no es un error bloqueante. */
  async rutaAPunto(
    origen: { lat: number; lng: number },
    destino: { lat: number; lng: number },
    accessToken: string,
  ): Promise<RutaCalculada | null> {
    try {
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
    } catch {
      return null;
    }
  },
};
