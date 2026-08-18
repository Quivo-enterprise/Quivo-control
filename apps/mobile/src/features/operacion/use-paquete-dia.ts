import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import type { PaqueteDia } from '@quivo/shared';
import { abrirPaqueteDiaDb, guardarPaqueteDia, obtenerPaqueteDiaLocal } from '../../db/paquete-dia';
import { paqueteDiaApi, PaqueteDiaApiError } from '../../shared/api/paquete-dia-api';
import { cargarSesionMovil } from '../../shared/security/sesion-movil-store';

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
      // Hallazgo 1 (CRÍTICO, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): antes de aceptar
      // el fallback local hay que saber a qué asignación pertenece la fila en SQLite — la
      // fila sobrevive al logout y a cualquier turno anterior en este mismo teléfono. La
      // asignación de referencia es la de la SESIÓN GUARDADA (no la que se acaba de intentar
      // descargar, que es justo la que falló): si no hay sesión guardada, o la fila es de
      // otra asignación, `obtenerPaqueteDiaLocal` devuelve `null` y caemos al error de red
      // real de abajo, en vez de servir la ruta/puntos de control de otro turno.
      //
      // Hallazgo 6 (MEDIO, code review de este cambio): esta lectura va en su PROPIO
      // try/catch. Antes, si `cargarSesionMovil()` (SecureStore) lanzaba —keychain no
      // disponible, dispositivo bloqueado— la excepción escapaba de ESTE catch (el de la
      // descarga de red), la promesa de `cargar()` rechazaba dentro de un `void cargar()` sin
      // manejar, y ningún `setEstado` corría: `cargando` se quedaba en `true` desde el arranque
      // del hook y la pantalla de operación mostraba un spinner permanente con `canStart` en
      // false. Un fallo acá cae al mismo camino que "no hay sesión guardada" — sin fallback
      // local, error de red real de abajo — que ya está soportado.
      let sesion: Awaited<ReturnType<typeof cargarSesionMovil>> = null;
      try {
        sesion = await cargarSesionMovil();
      } catch (errorSesion) {
        console.error('[QUIVO][paquete-dia] No se pudo leer la sesión guardada', errorSesion);
        Sentry.captureException(errorSesion, {
          tags: { contexto: 'paquete-dia', paso: 'leer-sesion-para-fallback-local' },
        });
      }
      const local = sesion ? await obtenerPaqueteDiaLocal(db, sesion.contexto.asignacion.id) : null;
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
