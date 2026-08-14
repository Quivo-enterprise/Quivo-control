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
  const ultimoHablado = useRef<string | null>(null);

  useEffect(() => {
    if (gps.ultimaDeteccion && settings.navegacionVoz) {
      if (ultimoHablado.current !== gps.ultimaDeteccion.puntoControlId) {
        Speech.speak(`Punto de control alcanzado. Distancia: ${gps.ultimaDeteccion.distanciaM} metros.`);
        ultimoHablado.current = gps.ultimaDeteccion.puntoControlId;
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
