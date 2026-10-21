import {
  EstadoFilaSalidaPanelSchema,
  FrecuenciaReglaSchema,
  GrupoVehiculoSchema,
  ReglasFrecuenciaPanelSchema,
  type ActualizarGrupoVehiculo,
  type BaseFrecuencia,
  type CrearFrecuenciaRegla,
  type CrearGrupoVehiculo,
  type EstadoFilaSalidaPanel,
  type FrecuenciaRegla,
  type GrupoVehiculo,
  type ReglasFrecuenciaPanel,
} from '@quivo/shared';
import { apiFetch } from './client';
import { lineasApi } from './lineas';
import { puntosControlApi } from './puntos-control';
import { rutasApi } from './rutas';

export interface TerminalOpcion {
  id: string;
  etiqueta: string;
}

export interface TerminalesCargadas {
  opciones: TerminalOpcion[];
  /** Cantidad de líneas/rutas que no se pudieron consultar (la lista puede estar incompleta). */
  fallidas: number;
}

/** Cliente de la fila de salida (`apps/api/src/modules/salidas`). Las respuestas se parsean con los schemas de shared. */
export const salidasApi = {
  /**
   * Terminales (PC con `rol = 'terminal'`, activos) de las líneas visibles: línea → rutas → puntos de control.
   * Una ruta que falla no tumba la lista: se devuelven las que cargaron y cuántas fallaron.
   * shortcut: N+1 de líneas→rutas→PCs; endpoint de terminales en la API si el sindicato tiene muchas líneas.
   */
  async listarTerminales(token: string): Promise<TerminalesCargadas> {
    let fallidas = 0;
    const lineas = await lineasApi.listar(token);
    const porLinea = await Promise.allSettled(
      lineas.map(async (linea) => {
        const rutas = await rutasApi.listarPorLinea(token, linea.id);
        const porRuta = await Promise.allSettled(
          rutas.map(async (ruta) =>
            (await puntosControlApi.listarPorRuta(token, ruta.id))
              .filter((pc) => pc.rol === 'terminal' && pc.estado === 'activo')
              .map((pc) => ({
                id: pc.id,
                etiqueta: `${linea.nombreCorto || linea.nombre} · ${ruta.sentido} · punto ${pc.orden}`,
              })),
          ),
        );
        fallidas += porRuta.filter((r) => r.status === 'rejected').length;
        return porRuta.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      }),
    );
    fallidas += porLinea.filter((r) => r.status === 'rejected').length;
    const opciones = porLinea.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    return { opciones: [...new Map(opciones.map((t) => [t.id, t])).values()], fallidas };
  },

  fila: async (token: string, pcId: string): Promise<EstadoFilaSalidaPanel> =>
    EstadoFilaSalidaPanelSchema.parse(await apiFetch<unknown>(`/salidas/${pcId}/fila`, token)),

  despachar: (token: string, pcId: string, filaId: string) =>
    apiFetch<unknown>(`/salidas/${pcId}/fila/${filaId}/despachar`, token, { method: 'POST' }),
  moverAlFinal: (token: string, pcId: string, filaId: string) =>
    apiFetch<unknown>(`/salidas/${pcId}/fila/${filaId}/mover-al-final`, token, { method: 'POST' }),
  retirar: (token: string, pcId: string, filaId: string) =>
    apiFetch<unknown>(`/salidas/${pcId}/fila/${filaId}/retirar`, token, { method: 'POST' }),

  reglas: async (token: string, pcId: string): Promise<ReglasFrecuenciaPanel> =>
    ReglasFrecuenciaPanelSchema.parse(await apiFetch<unknown>(`/salidas/${pcId}/reglas`, token)),
  crearRegla: async (token: string, pcId: string, data: CrearFrecuenciaRegla): Promise<FrecuenciaRegla> =>
    FrecuenciaReglaSchema.parse(
      await apiFetch<unknown>(`/salidas/${pcId}/reglas`, token, { method: 'POST', body: data }),
    ),
  anularRegla: (token: string, pcId: string, reglaId: string) =>
    apiFetch<unknown>(`/salidas/${pcId}/reglas/${reglaId}`, token, { method: 'DELETE' }),
  fijarBase: (token: string, pcId: string, data: BaseFrecuencia) =>
    apiFetch<unknown>(`/salidas/${pcId}/base`, token, { method: 'PUT', body: data }),

  grupos: async (token: string): Promise<GrupoVehiculo[]> =>
    GrupoVehiculoSchema.array().parse(await apiFetch<unknown>('/grupos-vehiculo', token)),
  crearGrupo: (token: string, data: CrearGrupoVehiculo) =>
    apiFetch<unknown>('/grupos-vehiculo', token, { method: 'POST', body: data }),
  actualizarGrupo: (token: string, id: string, data: ActualizarGrupoVehiculo) =>
    apiFetch<unknown>(`/grupos-vehiculo/${id}`, token, { method: 'PATCH', body: data }),
  agregarMiembro: (token: string, id: string, vehiculoId: string) =>
    apiFetch<unknown>(`/grupos-vehiculo/${id}/miembros`, token, { method: 'POST', body: { vehiculoId } }),
  quitarMiembro: (token: string, id: string, vehiculoId: string) =>
    apiFetch<unknown>(`/grupos-vehiculo/${id}/miembros/${vehiculoId}`, token, { method: 'DELETE' }),
};
