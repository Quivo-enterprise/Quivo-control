import type { RecorridoDetalle, RecorridoResumen, RecorridosQuery } from '@quivo/shared';
import { apiFetch } from './client';

function aQueryString(filtros: RecorridosQuery): string {
  const params = new URLSearchParams();
  if (filtros.desde) params.set('desde', filtros.desde.toISOString());
  if (filtros.hasta) params.set('hasta', filtros.hasta.toISOString());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const recorridosApi = {
  listar: (token: string, filtros: RecorridosQuery) =>
    apiFetch<RecorridoResumen[]>(`/reportes/recorridos${aQueryString(filtros)}`, token),
  obtener: (token: string, id: string) =>
    apiFetch<RecorridoDetalle>(`/reportes/recorridos/${id}`, token),
};
