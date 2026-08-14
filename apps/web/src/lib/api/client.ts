const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ApiErrorBody {
  message?: string | string[];
  issues?: Array<{ path?: Array<string | number>; message?: string }>;
}

function mensajeDeApiError(body: ApiErrorBody | null, fallback: string): string {
  const issue = body?.issues?.find((candidate) => candidate.message);
  if (issue?.message) {
    const field = issue.path?.[0];
    return field === undefined ? issue.message : `${String(field)}: ${issue.message}`;
  }
  if (Array.isArray(body?.message)) return body.message.join('. ');
  return body?.message ?? fallback;
}

/** Fetch autenticado contra `apps/api` — usado por los módulos CRUD reales de M1
 * (sindicatos/socios/vehiculos/conductores/lineas, QUI-220..224). No sirve bajo el bypass
 * de desarrollo: ese token es opaco (`'dev-bypass-token'`) y `JwtAuthGuard` lo rechaza. */
export async function apiFetch<T>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const tieneBody = init?.body !== undefined;
  const response = await fetch(`${API_URL}/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      // Fastify rechaza un body vacío si el header dice `application/json` (ej. los `POST`
      // sin body de rotaciones/:id/publicar y /anular, QUI-232) — solo se manda si hay algo
      // que mandar.
      ...(tieneBody ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
    body: tieneBody ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      mensajeDeApiError(body, `Error de API (HTTP ${response.status})`),
    );
  }

  // 204 (ej. POST /auth/admin/reset-password) no trae body — `.json()` sobre eso tira.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Descarga un archivo autenticado (ej. CSV de `/reportes/exportar/*`, QUI-249) y dispara el
 * guardado en el navegador — un `<a href>` plano no puede llevar el header `Authorization`,
 * así que hace falta `fetch` + blob + un link temporal en vez de navegación directa. */
export async function apiDownload(
  path: string,
  token: string,
  nombreArchivo: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      mensajeDeApiError(body, `Error de API (HTTP ${response.status})`),
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nombreArchivo;
  link.click();
  URL.revokeObjectURL(url);
}
