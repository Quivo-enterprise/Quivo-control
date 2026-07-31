import type { CrearPuntoControl, PuntoControl } from '@quivo/shared';
import { apiFetch } from './client';

export const puntosControlApi = {
  listarPorRuta: (token: string, rutaId: string) => apiFetch<PuntoControl[]>(`/rutas/${rutaId}/puntos-control`, token),
  crear: (token: string, rutaId: string, data: CrearPuntoControl) =>
    apiFetch<PuntoControl>(`/rutas/${rutaId}/puntos-control`, token, { method: 'POST', body: data }),
};
