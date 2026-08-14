import type { ActualizarSocio, CrearSocio, Socio } from '@quivo/shared';
import { apiFetch } from './client';

export const sociosApi = {
  listar: (token: string) => apiFetch<Socio[]>('/socios', token),
  crear: (token: string, data: CrearSocio) => apiFetch<Socio>('/socios', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarSocio) =>
    apiFetch<Socio>(`/socios/${id}`, token, { method: 'PATCH', body: data }),
};
