import type { CumplimientoFila, CumplimientoQuery, JornadasDelDia } from '@quivo/shared';
import { apiFetch } from './client';

function aQueryString(filtros: CumplimientoQuery): string {
  const params = new URLSearchParams();
  params.set('por', filtros.por);
  if (filtros.desde) params.set('desde', filtros.desde.toISOString());
  if (filtros.hasta) params.set('hasta', filtros.hasta.toISOString());
  return `?${params.toString()}`;
}

export const reportesApi = {
  cumplimiento: (token: string, filtros: CumplimientoQuery) =>
    apiFetch<CumplimientoFila[]>(`/reportes/cumplimiento${aQueryString(filtros)}`, token),

  /**
   * Release 13 — `GET /reportes/jornadas`: una fila por vehículo con asignación en la
   * jornada, con su estado del día. Sin `fecha` el servidor usa el día calendario
   * de Bolivia en curso (UTC-4; el corte cae a las 04:00 UTC), que es lo que quiere el panel
   * de `/en-vivo`: el cliente no manda fecha. Vive acá y no en `enVivoApi` porque el endpoint es `reportes/jornadas`
   * (controller propio, también sirve a días pasados), no parte del mapa en vivo.
   */
  jornadas: (token: string) => apiFetch<JornadasDelDia>('/reportes/jornadas', token),
};
