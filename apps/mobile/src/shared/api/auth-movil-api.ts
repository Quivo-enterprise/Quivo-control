import {
  AuthConductorMovilResponseSchema,
  AuthSesionMovilResponseSchema,
  AuthVehiculoMovilResponseSchema,
  CODIGO_SESION_NO_VIGENTE,
  ContextoOperativoMovilSchema,
  RefreshMovilResponseSchema,
  type AuthConductorMovilRequest,
  type AuthConductorMovilResponse,
  type AuthSesionMovilRequest,
  type AuthSesionMovilResponse,
  type AuthVehiculoMovilRequest,
  type AuthVehiculoMovilResponse,
  type ContextoOperativoMovil,
  type RefreshMovilResponse,
  type SeleccionAsignacionMovilRequest,
} from '@quivo/shared';

const REQUEST_TIMEOUT_MS = 12_000;
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
export class AuthMovilApiError extends Error {
  constructor(
    public readonly kind: 'configuration' | 'network' | 'http' | 'contract',
    message: string,
    public readonly status?: number,
    /** Sólo viene poblado en un 429 de `POST /v1/mobile/auth/sesion` (lockout por vehículo,
     * `LockoutMovilExceptionFilter`). Ver `userMessage` para cómo se usa. */
    public readonly retryAfterSeconds?: number,
    /** Entrega 28 (`docs/plan-correccion-post-piloto-2026-09-09.md`): código distinguible
     * del body del error — hoy sólo `CODIGO_SESION_NO_VIGENTE` en un refresh rechazado
     * porque la sesión ya no es vigente (`AuthMovilService.refresh`,
     * `SesionNoVigenteException`). `undefined` para cualquier otro error (la inmensa
     * mayoría, incluidos los 401 "de siempre" que un cliente viejo sigue viendo igual). */
    public readonly codigo?: string,
  ) {
    super(message);
    this.name = 'AuthMovilApiError';
  }

  /**
   * Rescope SESION_NO_VIGENTE (decisión del CTO, code review): refresh token que se mandó en
   * el intento que produjo ESTE error — solo lo puebla `authMovilApi.refresh` (abajo), que es
   * el único método con un refresh token que tenga sentido "recordar". Mutable (no en el
   * constructor) para no tocar los 8+ call sites que ya construyen `AuthMovilApiError` sin este
   * dato. `undefined` para cualquier error que no venga de ese método. Ver
   * `obtenerRefreshTokenRechazado` y, del lado del caller, `confirmarTokenRechazadoVigente`
   * (`use-auth-movil.ts`): antes de cualquier acción destructiva ante `SESION_NO_VIGENTE`, hay
   * que saber CUÁL token fue el rechazado para poder compararlo contra el que haya en disco en
   * ese momento (pudo haber cambiado por un login nuevo mientras el rechazo viajaba de vuelta).
   */
  public refreshTokenEnviado?: string;

  get userMessage(): string {
    if (this.kind === 'configuration') return this.message;
    if (this.kind === 'network') {
      return `No se pudo conectar con QUIVO${API_URL ? ` en ${API_URL}` : ''}. Revisa el Wi-Fi y vuelve a intentar.`;
    }
    // Entrega 28: mensaje en lenguaje de chofer para la sesión definitivamente muerta —
    // distinto del genérico "Las credenciales no son válidas." de un 401 sin código, que
    // suena a PIN equivocado en vez de "hay que volver a entrar".
    if (this.codigo === CODIGO_SESION_NO_VIGENTE) {
      return 'Tu sesión ya no es válida en este dispositivo. Vuelve a iniciar sesión.';
    }
    if (this.status === 429) {
      // El lockout de POST /sesion es progresivo por vehículo, `min(2^(fallos-3), 60)`
      // (auth-movil.service.ts) — casi nunca son 60s reales, sobre todo en los primeros
      // fallos del backoff. Mostrar "un minuto" siempre asusta de más al chofer y no le dice
      // cuánto esperar de verdad. Si el servidor no manda `retryAfterSeconds` (ni en el body
      // ni en el header `Retry-After`), se mantiene el texto genérico de antes.
      if (this.retryAfterSeconds && this.retryAfterSeconds > 0) {
        const segundos = Math.ceil(this.retryAfterSeconds);
        return `Demasiados intentos. Espera ${segundos} ${segundos === 1 ? 'segundo' : 'segundos'} antes de volver a intentar.`;
      }
      return 'Demasiados intentos. Espera un minuto antes de volver a intentar.';
    }
    if (this.status === 401) return 'Las credenciales no son válidas.';
    if (this.status === 400) return this.message;
    if (this.status === 404) return this.message;
    // 409 = PIN correcto pero sin rotación publicada hoy (`sinRotacionPublicada`,
    // auth-movil.service.ts) — el mensaje del backend ya trae el nombre del conductor y la
    // placa (p. ej. "Juan Pérez, hoy no tenés una rotación publicada para 1234ABC"), así que
    // hay que mostrarlo tal cual en vez del genérico de abajo.
    if (this.status === 409) return this.message;
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

  /** Login de un solo paso (placa + PIN del conductor) — reemplaza a la pareja
   * `autenticarVehiculo` + `autenticarConductor` de arriba en el flujo real de la app; esas
   * dos quedan vivas sólo para el legado detrás de `MOBILE_LEGACY_AUTH_ENABLED`. */
  async autenticarSesion(data: AuthSesionMovilRequest): Promise<AuthSesionMovilResponse> {
    const payload = await request('/v1/mobile/auth/sesion', { method: 'POST', body: data });
    return parseResponse(AuthSesionMovilResponseSchema, payload);
  },

  /** Segundo request cuando `autenticarSesion` devuelve `seleccion_requerida` (≥2 asignaciones
   * hoy). `seleccionToken` es un `DesafioAuthMovil` reciclado, ya con el conductor probado. */
  async seleccionarAsignacionSesion(
    data: SeleccionAsignacionMovilRequest,
  ): Promise<AuthSesionMovilResponse> {
    const payload = await request('/v1/mobile/auth/sesion/asignacion', {
      method: 'POST',
      body: data,
    });
    return parseResponse(AuthSesionMovilResponseSchema, payload);
  },

  async refresh(refreshToken: string): Promise<RefreshMovilResponse> {
    try {
      const payload = await request('/v1/mobile/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
      });
      return parseResponse(RefreshMovilResponseSchema, payload);
    } catch (error) {
      // Rescope SESION_NO_VIGENTE: adjunta el token EXACTO que se mandó — ver el docblock de
      // `AuthMovilApiError.refreshTokenEnviado`. `request()` ya construyó el error tal cual
      // (kind/status/codigo); acá solo se le agrega este dato antes de re-lanzarlo.
      if (error instanceof AuthMovilApiError) {
        error.refreshTokenEnviado = refreshToken;
      }
      throw error;
    }
  },

