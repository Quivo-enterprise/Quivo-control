import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type { PaqueteDia } from '@quivo/shared';
import { abrirPaqueteDiaDb, guardarPaqueteDia, obtenerPaqueteDiaLocal } from '../../db/paquete-dia';
import { paqueteDiaApi, PaqueteDiaApiError } from '../../shared/api/paquete-dia-api';
import { cargarSesionMovil } from '../../shared/security/sesion-movil-store';

/** Mínimo entre descargas al volver a primer plano. */
export const MIN_ENTRE_REFRESCOS_MS = 60_000;
/** Refresco periódico con la app en primer plano. */
export const INTERVALO_REFRESCO_MS = 10 * 60_000;

/** Un refresco en segundo plano sin red (offline, timeout, fetch caído) es esperado: no va a Sentry. */
export function debeReportarFalloRefresco(error: unknown): boolean {
  return !(error instanceof PaqueteDiaApiError && error.kind === 'network');
}

/** Throttle del refresco por AppState: `ultimaCargaMs` es el inicio de la última descarga. */
export function puedeRefrescarPaquete(ultimaCargaMs: number, ahoraMs: number): boolean {
  return ahoraMs - ultimaCargaMs >= MIN_ENTRE_REFRESCOS_MS;
}

/** Mismo contenido (comparación barata por JSON): evita re-renders del mapa cada refresco. */
export function mismoPaquete(a: PaqueteDia | null, b: PaqueteDia): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

/** Refresco exitoso con el mismo paquete: restaura `paquete` (un fallback offline pudo dejarlo en null) y
 * limpia `vencido`/`error` (antes quedaba pegado el banner). Misma referencia si nada cambia. */
export function estadoTrasRefrescoIgual(actual: EstadoPaqueteDia, paquete: PaqueteDia | null): EstadoPaqueteDia {
  return actual.paquete === paquete && !actual.vencido && !actual.error
    ? actual
    : { ...actual, paquete, vencido: false, error: null };
}

/** El paquete descargado es de la asignación de la sesión actual. */
export function perteneceAAsignacion(paquete: PaqueteDia, asignacionId: string | null | undefined): boolean {
  return !!asignacionId && paquete.asignacion.id === asignacionId;
}

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
 * Se vuelve a descargar al volver a primer plano y cada `INTERVALO_REFRESCO_MS` (un punto de
 * control movido en prod no llegaba a los teléfonos ya abiertos); un refresco fallido conserva el
 * paquete actual y no muestra spinner.
 */
export function usePaqueteDia(obtenerAccessToken: () => Promise<string | null>) {
  const [estado, setEstado] = useState<EstadoPaqueteDia>({
    cargando: true,
    paquete: null,
    vencido: false,
    error: null,
  });
  const yaCargo = useRef(false);
  const ultimaCargaMs = useRef(0);
  const enVuelo = useRef(false);
  const recargaPendiente = useRef(false);
  const paqueteActual = useRef<PaqueteDia | null>(null);

  const descargar = useCallback(async (refresco: boolean) => {
    if (!refresco) setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    const db = await abrirPaqueteDiaDb();
    try {
      const accessToken = await obtenerAccessToken();
      if (!accessToken) {
        throw new PaqueteDiaApiError('network', 'Sin conexión o sesión no renovable');
      }
      const paquete = await paqueteDiaApi.obtenerAsignacionDelDia(accessToken);
      if (refresco) {
        // Un refresco en segundo plano no pisa el paquete si es de otra asignación (sesión cambiada).
        const sesion = await cargarSesionMovil().catch(() => null);
        if (!perteneceAAsignacion(paquete, sesion?.contexto.asignacion.id)) {
          Sentry.captureMessage('Refresco del paquete del día de otra asignación: descartado', {
            level: 'warning',
            tags: { contexto: 'paquete-dia', paso: 'refresco-otra-asignacion' },
          });
          return;
        }
        if (mismoPaquete(paqueteActual.current, paquete)) {
          setEstado((e) => estadoTrasRefrescoIgual(e, paqueteActual.current));
          return;
        }
      }
      await guardarPaqueteDia(db, paquete);
      paqueteActual.current = paquete;
      setEstado({ cargando: false, paquete, vencido: false, error: null });
    } catch (error) {
      // Refresco en segundo plano fallido: se conserva el paquete actual tal cual.
      if (refresco) {
        if (debeReportarFalloRefresco(error)) {
          Sentry.captureException(error, { tags: { contexto: 'paquete-dia', paso: 'refresco-descarga' } });
        }
        return;
      }
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
        paqueteActual.current = local.paquete;
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

  const cargar = useCallback(
    async (refresco = false) => {
      if (enVuelo.current) {
        // Una recarga manual no se pierde: corre al terminar la descarga en vuelo.
        if (!refresco) recargaPendiente.current = true;
        return;
      }
      enVuelo.current = true;
      ultimaCargaMs.current = Date.now();
      try {
        await descargar(refresco);
      } catch (error) {
        // Un refresco nunca debe dejar una promesa rechazada colgando (`void cargar(true)`).
        if (!refresco) throw error;
        Sentry.captureException(error, { tags: { contexto: 'paquete-dia', paso: 'refresco' } });
      } finally {
        enVuelo.current = false;
        if (recargaPendiente.current) {
          recargaPendiente.current = false;
          void cargar(false);
        }
      }
    },
    [descargar],
  );

  useEffect(() => {
    if (yaCargo.current) return;
    yaCargo.current = true;
    void cargar();
  }, [cargar]);

  // Refresco con la app en primer plano: al volver a 'active' (con piso de `MIN_ENTRE_REFRESCOS_MS`)
  // y por intervalo (`setInterval` no corre en background, así que no hace falta pausarlo).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estadoApp) => {
      if (estadoApp === 'active' && puedeRefrescarPaquete(ultimaCargaMs.current, Date.now())) {
        void cargar(true);
      }
    });
    const timer = setInterval(() => void cargar(true), INTERVALO_REFRESCO_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [cargar]);

  return { ...estado, recargar: () => cargar() };
}
