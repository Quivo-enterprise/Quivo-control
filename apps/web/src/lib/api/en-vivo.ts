import type {
  ContextoEnVivo,
  MolinosResumen,
  PosicionEnVivo,
  SesionEnVivoResumen,
  TrazaEnVivo,
  DesignarVueltaRespuesta,
} from '@quivo/shared';
import { apiFetch } from './client';

/** Cliente de los endpoints del mapa en vivo (`apps/api/src/modules/reportes/en-vivo.*`). */
export const enVivoApi = {
  /** Sesiones de la jornada + las que quedaron abiertas, ordenadas por último fix. Sin
   * consumidores en `/en-vivo` desde la ENTREGA 13 (reemplazado por `posicionesTodas`, que no
   * escala con N sesiones) — se deja para no romper otros posibles usos del listado crudo. */
  listar: (token: string) => apiFetch<SesionEnVivoResumen[]>('/reportes/en-vivo', token),

  /**
   * ENTREGA 10/13 — `GET /reportes/en-vivo/posiciones` (plural, SIN `sesionId`). Última
   * posición conocida de TODOS los vehículos con sesión activa/reciente, en una sola query
   * server-side que no escala con N — la alternativa (`posiciones` de abajo, una traza por
   * sesión) está descartada por costo para el mapa que dibuja todos los vehículos a la vez
   * (ver el comentario de `PosicionEnVivoSchema` en `@quivo/shared`).
   *
   * Nombre distinto de `posiciones` (no `enVivoApi.posiciones` a secas) a propósito: esa
   * clave ya la tiene el endpoint POR SESIÓN de abajo (`:sesionId/posiciones`, el poll de
   * traza), que sigue viva para la sesión con detalle abierto — colisionar los dos nombres
   * habría sido confuso o directamente un bug de pisado.
   */
  posicionesTodas: (token: string) => apiFetch<PosicionEnVivo[]>('/reportes/en-vivo/posiciones', token),

  /** `GET /reportes/en-vivo/molinos` — resumen por línea para el HUD ("Molinos: X en espera…"). */
  molinos: (token: string) => apiFetch<MolinosResumen>('/reportes/en-vivo/molinos', token),

  /** `PUT /reportes/en-vivo/:sesionId/vuelta-actual/designacion` — designa (o cancela con `null`) la
   * vuelta en curso a una variante con punto de espera. 409 con motivo en español si ya llegó al
   * punto de espera o no hay vuelta en curso. */
  designarVuelta: (token: string, sesionId: string, varianteId: string | null) =>
    apiFetch<DesignarVueltaRespuesta>(`/reportes/en-vivo/${sesionId}/vuelta-actual/designacion`, token, {
      method: 'PUT',
      body: { varianteId },
    }),

  /** Todo lo que no cambia durante el recorrido (ruta, puntos de control, vehículo). */
  contexto: (token: string, sesionId: string) =>
    apiFetch<ContextoEnVivo>(`/reportes/en-vivo/${sesionId}/contexto`, token),

  /** Delta de traza + agregados de frescura de UNA sesión (la que tiene el detalle abierto).
   * Sin `desde` devuelve la ventana completa. */
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
