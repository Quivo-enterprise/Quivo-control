import type { SyncErrorEntry, SyncErroresQuery } from '@quivo/shared';
import { apiFetch } from './client';

function aQueryString(filtros: SyncErroresQuery): string {
  const params = new URLSearchParams();
  if (filtros.deviceId) params.set('deviceId', filtros.deviceId);
  if (filtros.sesionId) params.set('sesionId', filtros.sesionId);
  if (filtros.desde) params.set('desde', filtros.desde.toISOString());
  if (filtros.hasta) params.set('hasta', filtros.hasta.toISOString());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const syncErroresApi = {
  listar: (token: string, filtros: SyncErroresQuery) =>
    apiFetch<SyncErrorEntry[]>(`/sync-errores${aQueryString(filtros)}`, token),
};
