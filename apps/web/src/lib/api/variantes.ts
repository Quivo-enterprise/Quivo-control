import type { ActualizarVariante, CrearVariante, Variante } from '@quivo/shared';
import { apiFetch } from './client';

export const variantesApi = {
  listarPorRuta: (token: string, rutaId: string) => apiFetch<Variante[]>(`/rutas/${rutaId}/variantes`, token),
  crear: (token: string, rutaId: string, data: CrearVariante) =>
    apiFetch<Variante>(`/rutas/${rutaId}/variantes`, token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarVariante) =>
    apiFetch<Variante>(`/variantes/${id}`, token, { method: 'PATCH', body: data }),
};
