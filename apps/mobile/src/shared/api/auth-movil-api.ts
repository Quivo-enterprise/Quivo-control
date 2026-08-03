import {
  AuthConductorMovilResponseSchema,
  AuthVehiculoMovilResponseSchema,
  ContextoOperativoMovilSchema,
  RefreshMovilResponseSchema,
  type AuthConductorMovilRequest,
  type AuthConductorMovilResponse,
  type AuthVehiculoMovilRequest,
  type AuthVehiculoMovilResponse,
  type ContextoOperativoMovil,
  type RefreshMovilResponse,
} from '@quivo/shared';

const REQUEST_TIMEOUT_MS = 12_000;
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export class AuthMovilApiError extends Error {
  constructor(
    public readonly kind: 'configuration' | 'network' | 'http' | 'contract',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthMovilApiError';
  }

  get userMessage(): string {
    if (this.kind === 'configuration') return this.message;
    if (this.kind === 'network') {
      return `No se pudo conectar con QUIVO${API_URL ? ` en ${API_URL}` : ''}. Revisa el Wi-Fi y vuelve a intentar.`;
    }
    if (this.status === 429)
      return 'Demasiados intentos. Espera un minuto antes de volver a intentar.';
    if (this.status === 401) return 'Las credenciales no son válidas.';
    if (this.status === 400) return this.message;
    if (this.status === 404) return this.message;
    return 'La respuesta de QUIVO no pudo procesarse. Intenta nuevamente.';
  }
}

export const authMovilApi = {
  async autenticarVehiculo(data: AuthVehiculoMovilRequest): Promise<AuthVehiculoMovilResponse> {
    const payload = await request('/v1/mobile/auth/vehiculo', { method: 'POST', body: data });
    return parseResponse(AuthVehiculoMovilResponseSchema, payload);
  },

  async autenticarConductor(data: AuthConductorMovilRequest): Promise<AuthConductorMovilResponse> {
    const payload = await request('/v1/mobile/auth/conductor', { method: 'POST', body: data });
    return parseResponse(AuthConductorMovilResponseSchema, payload);
  },

  async refresh(refreshToken: string): Promise<RefreshMovilResponse> {
    const payload = await request('/v1/mobile/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
    return parseResponse(RefreshMovilResponseSchema, payload);
  },

  async obtenerContexto(accessToken: string): Promise<ContextoOperativoMovil> {
    const payload = await request('/v1/mobile/auth/contexto-operativo', {
      method: 'GET',
      accessToken,
    });
    return parseResponse(ContextoOperativoMovilSchema, payload);
  },

  async logout(refreshToken: string): Promise<void> {
    await request('/v1/mobile/auth/logout', { method: 'POST', body: { refreshToken } });
  },
};

interface RequestOptions {
  method: 'GET' | 'POST';
  body?: unknown;
  accessToken?: string;
}

async function request(path: string, options: RequestOptions): Promise<unknown> {
  if (!API_URL) {
    throw new AuthMovilApiError(
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
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = response.status === 204 ? null : await parseJson(response);
    if (!response.ok) {
      throw new AuthMovilApiError('http', extraerMensaje(payload), response.status);
    }
    return payload;
  } catch (error: unknown) {
    if (error instanceof AuthMovilApiError) throw error;
    throw new AuthMovilApiError('network', error instanceof Error ? error.message : 'Error de red');
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthMovilApiError('contract', 'La API devolvió una respuesta inválida');
  }
}

function parseResponse<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AuthMovilApiError('contract', 'La respuesta de la API no cumple el contrato móvil');
  }
  return parsed.data;
}

function extraerMensaje(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'issues' in payload &&
    Array.isArray(payload.issues)
  ) {
    const issue = payload.issues.find(
      (candidate): candidate is { message: string } =>
        Boolean(candidate) &&
        typeof candidate === 'object' &&
        'message' in candidate &&
        typeof candidate.message === 'string',
    );
    if (issue) return issue.message;
  }
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

export function apiMovilConfigurada(): string | null {
  return API_URL ?? null;
}
