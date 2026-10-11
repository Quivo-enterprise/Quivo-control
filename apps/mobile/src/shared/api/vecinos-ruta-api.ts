import { VecinosRutaSchema, type VecinosRuta } from '@quivo/shared';
import { ApiError, parseResponse, request } from './http-client';

export const vecinosRutaApi = {
  /**
   * Vecinos delante/detrás en la misma ruta. `lat`/`lng` son opcionales (sin ellas el servidor usa
   * la última posición del resumen GPS): si no se conocen NO se envían, nunca como string vacío.
   * Lanza `ApiError` — el hook decide qué hacer (conserva el último dato bueno).
   */
  async obtener(
    accessToken: string,
    posicion?: { lat: number; lng: number } | null,
  ): Promise<VecinosRuta> {
    const params = new URLSearchParams();
    if (posicion && Number.isFinite(posicion.lat) && Number.isFinite(posicion.lng)) {
      params.set('lat', String(posicion.lat));
      params.set('lng', String(posicion.lng));
    }
    const query = params.toString();
    const payload = await request(`/v1/mobile/vecinos-ruta${query ? `?${query}` : ''}`, {
      method: 'GET',
      accessToken,
    });
    if (!payload) throw new ApiError('contract', 'Respuesta vacía de vecinos de ruta');
    return parseResponse(VecinosRutaSchema, payload);
  },
};
