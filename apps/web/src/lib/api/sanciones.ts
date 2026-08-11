import type { ActualizarSancion, CrearSancion, Sancion, SancionesQuery } from '@quivo/shared';
import { apiFetch } from './client';

function aQueryString(filtros: SancionesQuery): string {
  const params = new URLSearchParams();
  if (filtros.sindicatoId) params.set('sindicatoId', filtros.sindicatoId);
  if (filtros.estado) params.set('estado', filtros.estado);
  if (filtros.reglaId) params.set('reglaId', filtros.reglaId);
  if (filtros.skip) params.set('skip', String(filtros.skip));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const sancionesApi = {
  listar: (token: string, filtros: SancionesQuery = {}) =>
    apiFetch<Sancion[]>(`/sanciones${aQueryString(filtros)}`, token),
  crear: (token: string, data: CrearSancion) => apiFetch<Sancion>('/sanciones', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarSancion) =>
    apiFetch<Sancion>(`/sanciones/${id}`, token, { method: 'PATCH', body: data }),
  aplicar: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/aplicar`, token, { method: 'POST' }),
  anular: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/anular`, token, { method: 'POST' }),
  apelar: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/apelar`, token, { method: 'POST' }),
  pagar: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/pagar`, token, { method: 'POST' }),
};
