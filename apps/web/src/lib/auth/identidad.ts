/**
 * Clave de identidad autenticada para aislar el caché de React Query por cuenta. Si cambia
 * (logout, otra cuenta, otro rol/sindicato), todo lo cacheado pertenece a otra identidad y no
 * debe verse bajo la nueva: `ConsultasPorIdentidad` remonta el subárbol con un `QueryClient`
 * nuevo. Las claves de consulta (`['en-vivo', ...]`) no llevan usuario e incluyen placas y
 * nombres de conductores de OTRO sindicato.
 *
 * El token NO entra en la clave: rota en cada refresh sin que cambie la cuenta (si entrara,
 * la app entera se remontaría cada ~15 min).
 */
export interface IdentidadSesion {
  id: string;
  rol: string;
  sindicatoId: string | null;
}

/** Clave estable para "sin sesión" (distinta de cualquier identidad real). */
export const CLAVE_SIN_SESION = 'sin-sesion';

export function claveIdentidad(user: IdentidadSesion | null): string {
  return user ? `${user.id}|${user.rol}|${user.sindicatoId ?? ''}` : CLAVE_SIN_SESION;
}