  async obtenerContexto(accessToken: string): Promise<ContextoOperativoMovil> {
    const payload = await request('/v1/mobile/auth/contexto-operativo', {
      method: 'GET',
      accessToken,
    });
    return parseResponse(ContextoOperativoMovilSchema, payload);
  },

  /** `deviceId` opcional (Entrega 3, `docs/plan-correccion-post-piloto-2026-09-09.md`): lo
   * manda el caller (`use-auth-movil.ts`) como fallback server-side para cuando el
   * `refreshToken` local ya quedó obsoleto por una rotación no confirmada — ver el docblock
   * de `AuthMovilService.logout` (`apps/api/.../auth-movil.service.ts`) para el detalle. */
  async logout(refreshToken: string, deviceId?: string): Promise<void> {
    await request('/v1/mobile/auth/logout', { method: 'POST', body: { refreshToken, deviceId } });
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
      throw new AuthMovilApiError(
        'http',
        extraerMensaje(payload),
        response.status,
        extraerRetryAfterSeconds(payload, response.headers.get('Retry-After')),
        extraerCodigo(payload),
      );
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

/** `LockoutMovilExceptionFilter` (backend) manda el mismo valor dos veces: en el body
 * (`{ retryAfterSeconds }`) y en el header `Retry-After`. Se prioriza el body por ser el
 * contrato tipado (`AuthSesionMovilRequestSchema`-adyacente); el header es el fallback si
 * algún proxy intermedio llegara a pelar el body de un 429. */
function extraerRetryAfterSeconds(payload: unknown, header: string | null): number | undefined {
  if (
    payload &&
    typeof payload === 'object' &&
    'retryAfterSeconds' in payload &&
    typeof (payload as { retryAfterSeconds: unknown }).retryAfterSeconds === 'number'
  ) {
    return (payload as { retryAfterSeconds: number }).retryAfterSeconds;
  }
  const desdeHeader = header ? Number(header) : NaN;
  return Number.isFinite(desdeHeader) && desdeHeader > 0 ? desdeHeader : undefined;
}

/** Entrega 28: extrae el campo `codigo` del body del error, si vino — hoy sólo
 * `SesionNoVigenteException` (API) lo agrega. */
function extraerCodigo(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === 'object' &&
    'codigo' in payload &&
    typeof (payload as { codigo: unknown }).codigo === 'string'
  ) {
    return (payload as { codigo: string }).codigo;
  }
  return undefined;
}

/** Entrega 28: helper único para el chequeo que repiten `refresh-circuit-breaker.ts`,
 * `use-auth-movil.ts` y `headless-task.ts` — evita que cada caller repita
 * `error instanceof AuthMovilApiError && error.codigo === CODIGO_SESION_NO_VIGENTE` a mano. */
export function esSesionNoVigente(error: unknown): boolean {
  return error instanceof AuthMovilApiError && error.codigo === CODIGO_SESION_NO_VIGENTE;
}

/** Rescope SESION_NO_VIGENTE: `refreshTokenEnviado` del error si lo tiene (ver su docblock en
 * la clase) — `undefined` para cualquier error que no sea `AuthMovilApiError` o que no venga de
 * `authMovilApi.refresh`. Los callers (`headless-task.ts`, `use-auth-movil.ts`) caen de vuelta
 * al refresh token que ya tenían en memoria cuando esto da `undefined`. */
export function obtenerRefreshTokenRechazado(error: unknown): string | undefined {
  return error instanceof AuthMovilApiError ? error.refreshTokenEnviado : undefined;
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
