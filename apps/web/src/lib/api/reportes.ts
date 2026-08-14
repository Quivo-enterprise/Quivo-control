import type { CumplimientoFila, CumplimientoQuery } from '@quivo/shared';
import { apiFetch } from './client';

function aQueryString(filtros: CumplimientoQuery): string {
  const params = new URLSearchParams();
  params.set('por', filtros.por);
  if (filtros.desde) params.set('desde', filtros.desde.toISOString());
  if (filtros.hasta) params.set('hasta', filtros.hasta.toISOString());
  return `?${params.toString()}`;
}

export const reportesApi = {
  cumplimiento: (token: string, filtros: CumplimientoQuery) =>
    apiFetch<CumplimientoFila[]>(`/reportes/cumplimiento${aQueryString(filtros)}`, token),
};
