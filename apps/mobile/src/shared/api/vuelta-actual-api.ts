import { VueltaActualMovilSchema, type AcuseVuelta, type VueltaActualMovil } from '@quivo/shared';
import { ApiError, parseResponse, request } from './http-client';

export const vueltaActualApi = {
  /** Vuelta en curso de la sesión del token (la sesión sale del token, nunca del cliente).
   * Lanza `ApiError` — quien llama decide qué hacer (conserva el último estado bueno). */
  async obtener(accessToken: string): Promise<VueltaActualMovil> {
    const payload = await request('/v1/mobile/vuelta-actual', { method: 'GET', accessToken });
    if (!payload) throw new ApiError('contract', 'Respuesta vacía de la vuelta actual');
    return parseResponse(VueltaActualMovilSchema, payload);
  },

  /** Acuse de la designación (idempotente en el servidor). `designadaEn` va tal cual lo devolvió
   * el servidor: identifica QUÉ designación se confirma. El servidor responde con la vuelta
   * actualizada; si el cuerpo falta o no cumple el contrato devuelve `null` (el acuse igual se
   * mandó: quien llama refresca con un GET). */
  async acusar(accessToken: string, acuse: AcuseVuelta): Promise<VueltaActualMovil | null> {
    const payload = await request('/v1/mobile/vuelta-actual/acuse', {
      method: 'POST',
      accessToken,
      body: acuse,
    });
    const parsed = VueltaActualMovilSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  },
};
