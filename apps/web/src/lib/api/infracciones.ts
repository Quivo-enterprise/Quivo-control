import {
  InfraccionHoySchema,
  InfraccionSchema,
  type ActualizarInfraccion,
  type Infraccion,
  type InfraccionHoy,
  type SancionarInfraccion,
} from '@quivo/shared';
import { apiFetch } from './client';

/** Cliente de las infracciones automáticas (desvío de ruta, PC omitido —
 * `docs/plan-en-vivo-alertas.md`, PR A). Las fechas llegan como string JSON: `InfraccionSchema`
 * las convierte a `Date` y valida la forma, así el resto de la UI trabaja con tipos reales. */
export const infraccionesApi = {
  /** `GET /reportes/en-vivo/:sesionId/infracciones` — todas las de la sesión (abiertas o no). */
  listarPorSesion: async (token: string, sesionId: string): Promise<Infraccion[]> => {
    const filas = await apiFetch<unknown[]>(`/reportes/en-vivo/${sesionId}/infracciones`, token);
    return InfraccionSchema.array().parse(filas);
  },

  /** `GET /reportes/en-vivo/infracciones?fecha=hoy` — abiertas y atendidas de hoy, con placa/conductor/línea. */
  listarHoy: async (token: string): Promise<InfraccionHoy[]> =>
    InfraccionHoySchema.array().parse(await apiFetch<unknown[]>('/reportes/en-vivo/infracciones?fecha=hoy', token)),

  /** `PATCH /infracciones/:id` — `atender` o `descartar` (con `nota` opcional). */
  actualizar: async (token: string, id: string, data: ActualizarInfraccion): Promise<Infraccion> =>
    InfraccionSchema.parse(await apiFetch<unknown>(`/infracciones/${id}`, token, { method: 'PATCH', body: data })),

  /** `POST /infracciones/:id/sancionar` — agenda la sanción compensatoria y la vincula a la infracción;
   * responde la INFRACCIÓN actualizada (estado `sancionada`), no la sanción. Solo se manda el
   * cumplimiento: el hecho lo deriva el servidor. `espera_corta` o sin regla activa responde 409. */
  sancionar: async (token: string, id: string, data: SancionarInfraccion): Promise<Infraccion> =>
    InfraccionSchema.parse(
      await apiFetch<unknown>(`/infracciones/${id}/sancionar`, token, { method: 'POST', body: data }),
    ),
};
