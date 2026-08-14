import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaqueteDia } from '@quivo/shared';
import { abrirPaqueteDiaDb, guardarPaqueteDia, obtenerPaqueteDiaLocal } from '../../db/paquete-dia';
import { paqueteDiaApi, PaqueteDiaApiError } from '../../shared/api/paquete-dia-api';

export interface EstadoPaqueteDia {
  cargando: boolean;
  paquete: PaqueteDia | null;
  vencido: boolean;
  error: string | null;
}

/**
 * Descarga el paquete del día (QUI-236) al entrar a la pantalla de operación y lo guarda en
 * SQLite; si falla (sin red, sesión no renovable) cae al último paquete descargado —
 * el recorrido completo debe poder hacerse sin red (RF-67) mientras no haya vencido.
 */
export function usePaqueteDia(obtenerAccessToken: () => Promise<string | null>) {
  const [estado, setEstado] = useState<EstadoPaqueteDia>({
    cargando: true,
    paquete: null,
    vencido: false,
    error: null,
  });
  const yaCargo = useRef(false);

  const cargar = useCallback(async () => {
    setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    const db = await abrirPaqueteDiaDb();
    try {
      const accessToken = await obtenerAccessToken();
      if (!accessToken) {
        throw new PaqueteDiaApiError('network', 'Sin conexión o sesión no renovable');
      }
      const paquete = await paqueteDiaApi.obtenerAsignacionDelDia(accessToken);
      await guardarPaqueteDia(db, paquete);
      setEstado({ cargando: false, paquete, vencido: false, error: null });
    } catch (error) {
      const local = await obtenerPaqueteDiaLocal(db);
      if (local) {
        setEstado({ cargando: false, paquete: local.paquete, vencido: local.vencido, error: null });
        return;
      }
      setEstado({
        cargando: false,
        paquete: null,
        vencido: false,
        error:
          error instanceof PaqueteDiaApiError
            ? error.userMessage
            : 'No se pudo descargar el paquete del día. Revisa la conexión.',
      });
    }
  }, [obtenerAccessToken]);

  useEffect(() => {
    if (yaCargo.current) return;
    yaCargo.current = true;
    void cargar();
  }, [cargar]);

  return { ...estado, recargar: cargar };
}
