import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { reportarErrorActualizacion } from '../../shared/observability/reportar-actualizacion';
import { huboLecturaDeRecorridoActivo, suscribirseARecorridoActivo } from '../operacion/estado-recorrido-activo';
import {
  debeChequear,
  debeLeerEstadoNativo,
  debeReintentarTrasPublicacion,
  estaInactivoAhora,
  puedeAplicarAhora,
  puedeOperarOtaAhora,
} from './actualizaciones-core';
import { leerEstadoRecorridoNativo } from './leer-estado-recorrido-nativo';

/**
 * Controlador de OTA (reemplaza el `checkAutomatically: 'ON_LOAD'` de expo-updates; ver el
 * comentario de `updates` en `app.config.ts`). SOLO se monta en la UI en primer plano (`App.tsx`):
 * el headless task de GPS no pasa por acá y nunca hace trabajo de red de actualizaciones.
 *
 * Reglas:
 * - Chequear/descargar: al montar y al volver a primer plano, como máximo cada 30 min y SOLO con
 *   el recorrido inactivo (lectura real; sin lectura = activo).
 * - Aplicar (`reloadAsync`): SOLO si hay una actualización ya descargada, el recorrido sigue
 *   inactivo y el chofer está en una pantalla pre-operación libre. Se reevalúa JUSTO antes de
 *   recargar. Si no hay un momento seguro, queda descargada y se reintenta en el próximo
 *   foreground / cambio de pantalla (o se lanza en el próximo arranque en frío).
 */
export function useActualizacionesAutomaticas(pantallaPreOperacionLibre: boolean): void {
  const enCursoRef = useRef(false);
  const ultimoChequeoRef = useRef<number | null>(null);
  const descargadaRef = useRef(false);
  /** Hay update detectado pero no descargado (se difirió por recorrido/segundo plano). */
  const pendienteFetchRef = useRef(false);
  const preOpRef = useRef(pantallaPreOperacionLibre);
  preOpRef.current = pantallaPreOperacionLibre;

  const intentar = useCallback(async () => {
    if (enCursoRef.current) return;
    const disponible = !__DEV__ && Updates.isEnabled;
    if (!disponible) return;

    enCursoRef.current = true;
    try {
      // Sin lectura real (arranque en frío directo a login/asignación) la establece desde el
      // estado nativo; sin ella la app se considera activa y nunca actualizaría.
      if (debeLeerEstadoNativo(huboLecturaDeRecorridoActivo())) await leerEstadoRecorridoNativo();

      if (
        !descargadaRef.current &&
        (pendienteFetchRef.current ||
        debeChequear({
          actualizacionesDisponibles: disponible,
          inactivo: estaInactivoAhora(),
          enCurso: false,
          ahora: Date.now(),
          ultimoChequeo: ultimoChequeoRef.current,
        }))
      ) {
        let hayUpdate = pendienteFetchRef.current;
        if (!hayUpdate) {
          ultimoChequeoRef.current = Date.now();
          try {
            hayUpdate = (await Updates.checkForUpdateAsync()).isAvailable;
          } catch (error) {
            reportarErrorActualizacion(error, 'check');
            return;
          }
        }
        if (hayUpdate) {
          // Releer en vivo tras el await de red: no descargar con recorrido o en segundo plano.
          if (!puedeOperarOtaAhora({ inactivo: estaInactivoAhora(), appState: AppState.currentState })) {
            pendienteFetchRef.current = true;
            return;
          }
          pendienteFetchRef.current = false;
          try {
            const r = await Updates.fetchUpdateAsync();
            descargadaRef.current = r.isNew;
          } catch (error) {
            reportarErrorActualizacion(error, 'fetch');
            return;
          }
        }
      }

      // Releer en vivo: durante el await de red el chofer pudo iniciar un recorrido o cambiar
      // de pantalla.
      if (
        descargadaRef.current &&
        puedeAplicarAhora({
          inactivo: estaInactivoAhora(),
          pantallaPreOperacionLibre: preOpRef.current,
        }) &&
        puedeOperarOtaAhora({ inactivo: estaInactivoAhora(), appState: AppState.currentState })
      ) {
        try {
          await Updates.reloadAsync();
        } catch (error) {
          reportarErrorActualizacion(error, 'reload');
        }
      }
    } finally {
      enCursoRef.current = false;
    }
  }, []);

  // Al montar y al volver a primer plano.
  useEffect(() => {
    void intentar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void intentar();
    });
    return () => sub.remove();
  }, [intentar]);

  // Cuando llega una lectura real de "inactivo" (publicada por useGpsOperativo o por la lectura
  // nativa) con la app en primer plano, reintenta (el throttle de 30 min sigue rigiendo el check;
  // aplicar lo ya descargado siempre se permite en pantalla pre-operación).
  useEffect(() => {
    return suscribirseARecorridoActivo((hayActivo) => {
      if (debeReintentarTrasPublicacion(hayActivo, AppState.currentState)) void intentar();
    });
  }, [intentar]);

  // Al llegar a una pantalla pre-operación (p. ej. tras cerrar sesión) aplica lo ya descargado.
  useEffect(() => {
    if (pantallaPreOperacionLibre) void intentar();
  }, [pantallaPreOperacionLibre, intentar]);
}
