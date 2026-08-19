import type { ContextoEnVivo, SesionEnVivoResumen, TrazaEnVivo } from '@quivo/shared';
import { apiFetch } from './client';

/** Cliente de los tres endpoints del mapa en vivo (`apps/api/src/modules/reportes/en-vivo.*`). */
export const enVivoApi = {
  /** Sesiones de la jornada + las que quedaron abiertas, ordenadas por último fix. */
  listar: (token: string) => apiFetch<SesionEnVivoResumen[]>('/reportes/en-vivo', token),

  /** Todo lo que no cambia durante el recorrido (ruta, puntos de control, vehículo). */
  contexto: (token: string, sesionId: string) =>
    apiFetch<ContextoEnVivo>(`/reportes/en-vivo/${sesionId}/contexto`, token),

  /** Delta de traza + agregados de frescura. Sin `desde` devuelve la ventana completa. */
  posiciones: (
    token: string,
    sesionId: string,
    opciones: { desde?: Date; limite?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opciones.desde) params.set('desde', opciones.desde.toISOString());
    if (opciones.limite !== undefined) params.set('limite', String(opciones.limite));
    const qs = params.toString();
    return apiFetch<TrazaEnVivo>(
      `/reportes/en-vivo/${sesionId}/posiciones${qs ? `?${qs}` : ''}`,
      token,
    );
  },
};
