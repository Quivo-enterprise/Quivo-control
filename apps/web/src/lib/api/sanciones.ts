import type { ActualizarSancion, CrearSancion, Sancion } from '@quivo/shared';
import { apiFetch } from './client';

export const sancionesApi = {
  listar: (token: string) => apiFetch<Sancion[]>('/sanciones', token),
  crear: (token: string, data: CrearSancion) => apiFetch<Sancion>('/sanciones', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarSancion) =>
    apiFetch<Sancion>(`/sanciones/${id}`, token, { method: 'PATCH', body: data }),
  aplicar: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/aplicar`, token, { method: 'POST' }),
  anular: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/anular`, token, { method: 'POST' }),
  apelar: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/apelar`, token, { method: 'POST' }),
  pagar: (token: string, id: string) => apiFetch<Sancion>(`/sanciones/${id}/pagar`, token, { method: 'POST' }),
};
