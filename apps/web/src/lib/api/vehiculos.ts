import type {
  ActualizarVehiculo,
  CambiarEstadoVehiculo,
  CrearVehiculo,
  HistorialEstadoVehiculo,
  Vehiculo,
  VerificacionPlacaVehiculo,
} from '@quivo/shared';
import { apiFetch } from './client';

export const vehiculosApi = {
  listar: (token: string) => apiFetch<Vehiculo[]>('/vehiculos', token),
  crear: (token: string, data: CrearVehiculo) =>
    apiFetch<Vehiculo>('/vehiculos', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarVehiculo) =>
    apiFetch<Vehiculo>(`/vehiculos/${id}`, token, { method: 'PATCH', body: data }),
  verificarPlaca: (token: string, placa: string) =>
    apiFetch<VerificacionPlacaVehiculo>(
      `/vehiculos/verificar-placa?placa=${encodeURIComponent(placa)}`,
      token,
    ),
  cambiarEstado: (token: string, id: string, data: CambiarEstadoVehiculo) =>
    apiFetch<Vehiculo>(`/vehiculos/${id}/estado`, token, { method: 'PATCH', body: data }),
  quitarFoto: (token: string, id: string) =>
    apiFetch<Vehiculo>(`/vehiculos/${id}/foto`, token, { method: 'DELETE' }),
  historialEstados: (token: string, id: string) =>
    apiFetch<HistorialEstadoVehiculo[]>(`/vehiculos/${id}/historial-estados`, token),
};
