import type { EstadoPublicacion } from '@quivo/shared';
import { apiFetch } from './client';

export type MobilityPublicationResource = 'lineas' | 'rutas' | 'variantes' | 'paradas';

export const mobilityPublicationsApi = {
  actualizar: (token: string, resource: MobilityPublicationResource, id: string, status: EstadoPublicacion) =>
    apiFetch<{ id: string; status: EstadoPublicacion; publishedAt: string | null }>(
      `/mobility-publications/${resource}/${id}`,
      token,
      { method: 'PATCH', body: { status } },
    ),
};
