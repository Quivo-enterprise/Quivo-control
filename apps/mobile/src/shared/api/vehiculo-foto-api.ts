import { FotoVehiculoSchema, type FotoVehiculo, type SubirFotoVehiculoMovil } from '@quivo/shared';
import { ApiError, parseResponse, request } from './http-client';

/** ~700 KB de base64 sobre red móvil lenta supera los 12 s del cliente por defecto. */
const SUBIDA_TIMEOUT_MS = 40_000;

export const vehiculoFotoApi = {
  /** `null` si el vehículo aún no tiene foto (el API responde 200 con cuerpo vacío o `null`;
   * `http-client` devuelve `null` en ambos casos). */
  async obtener(accessToken: string): Promise<FotoVehiculo | null> {
    const payload = await request('/v1/mobile/vehiculo/foto', { method: 'GET', accessToken });
    if (!payload) return null;
    return parseResponse(FotoVehiculoSchema, payload);
  },

  /** Nunca loguear `body`: es la foto en base64. */
  async subir(accessToken: string, body: SubirFotoVehiculoMovil): Promise<FotoVehiculo> {
    const payload = await request('/v1/mobile/vehiculo/foto', {
      method: 'POST',
      accessToken,
      body,
      timeoutMs: SUBIDA_TIMEOUT_MS,
    });
    if (!payload) throw new ApiError('contract', 'Respuesta vacía al subir la foto');
    return parseResponse(FotoVehiculoSchema, payload);
  },
};
