import React, { createContext, useContext, useMemo, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';
import { usePaqueteDia } from './use-paquete-dia';
import { useGpsOperativo } from './use-gps-operativo';
import { useOperacionSettings } from '../perfil/use-operacion-settings';

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
        Speech.speak(`Punto de control alcanzado. Distancia: ${gps.ultimaDeteccion.distanciaM} metros.`);
        ultimoHablado.current = { puntoControlId, pasada };
      }
    }
  }, [gps.ultimaDeteccion, settings.navegacionVoz]);

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
