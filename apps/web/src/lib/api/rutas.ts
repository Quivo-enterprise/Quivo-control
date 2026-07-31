import type { ActualizarRuta, CrearRuta, Ruta } from '@quivo/shared';
import { apiFetch } from './client';

export const rutasApi = {
  listarPorLinea: (token: string, lineaId: string) => apiFetch<Ruta[]>(`/lineas/${lineaId}/rutas`, token),
  crear: (token: string, lineaId: string, data: CrearRuta) =>
    apiFetch<Ruta>(`/lineas/${lineaId}/rutas`, token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarRuta) =>
    apiFetch<Ruta>(`/rutas/${id}`, token, { method: 'PATCH', body: data }),
};
