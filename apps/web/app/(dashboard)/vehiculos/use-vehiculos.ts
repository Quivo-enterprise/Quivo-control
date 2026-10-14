import { useEffect, useState } from 'react';
import type {
  ActualizarVehiculo,
  CambiarEstadoVehiculo,
  CrearVehiculo,
  Socio,
  Vehiculo,
} from '@quivo/shared';
import { sociosApi } from '../../../src/lib/api/socios';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';

/**
 * Encapsula la carga de vehículos/socios y las mutaciones (alta, edición, cambio de estado):
 * la página solo conoce este contrato, no cómo se obtienen ni se actualizan los datos.
 */
export function useVehiculos(token: string) {
  const [rows, setRows] = useState<Vehiculo[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    Promise.all([vehiculosApi.listar(token), sociosApi.listar(token)])
      .then(([vehiculos, sociosData]) => {
        if (cancelled) return;
        setRows(vehiculos);
        setSocios(sociosData);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error ? error.message : 'No se pudieron cargar los vehículos.',
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function crear(data: CrearVehiculo) {
    const saved = await vehiculosApi.crear(token, data);
    setRows((previous) => [saved, ...previous]);
    return saved;
  }

  async function actualizar(id: string, data: ActualizarVehiculo) {
    const saved = await vehiculosApi.actualizar(token, id, data);
    setRows((previous) => previous.map((row) => (row.id === saved.id ? saved : row)));
    return saved;
  }

  async function cambiarEstado(id: string, data: CambiarEstadoVehiculo) {
    const saved = await vehiculosApi.cambiarEstado(token, id, data);
    setRows((previous) => previous.map((row) => (row.id === saved.id ? saved : row)));
    return saved;
  }

  async function quitarFoto(id: string) {
    const saved = await vehiculosApi.quitarFoto(token, id);
    setRows((previous) => previous.map((row) => (row.id === saved.id ? saved : row)));
    return saved;
  }

  return { rows, socios, isLoading, loadError, crear, actualizar, cambiarEstado, quitarFoto };
}
