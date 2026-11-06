import type { AuthUser, LoginResponse, RefreshResponse } from '@quivo/shared';

export type { AuthUser, LoginResponse, RefreshResponse };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(`Login falló (HTTP ${response.status})`);
  }

  return (await response.json()) as LoginResponse;
}

/** Error de refresh con respuesta HTTP: `status` distingue un 401 real (sesión muerta) de un
 * 5xx transitorio. Un fallo de red lanza el `TypeError` de `fetch`, sin `status`. */
export class RefreshHttpError extends Error {
  constructor(readonly status: number) {
    super(`Refresh de sesión falló (HTTP ${status})`);
  }
}

const REFRESH_TIMEOUT_MS = 15_000;

export async function refreshRequest(refreshToken: string): Promise<RefreshResponse> {
  // AbortController + setTimeout (no `AbortSignal.timeout`, que Chrome < 103 no tiene): un request
  // colgado dejaría `refrescandoRef` en true y la cadena de refresh muerta. El abort lanza
  // `AbortError` (sin `status`), que la política trata como fallo de red y reintenta.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RefreshHttpError(response.status);
    }

    return (await response.json()) as RefreshResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** QUI-251 — revoca la sesión server-side al cerrar sesión (antes solo se borraba el
 * token del browser, dejando el `refreshToken` robado válido hasta su expiración natural). */
export async function logoutRequest(refreshToken: string): Promise<void> {
  await fetch(`${API_URL}/v1/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
}
