/** Qué hacer cuando `POST /v1/auth/refresh` falla. `status` es el HTTP status de la API, o
 * `null` si no hubo respuesta (error de red, offline, timeout). Solo un 401 real significa que
 * la sesión murió; red caída, 5xx o cualquier otro status son transitorios: se conserva la
 * sesión y se reintenta. */
export function decidirTrasFalloRefresh(status: number | null): 'logout' | 'retry' {
  return status === 401 ? 'logout' : 'retry';
}

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;
const RETRY_STEADY_MS = 60_000;

/** Backoff del reintento número `intento` (0-based): 5 s, 15 s, 30 s y luego cada 60 s. */
export function retryDelayMs(intento: number): number {
  return RETRY_DELAYS_MS[intento] ?? RETRY_STEADY_MS;
}
