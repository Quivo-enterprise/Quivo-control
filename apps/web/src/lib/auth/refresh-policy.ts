/** Qué hacer cuando `POST /v1/auth/refresh` falla. `status` es el HTTP status de la API, o
 * `null` si no hubo respuesta (error de red, offline, timeout). Un 4xx es definitivo (el
 * request o el token no van a mejorar solos: 401 sesión muerta, 400/403/404 el mismo token
 * muerto reenviado en loop) salvo 408 y 429, que son transitorios. Sin respuesta, 5xx, 408 y
 * 429: se conserva la sesión y se reintenta. */
export function decidirTrasFalloRefresh(status: number | null): 'logout' | 'retry' {
  if (status === null || status === 408 || status === 429) {
    return 'retry';
  }
  return status >= 400 && status < 500 ? 'logout' : 'retry';
}

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;
const RETRY_STEADY_MS = 60_000;

/** Backoff del reintento número `intento` (0-based): 5 s, 15 s, 30 s y luego cada 60 s. */
export function retryDelayMs(intento: number): number {
  return RETRY_DELAYS_MS[intento] ?? RETRY_STEADY_MS;
}
