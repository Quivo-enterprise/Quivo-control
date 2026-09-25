import React, { createContext, useContext, useMemo, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';
import { usePaqueteDia } from './use-paquete-dia';
import { useGpsOperativo } from './use-gps-operativo';
import { useOperacionSettings } from '../perfil/use-operacion-settings';
import { usePuntoControlSonido } from './confirmacion-sonido';

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

  // Entrega 2 (drenado oportunista del outbox en background): `obtenerAccessToken` ya llega
  // como prop a `GpsProvider` (lo usa `usePaqueteDia`, arriba) — se enhebra tal cual a
  // `useGpsOperativo`, que lo necesita para autenticar el drenado tras cada fix de foreground
  // y en el handler de `onHeartbeat`.
  const gps = useGpsOperativo(sesionId, deviceId, puntosControl, obtenerAccessToken);
  const { settings } = useOperacionSettings();
  // B4 (hallazgo de revisión, bajo): compara también contra la PASADA, no solo el
  // `puntoControlId` — con multi-vuelta, dos pasadas CONSECUTIVAS del mismo punto de control
  // solo cambian `pasada`, no `puntoControlId`, así que comparar solo el id dejaba la segunda
  // pasada muda (nunca se actualizaba `ultimoHablado`, porque ya "coincidía").
  const ultimoHablado = useRef<{ puntoControlId: string; pasada: number } | null>(null);

  useEffect(() => {
    if (gps.ultimaDeteccion && settings.navegacionVoz) {
      const { puntoControlId, pasada = 0 } = gps.ultimaDeteccion;
      const yaHablado =
        ultimoHablado.current?.puntoControlId === puntoControlId &&
        ultimoHablado.current?.pasada === pasada;
      if (!yaHablado) {
        // `volume: 1.0` explícito (el pedido fue "sonido super fuerte para que se escuche"):
        // no depender del default de la plataforma, que en algunos OEM sale por debajo del
        // volumen máximo del stream de media.
        Speech.speak(`Punto de control alcanzado. Distancia: ${gps.ultimaDeteccion.distanciaM} metros.`, {
          volume: 1.0,
        });
        ultimoHablado.current = { puntoControlId, pasada };
      }
    }
  }, [gps.ultimaDeteccion, settings.navegacionVoz]);

  // Sonido de confirmación (distinto de la voz de arriba, con su propia preferencia
  // `sonidoConfirmacion` — ver `use-operacion-settings.tsx` y `confirmacion-sonido.ts`): un
  // `useRef` PROPIO, no compartido con `ultimoHablado`, para que activar/desactivar una
  // preferencia sin la otra no afecte el criterio de la que sigue prendida. Mismo criterio
  // multi-vuelta EXACTO que la voz (B4, arriba): compara `{puntoControlId, pasada}`, no solo el
  // id, o la segunda pasada del mismo punto de control quedaría muda.
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
