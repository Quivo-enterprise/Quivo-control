import React, { createContext, useContext, useMemo, useEffect, useRef, useCallback } from 'react';
import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import { usePaqueteDia } from './use-paquete-dia';
import { useGpsOperativo } from './use-gps-operativo';
import { useOperacionSettings } from '../perfil/use-operacion-settings';
import { usePuntoControlSonido } from './confirmacion-sonido';
import { anunciarPuntoControl } from './anuncio-punto-control';
import type { DeteccionPuntoControl } from '../../gps/geofence';

interface GpsContextValue {
  paqueteDia: ReturnType<typeof usePaqueteDia>;
  gps: ReturnType<typeof useGpsOperativo>;
}

const GpsContext = createContext<GpsContextValue | null>(null);

export function GpsProvider({
  children,
  sesionId,
  deviceId,
  obtenerAccessToken,
}: {
  children: React.ReactNode;
  sesionId: string;
  deviceId: string;
  obtenerAccessToken: () => Promise<string | null>;
}) {
  const paqueteDia = usePaqueteDia(obtenerAccessToken);

  const puntosControl = useMemo(
    () => paqueteDia.paquete?.puntosControl ?? [],
    [paqueteDia.paquete],
  );

  const geometriaRuta = paqueteDia.paquete?.ruta.geometria.coordinates;

  // Entrega 2 (drenado oportunista del outbox en background): `obtenerAccessToken` ya llega
  // como prop a `GpsProvider` (lo usa `usePaqueteDia`, arriba) — se enhebra tal cual a
  // `useGpsOperativo`, que lo necesita para autenticar el drenado tras cada fix de foreground
  // y en el handler de `onHeartbeat`.
  const gps = useGpsOperativo(
    sesionId,
    deviceId,
    puntosControl,
    obtenerAccessToken,
    geometriaRuta,
  );
  const { settings } = useOperacionSettings();

  /**
   * ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): wrapper DELGADO sobre
   * `anunciarPuntoControl` (`./anuncio-punto-control`, sin React, ver su docblock) — el mismo
   * módulo que llama `tareaHeadlessUbicacion` (`gps/headless-task.ts`). El dedupe en memoria del
   * aviso de aproximación vive ADENTRO de ese módulo, no acá.
   *
   * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
   * 2026-09-23): este componente YA NO dispara vibración ni notificación de "llegaste" — ese
   * canal se ejecuta ENTERO dentro de `useGpsOperativo` (`use-gps-operativo.ts`, `onLocation`/
   * `onHeartbeat`/`detener`), inmediatamente después de que la MISMA cola
   * (`colaRegistroGps`, `gps/headless-task.ts`) decide el anuncio — "el foreground no tiene
   * disparador propio: consume las decisiones de esa misma cola". Acá solo queda el aviso de
   * aproximación (voz) y el sonido custom EXTRA, ninguno de los dos disparado por evidencia.
   */
  const anunciar = useCallback(
    (deteccion: DeteccionPuntoControl) => {
      // FIX POST-REVISIÓN (hallazgo 10, cleanup — "abre el outbox para un `_db` sin usar"):
      // `anunciarPuntoControl` documenta su primer parámetro como sin uso (el dedupe del aviso de
      // aproximación vive en memoria, `aproximacionesAnunciadas`, nunca en SQLite) — abrir
      // `quivo-outbox.db` acá solo para descartar el handle era una llamada nativa de sobra en el
      // camino más caliente del hook (cada fix con un punto de control cerca, potencialmente
      // cientos por jornada). Se pasa un placeholder tipado, que la función nunca lee.
      anunciarPuntoControl({} as SQLite.SQLiteDatabase, deteccion, { sesionId, puntosControl }).catch(
        (error: unknown) => {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-provider', paso: 'anunciar-punto-control-foreground' },
          });
        },
      );
    },
    [sesionId, puntosControl],
  );

  // Aviso de aproximación (SOLO voz) — respeta la preferencia `navegacionVoz` del chofer
  // (`use-operacion-settings.tsx`/`ajustes-screen.tsx`) porque acá SÍ hay settings disponibles
  // (a diferencia del headless, que no tiene árbol de React del que leerlas y por eso siempre
  // avisa — ver el docblock de `anuncio-punto-control.ts`: la app en foreground no es la
  // condición que este módulo existe para cubrir, así que preservar el toggle acá no compromete
  // el arreglo del reporte de Rosa).
  useEffect(() => {
    if (gps.deteccionAproximacion && settings.navegacionVoz) {
      anunciar(gps.deteccionAproximacion);
    }
  }, [gps.deteccionAproximacion, settings.navegacionVoz, anunciar]);

  // Sonido de confirmación EXTRA (más prolijo que el default de la notificación, `duckOthers`
  // en vez de competir con la música del trufi) — puramente foreground, por eso vive acá y no en
  // el módulo compartido. REDISEÑO: dispara sobre `gps.ultimoAnuncioLlegada` (la decisión YA
  // ejecutada por `useGpsOperativo`), NUNCA sobre `gps.ultimaDeteccion` (evidencia) — mismo
  // invariante que el resto del rediseño: la evidencia no dispara ningún canal hacia el chofer.
  // Compara `puntoControlId` + `pasada` (no solo el primero): con multi-vuelta, dos pasadas
  // CONSECUTIVAS del mismo punto de control solo cambian `pasada`.
  const ultimoSonado = useRef<{ puntoControlId: string; pasada: number } | null>(null);
  const reproducirSonidoConfirmacion = usePuntoControlSonido();

  useEffect(() => {
    if (gps.ultimoAnuncioLlegada && settings.sonidoConfirmacion) {
      const { puntoControlId, pasada } = gps.ultimoAnuncioLlegada;
      const yaSonado =
        ultimoSonado.current?.puntoControlId === puntoControlId &&
        ultimoSonado.current?.pasada === pasada;
      if (!yaSonado) {
        reproducirSonidoConfirmacion();
        ultimoSonado.current = { puntoControlId, pasada };
      }
    }
  }, [gps.ultimoAnuncioLlegada, settings.sonidoConfirmacion, reproducirSonidoConfirmacion]);

  return (
    <GpsContext.Provider value={{ paqueteDia, gps }}>
      {children}
    </GpsContext.Provider>
  );
}

export function useGpsContext() {
  const ctx = useContext(GpsContext);
  if (!ctx) {
    throw new Error('useGpsContext debe ser usado dentro de un GpsProvider');
  }
  return ctx;
}
