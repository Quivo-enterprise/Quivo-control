import type { ActualizarConductor, Conductor, CrearConductor } from '@quivo/shared';
import { apiFetch } from './client';

export const conductoresApi = {
  listar: (token: string) => apiFetch<Conductor[]>('/conductores', token),
  crear: (token: string, data: CrearConductor) =>
    apiFetch<Conductor>('/conductores', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarConductor) =>
    apiFetch<Conductor>(`/conductores/${id}`, token, { method: 'PATCH', body: data }),
};
