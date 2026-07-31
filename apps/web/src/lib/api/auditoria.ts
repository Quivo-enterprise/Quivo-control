import type { AuditLogEntry, AuditoriaQuery } from '@quivo/shared';
import { apiFetch } from './client';

function aQueryString(filtros: AuditoriaQuery): string {
  const params = new URLSearchParams();
  if (filtros.entidad) params.set('entidad', filtros.entidad);
  if (filtros.accion) params.set('accion', filtros.accion);
  if (filtros.usuarioId) params.set('usuarioId', filtros.usuarioId);
  if (filtros.desde) params.set('desde', filtros.desde.toISOString());
  if (filtros.hasta) params.set('hasta', filtros.hasta.toISOString());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const auditoriaApi = {
  listar: (token: string, filtros: AuditoriaQuery) =>
    apiFetch<AuditLogEntry[]>(`/auditoria${aQueryString(filtros)}`, token),
};
