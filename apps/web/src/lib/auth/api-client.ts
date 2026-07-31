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

export async function refreshRequest(refreshToken: string): Promise<RefreshResponse> {
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new Error(`Refresh de sesión falló (HTTP ${response.status})`);
  }

  return (await response.json()) as RefreshResponse;
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
