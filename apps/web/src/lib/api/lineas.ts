import type { ActualizarLinea, CrearLinea, Linea } from '@quivo/shared';
import { apiFetch } from './client';

export const lineasApi = {
  listar: (token: string) => apiFetch<Linea[]>('/lineas', token),
  crear: (token: string, data: CrearLinea) => apiFetch<Linea>('/lineas', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarLinea) =>
    apiFetch<Linea>(`/lineas/${id}`, token, { method: 'PATCH', body: data }),
};
