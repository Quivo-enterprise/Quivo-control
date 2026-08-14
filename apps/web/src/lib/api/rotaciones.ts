import type {
  ActualizarAsignacion,
  Asignacion,
  CrearAsignacionManual,
  GenerarRotacion,
  Rotacion,
} from '@quivo/shared';
import { apiFetch } from './client';

export type RotacionConAsignaciones = Rotacion & { asignaciones: Asignacion[] };

/** Par vehículo×ruta que quedó sin cubrir al generar (ver comentario en
 * `GenerarRotacionSchema`, `@quivo/shared`) — no viene guardado, solo en la respuesta de
 * `generar()`. */
export interface SinCobertura {
  vehiculoId: string;
  rutaId: string;
}

export const rotacionesApi = {
  listar: (token: string) => apiFetch<Rotacion[]>('/rotaciones', token),
  obtener: (token: string, id: string) => apiFetch<RotacionConAsignaciones>(`/rotaciones/${id}`, token),
  generar: (token: string, data: GenerarRotacion) =>
    apiFetch<RotacionConAsignaciones & { sinCobertura: SinCobertura[] }>('/rotaciones', token, {
      method: 'POST',
      body: data,
    }),
  publicar: (token: string, id: string) =>
    apiFetch<Rotacion>(`/rotaciones/${id}/publicar`, token, { method: 'POST' }),
  anular: (token: string, id: string) => apiFetch<Rotacion>(`/rotaciones/${id}/anular`, token, { method: 'POST' }),
  crearAsignacion: (token: string, rotacionId: string, data: CrearAsignacionManual) =>
    apiFetch<Asignacion>(`/rotaciones/${rotacionId}/asignaciones`, token, { method: 'POST', body: data }),
  actualizarAsignacion: (token: string, rotacionId: string, asignacionId: string, data: ActualizarAsignacion) =>
    apiFetch<Asignacion>(`/rotaciones/${rotacionId}/asignaciones/${asignacionId}`, token, {
      method: 'PATCH',
      body: data,
    }),
  eliminarAsignacion: (token: string, rotacionId: string, asignacionId: string) =>
    apiFetch<{ id: string }>(`/rotaciones/${rotacionId}/asignaciones/${asignacionId}`, token, { method: 'DELETE' }),
};
