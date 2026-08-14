import type { ActualizarRegla, CrearRegla, Regla } from '@quivo/shared';
import { apiFetch } from './client';

export const reglasApi = {
  listar: (token: string) => apiFetch<Regla[]>('/reglas', token),
  crear: (token: string, data: CrearRegla) => apiFetch<Regla>('/reglas', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarRegla) =>
    apiFetch<Regla>(`/reglas/${id}`, token, { method: 'PATCH', body: data }),
};
