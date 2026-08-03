import { PaqueteDiaSchema, type PaqueteDia } from '@quivo/shared';
import { ApiError as PaqueteDiaApiError, parseResponse, request } from './http-client';

export { PaqueteDiaApiError };

export const paqueteDiaApi = {
  async obtenerAsignacionDelDia(accessToken: string): Promise<PaqueteDia> {
    const payload = await request('/v1/mobile/asignacion-del-dia', {
      method: 'GET',
      accessToken,
    });
    return parseResponse(PaqueteDiaSchema, payload);
  },
};
