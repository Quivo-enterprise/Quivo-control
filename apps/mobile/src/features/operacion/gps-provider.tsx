import React, { createContext, useContext, useMemo, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';
import { usePaqueteDia } from './use-paquete-dia';
import { useGpsOperativo } from './use-gps-operativo';
import { useOperacionSettings } from '../perfil/use-operacion-settings';
import { usePuntoControlSonido } from './confirmacion-sonido';
import { formatearDistanciaVoz } from './format-distancia';

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
  // ENTREGA 5 (plan post-piloto 2026-09-09): `orden` de cada punto de control por id, para que
  // la voz diga "Punto de control 16" en vez de un genérico "alcanzado" — el conductor necesita
  // saber CUÁL punto sonó, no solo que sonó alguno. `+1` porque `orden` es 0-indexado
  // internamente (mismo criterio que `next-control-sheet.tsx`: `nextPointOrder + 1`).
  const ordenPorPuntoControlId = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const pc of puntosControl) mapa.set(pc.id, pc.orden + 1);
    return mapa;
  }, [puntosControl]);
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
        // ENTREGA 5: ayer la voz dijo "104.58484945 metros" (8 decimales de `distanciaM`
        // crudo, `haversineMetros`) — sonaba a bug, no a instrucción. `formatearDistanciaVoz`
        // redondea a múltiplos de 10 ("a 130 metros"), y el número de orden identifica el
        // punto sin ambigüedad.
        const orden = ordenPorPuntoControlId.get(puntoControlId);
        const identificador = orden !== undefined ? `Punto de control ${orden}` : 'Punto de control';
        // `volume: 1.0` explícito (el pedido fue "sonido super fuerte para que se escuche"):
        // no depender del default de la plataforma, que en algunos OEM sale por debajo del
        // volumen máximo del stream de media.
        Speech.speak(`${identificador}, a ${formatearDistanciaVoz(gps.ultimaDeteccion.distanciaM)}.`, {
          volume: 1.0,
        });
        ultimoHablado.current = { puntoControlId, pasada };
      }
    }
  }, [gps.ultimaDeteccion, settings.navegacionVoz, ordenPorPuntoControlId]);

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
