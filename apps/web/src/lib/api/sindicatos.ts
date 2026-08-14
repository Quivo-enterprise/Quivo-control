import type { ActualizarSindicato, CrearSindicato, Sindicato } from '@quivo/shared';
import { apiFetch } from './client';

export const sindicatosApi = {
  listar: (token: string) => apiFetch<Sindicato[]>('/sindicatos', token),
  crear: (token: string, data: CrearSindicato) =>
    apiFetch<Sindicato>('/sindicatos', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarSindicato) =>
    apiFetch<Sindicato>(`/sindicatos/${id}`, token, { method: 'PATCH', body: data }),
};
