/**
 * Decodificación (no verificación) del payload de un JWT — solo para leer `exp` y
 * programar el refresh de sesión en el cliente. La verificación real de firma la hace
 * la API (QUI-219); esto nunca se usa para autorizar nada, solo para UX de refresh.
 */
function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  if (typeof atob === 'function') {
    return decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  }

  return Buffer.from(padded, 'base64').toString('utf-8');
}

export interface JwtPayload {
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  const [, payloadSegment, ...rest] = token.split('.');
  if (!payloadSegment || rest.length !== 1) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(payloadSegment)) as JwtPayload;
  } catch {
    return null;
  }
}

/** Milisegundos epoch en que expira el token, o `null` si no se puede determinar. */
export function getJwtExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return null;
  }
  return payload.exp * 1000;
}
