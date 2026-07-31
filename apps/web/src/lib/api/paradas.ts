import type { CrearParada, Parada } from '@quivo/shared';
import { apiFetch } from './client';

export const paradasApi = {
  listarPorRuta: (token: string, rutaId: string) => apiFetch<Parada[]>(`/rutas/${rutaId}/paradas`, token),
  crear: (token: string, rutaId: string, data: CrearParada) =>
    apiFetch<Parada>(`/rutas/${rutaId}/paradas`, token, { method: 'POST', body: data }),
};
