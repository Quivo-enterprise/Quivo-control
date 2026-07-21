/**
 * Contrato esperado de POST /v1/auth/login (doc técnico §5, §8). El endpoint real llega
 * en QUI-219 — hasta entonces esta llamada falla (network error / 404), lo cual es
 * esperado. El bypass de desarrollo (`auth-context.tsx`) permite navegar el resto de la
 * app mientras tanto.
 */
export interface LoginResponseUser {
  id: string;
  email: string;
  rol: string;
  sindicatoId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: LoginResponseUser;
}

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
