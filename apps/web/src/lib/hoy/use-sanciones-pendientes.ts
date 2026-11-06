import { useQuery } from '@tanstack/react-query';
import { sancionesApi } from '../api/sanciones';

/** Tope de filas de `GET /sanciones` (LIMITE_FILAS en la API): con tantas, el conteo real es mayor. */
export const LIMITE_SANCIONES_API = 200;

/** Todas las pendientes (sin filtro de fecha). Hoy y Alertas comparten key, así que comparten caché. */
export function useSancionesPendientes(token: string | null | undefined) {
  return useQuery({
    queryKey: ['hoy', 'sanciones-pendientes'],
    enabled: Boolean(token),
    queryFn: () => sancionesApi.listar(token as string, { estado: 'pendiente' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
