import type { ActualizarVehiculo, CrearVehiculo, Vehiculo } from '@quivo/shared';
import { apiFetch } from './client';

export const vehiculosApi = {
  listar: (token: string) => apiFetch<Vehiculo[]>('/vehiculos', token),
  crear: (token: string, data: CrearVehiculo) =>
    apiFetch<Vehiculo>('/vehiculos', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarVehiculo) =>
    apiFetch<Vehiculo>(`/vehiculos/${id}`, token, { method: 'PATCH', body: data }),
};
