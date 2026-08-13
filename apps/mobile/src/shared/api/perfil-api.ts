import { ContextoOperativoMovilSchema, type ContextoOperativoMovil } from '@quivo/shared';
import { AuthMovilApiError } from './auth-movil-api';

const REQUEST_TIMEOUT_MS = 12_000;
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const perfilApi = {
  async obtenerPerfil(accessToken: string): Promise<ContextoOperativoMovil> {
    if (!API_URL) {
      throw new AuthMovilApiError('configuration', 'Falta EXPO_PUBLIC_API_URL');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_URL}/v1/mobile/perfil`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new AuthMovilApiError('http', 'Fallo al obtener el perfil', response.status);
      }
      const payload = await response.json();
      const parsed = ContextoOperativoMovilSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AuthMovilApiError('contract', 'La respuesta del perfil no cumple el contrato');
      }
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof AuthMovilApiError) throw error;
      throw new AuthMovilApiError('network', error instanceof Error ? error.message : 'Error de red');
    } finally {
      clearTimeout(timeout);
    }
  },
};
