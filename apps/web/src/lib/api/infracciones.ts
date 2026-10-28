import {
  InfraccionSchema,
  type ActualizarInfraccion,
  type Infraccion,
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

  /** `PATCH /infracciones/:id` — `atender` o `descartar` (con `nota` opcional). */
  actualizar: async (token: string, id: string, data: ActualizarInfraccion): Promise<Infraccion> =>
    InfraccionSchema.parse(await apiFetch<unknown>(`/infracciones/${id}`, token, { method: 'PATCH', body: data })),

  /** `POST /infracciones/:id/sancionar` — crea la sanción y la vincula a la infracción; responde
   * la INFRACCIÓN actualizada (estado `sancionada`), no la sanción. El sujeto debe ser el conductor
   * o el vehículo de la infracción; `espera_corta` responde 409. */
  sancionar: async (token: string, id: string, data: SancionarInfraccion): Promise<Infraccion> =>
    InfraccionSchema.parse(
      await apiFetch<unknown>(`/infracciones/${id}/sancionar`, token, { method: 'POST', body: data }),
    ),
};
