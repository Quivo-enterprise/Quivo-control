const REQUEST_TIMEOUT_MS = 12_000;

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

/** Cliente HTTP genérico compartido por los clientes móviles nuevos (paquete del día,
 * sync por lotes) — mismo shape de error/timeout que `auth-movil-api.ts`, extraído acá
 * para no repetirlo en cada cliente nuevo. `auth-movil-api.ts` mantiene su propia copia
 * (código ya verificado en Android) para no arriesgar una regresión ahí. */
export class ApiError extends Error {
  constructor(
    public readonly kind: 'configuration' | 'network' | 'http' | 'contract',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get userMessage(): string {
    if (this.kind === 'configuration') return this.message;
    if (this.kind === 'network') {
      return `No se pudo conectar con QUIVO${API_URL ? ` en ${API_URL}` : ''}. Revisa el Wi-Fi y vuelve a intentar.`;
    }
    if (this.status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    if (this.status === 404) return this.message;
    return 'La respuesta de QUIVO no pudo procesarse. Intenta nuevamente.';
  }
}

interface RequestOptions {
  method: 'GET' | 'POST';
  body?: unknown;
  accessToken?: string;
  headers?: Record<string, string>;
}

export async function request(path: string, options: RequestOptions): Promise<unknown> {
  if (!API_URL) {
    throw new ApiError(
      'configuration',
      'Falta EXPO_PUBLIC_API_URL. Inicia el proyecto con pnpm dev para detectar la IP de la PC.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: options.method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = response.status === 204 ? null : await parseJson(response);
    if (!response.ok) {
      throw new ApiError('http', extraerMensaje(payload), response.status);
    }
    return payload;
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', error instanceof Error ? error.message : 'Error de red');
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError('contract', 'La API devolvió una respuesta inválida');
  }
}

export function parseResponse<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError('contract', 'La respuesta de la API no cumple el contrato');
  }
  return parsed.data;
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

export function apiConfigurada(): string | null {
  return API_URL ?? null;
}
