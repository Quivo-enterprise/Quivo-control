import { useRef, useState } from 'react';
import type { HistorialEstadoVehiculo, Vehiculo } from '@quivo/shared';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';

/**
 * Encapsula el modal de historial: qué vehículo está abierto, su carga y su descarte de
 * respuestas fuera de orden (`requestId`) — la página solo dispara `open`/`close`.
 */
export function useVehicleHistory(token: string) {
  const [vehicle, setVehicle] = useState<Vehiculo | null>(null);
  const [rows, setRows] = useState<HistorialEstadoVehiculo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestId = useRef(0);

  async function open(target: Vehiculo) {
    const currentRequestId = ++requestId.current;
    setVehicle(target);
    setRows([]);
    setError(null);
    setIsLoading(true);
    try {
      const history = await vehiculosApi.historialEstados(token, target.id);
      if (currentRequestId === requestId.current) setRows(history);
    } catch (err: unknown) {
      if (currentRequestId === requestId.current) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el historial.');
      }
    } finally {
      if (currentRequestId === requestId.current) setIsLoading(false);
    }
  }

  function close() {
    requestId.current += 1;
    setVehicle(null);
    setRows([]);
    setError(null);
    setIsLoading(false);
  }

  return { vehicle, rows, error, isLoading, open, close };
}
