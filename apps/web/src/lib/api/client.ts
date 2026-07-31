const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch autenticado contra `apps/api` — usado por los módulos CRUD reales de M1
 * (sindicatos/socios/vehiculos/conductores/lineas, QUI-220..224). No sirve bajo el bypass
 * de desarrollo: ese token es opaco (`'dev-bypass-token'`) y `JwtAuthGuard` lo rechaza. */
export async function apiFetch<T>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API_URL}/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? `Error de API (HTTP ${response.status})`);
  }

  return (await response.json()) as T;
}
