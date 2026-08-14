import pako from 'pako';
import { SyncBatchResponseSchema, type EventoSync, type SyncBatchResponse } from '@quivo/shared';
import { API_URL, ApiError, parseResponse } from './http-client';

export { ApiError as SyncApiError };

const REQUEST_TIMEOUT_MS = 20_000; // lotes grandes comprimidos — más margen que el resto de los clientes

/**
 * `POST /v1/sync/batches` (QUI-240): el body se manda gzip (`pako`, JS puro — React
 * Native/Hermes no tiene `CompressionStream` ni `zlib` nativo) con `Content-Encoding: gzip`,
 * que el servidor descomprime de forma transparente (hook `preParsing` en `apps/api/src/
 * main.ts`). No reutiliza `request()` de `http-client.ts` porque ese helper siempre manda
 * JSON de texto plano — acá el body es binario.
 */
export const syncApi = {
  async enviarLote(eventos: EventoSync[], accessToken: string): Promise<SyncBatchResponse> {
    if (!API_URL) {
      throw new ApiError(
        'configuration',
        'Falta EXPO_PUBLIC_API_URL. Inicia el proyecto con pnpm dev para detectar la IP de la PC.',
      );
    }

    // `pako.gzip` reusa un buffer interno más grande que el resultado real y devuelve un
    // `Uint8Array` recortado con `subarray` — `.buffer` a secas incluye esos bytes de más
    // (encontrado en un dispositivo real: el servidor recibía un body vacío/corrupto,
    // "Body is not valid JSON but content-type is set to 'application/json'"). Hay que
    // recortar al rango real (`byteOffset`..`byteOffset+byteLength`) antes de mandarlo.
    const salidaGzip = pako.gzip(JSON.stringify({ eventos }));
    const comprimido = salidaGzip.buffer.slice(
      salidaGzip.byteOffset,
      salidaGzip.byteOffset + salidaGzip.byteLength,
    ) as ArrayBuffer;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_URL}/v1/sync/batches`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          // `Content-Encoding` normal no le llega al servidor: confirmado en un dispositivo
          // real (Moto E13) que React Native (vía OkHttp en Android) descarta ese header
          // específico antes de mandar la request — el server nunca veía el header y
          // trataba los bytes gzip crudos como si fueran JSON de texto plano. Un nombre de
          // header no estándar sí sobrevive.
          'X-Content-Encoding': 'gzip',
          Authorization: `Bearer ${accessToken}`,
        },
        body: comprimido,
      });
      const payload = response.status === 204 ? null : await parseJson(response);
      if (!response.ok) {
        throw new ApiError('http', extraerMensaje(payload), response.status);
      }
      return parseResponse(SyncBatchResponseSchema, payload);
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', error instanceof Error ? error.message : 'Error de red');
    } finally {
      clearTimeout(timeout);
    }
  },
};

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError('contract', 'La API devolvió una respuesta inválida');
  }
}

function extraerMensaje(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }
  return 'Solicitud rechazada';
}
