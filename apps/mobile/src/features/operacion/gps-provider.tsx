import React, { createContext, useContext, useMemo, useEffect, useRef, useCallback } from 'react';
import * as Sentry from '@sentry/react-native';
import { usePaqueteDia } from './use-paquete-dia';
import { useGpsOperativo } from './use-gps-operativo';
import { useOperacionSettings } from '../perfil/use-operacion-settings';
import { usePuntoControlSonido } from './confirmacion-sonido';
import { abrirOutbox } from '../../db/outbox';
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

  const gps = useGpsOperativo(sesionId, deviceId, puntosControl);
  const { settings } = useOperacionSettings();

  /**
   * ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): wrapper DELGADO sobre
   * `anunciarPuntoControl` (`./anuncio-punto-control`, sin React, ver su docblock) — el mismo
   * módulo que llama `tareaHeadlessUbicacion` (`gps/headless-task.ts`). El dedupe (en memoria
   * para `'aproximacion'`, persistido en SQLite para `'confirmado'`) vive ADENTRO de ese
   * módulo, no acá: por eso este componente ya NO necesita su propio `useRef` de "¿ya lo
   * anuncié?" como tenía antes de esta entrega — llamar dos veces con la misma detección es un
   * no-op seguro.
   */
  const anunciar = useCallback(
    (deteccion: DeteccionPuntoControl) => {
      abrirOutbox()
        .then((db) => anunciarPuntoControl(db, deteccion, { sesionId, puntosControl }))
        .catch((error: unknown) => {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-provider', paso: 'anunciar-punto-control-foreground' },
          });
        });
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

  // DECISIÓN CTO 2026-09-23 (`RADIO_CONFIRMACION_M`): anuncio de "llegaste" en TIEMPO REAL
  // (vibración + notificación), apenas el vehículo mide `distanciaM <= RADIO_CONFIRMACION_M`
  // durante una visita activa — PISO universal, igual que la confirmación de evidencia de abajo
  // (sin gate de settings): el dedupe (`confirmacionesProximidadAnunciadas`,
  // `anuncio-punto-control.ts`) evita repetirlo cuando la confirmación de evidencia llegue
  // después para el MISMO paso.
  useEffect(() => {
    if (gps.deteccionConfirmacionProximidad) {
      anunciar(gps.deteccionConfirmacionProximidad);
    }
  }, [gps.deteccionConfirmacionProximidad, anunciar]);

  // Confirmación de paso (vibración + notificación con sonido) — el PISO universal, igual en
  // foreground que en headless: regla dura del plan ("vibración siempre"), sin gate de
  // settings. `settings.sonidoConfirmacion` de abajo es una capa EXTRA sobre este piso (el
  // sonido custom más prolijo, con `duckOthers`), no un reemplazo — puede apagarse sin que el
  // chofer deje de sentir la confirmación.
  useEffect(() => {
    if (gps.ultimaDeteccion) {
      anunciar(gps.ultimaDeteccion);
    }
  }, [gps.ultimaDeteccion, anunciar]);

  // Sonido de confirmación EXTRA (distinto del piso universal de arriba, con su propia
  // preferencia `sonidoConfirmacion` — ver `use-operacion-settings.tsx` y
  // `confirmacion-sonido.ts`): más prolijo que el default de la notificación (`duckOthers` en
  // vez de competir con la música del trufi), pero puramente foreground — por eso vive acá y
  // no en el módulo compartido. B4 (hallazgo de revisión, bajo, sigue aplicando): compara
  // también contra la PASADA, no solo el `puntoControlId` — con multi-vuelta, dos pasadas
  // CONSECUTIVAS del mismo punto de control solo cambian `pasada`, no `puntoControlId`.
  const ultimoSonado = useRef<{ puntoControlId: string; pasada: number } | null>(null);
  const reproducirSonidoConfirmacion = usePuntoControlSonido();

  useEffect(() => {
    if (gps.ultimaDeteccion && settings.sonidoConfirmacion) {
      const { puntoControlId, pasada = 0 } = gps.ultimaDeteccion;
      const yaSonado =
        ultimoSonado.current?.puntoControlId === puntoControlId &&
        ultimoSonado.current?.pasada === pasada;
      if (!yaSonado) {
        reproducirSonidoConfirmacion();
        ultimoSonado.current = { puntoControlId, pasada };
      }
    }
  }, [gps.ultimaDeteccion, settings.sonidoConfirmacion, reproducirSonidoConfirmacion]);

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
