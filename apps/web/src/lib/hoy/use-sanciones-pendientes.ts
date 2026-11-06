import { useQuery } from '@tanstack/react-query';
import { sancionesApi } from '../api/sanciones';

/** Tope de filas de `GET /sanciones` (LIMITE_FILAS en la API): con tantas, el conteo real es mayor. */
export const LIMITE_SANCIONES_API = 200;

export const SANCIONES_PENDIENTES_KEY = ['hoy', 'sanciones-pendientes'] as const;

/** Todas las pendientes (sin filtro de fecha). Hoy y Alertas comparten key, así que comparten caché. */
export function useSancionesPendientes(token: string | null | undefined, activo = true) {
  return useQuery({
    queryKey: SANCIONES_PENDIENTES_KEY,
    enabled: Boolean(token) && activo,
    queryFn: () => sancionesApi.listar(token as string, { estado: 'pendiente' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
