import type { ActualizarPuntoControl, CrearPuntoControl, PuntoControl } from '@quivo/shared';
import { apiFetch } from './client';

export const puntosControlApi = {
  listarPorRuta: (token: string, rutaId: string) => apiFetch<PuntoControl[]>(`/rutas/${rutaId}/puntos-control`, token),
  crear: (token: string, rutaId: string, data: CrearPuntoControl) =>
    apiFetch<PuntoControl>(`/rutas/${rutaId}/puntos-control`, token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarPuntoControl) =>
    apiFetch<PuntoControl>(`/puntos-control/${id}`, token, { method: 'PATCH', body: data }),
};
