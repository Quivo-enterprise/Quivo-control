import { useCallback, useEffect, useRef, useState } from 'react';
import BackgroundGeolocation, { type Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete } from '@quivo/shared';
import { abrirOutbox, contarEventosPendientes, encolarEvento } from '../../db/outbox';
import { gpsSpikeConfig } from '../../gps/background-geolocation.config';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  evaluarCriteriosGo,
  type MuestraBateria,
} from '../../gps/battery-gap-monitor';
import {
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
  type DeteccionPuntoControl,
} from '../../gps/geofence';

export function useGpsOperativo(
  sesionId: string,
  deviceId: string,
  puntosControl: PuntoControlPaquete[] = [],
) {
  const [tracking, setTracking] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultado, setResultado] = useState<string | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [ultimaDeteccion, setUltimaDeteccion] = useState<DeteccionPuntoControl | null>(null);
  const [posicionActual, setPosicionActual] = useState<{ lat: number; lng: number } | null>(null);
  const timestamps = useRef<number[]>([]);
  const bateria = useRef<MuestraBateria[]>([]);
  const inicioMs = useRef<number | null>(null);
  const puntosRef = useRef(0);
  const puntosControlDetectados = useRef<Set<string>>(new Set());
  const subscription = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    // Attempt to get the initial location without starting the tracker
    BackgroundGeolocation.getCurrentPosition({
      samples: 1,
      persist: false,
    }).then((location) => {
      setPosicionActual({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    }).catch(() => {
      // Ignorar fallo silencioso (puede que no tenga permisos aún)
    });

    return () => {
      subscription.current?.remove();
      subscription.current = null;
    };
  }, []);

  const onLocation = useCallback(
    async (location: Location) => {
      setPosicionActual({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
      const ts = new Date(location.timestamp).getTime();
      timestamps.current.push(ts);
      bateria.current.push({ ts, nivel: (location.battery?.level ?? -1) * 100 });
      puntosRef.current += 1;
      setPuntos(puntosRef.current);

      const db = await abrirOutbox();
      await encolarEvento(db, {
        deviceId,
        tipo: 'gps_point',
        payload: {
          sesionId,
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy,
          speed: location.coords.speed,
        },
      });

      if (puntosControl.length > 0) {
        const posicion: [number, number] = [location.coords.longitude, location.coords.latitude];
        const detecciones = detectarPuntosControlCercanos(posicion, puntosControl);
        const nuevos = filtrarNuevosCumplimientos(puntosControlDetectados.current, detecciones);
        for (const deteccion of nuevos) {
          puntosControlDetectados.current.add(deteccion.puntoControlId);
          setUltimaDeteccion(deteccion);
          await encolarEvento(db, {
            deviceId,
            tipo: 'cumplimiento_punto_control',
            payload: {
              sesionId,
              puntoControlId: deteccion.puntoControlId,
              // lat/lng de la posición que disparó la detección — el worker (QUI-241)
              // necesita la coordenada real para re-validar server-side (ST_DWithin,
              // fuente de verdad RF-39), no solo confiar en `distanciaM` autoreportada.
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              distanciaM: deteccion.distanciaM,
              validadoPor: 'app',
            },
          });
        }
      }
    },
    [deviceId, sesionId, puntosControl],
  );

  const iniciar = useCallback(async () => {
    setErrorGps(null);
    setResultado(null);
    inicioMs.current = Date.now();
    timestamps.current = [];
    bateria.current = [];
    puntosRef.current = 0;
    puntosControlDetectados.current = new Set();
    setPuntos(0);
    setUltimaDeteccion(null);
    try {
      subscription.current?.remove();
      subscription.current = BackgroundGeolocation.onLocation(onLocation, (error) => {
        setErrorGps(`No se pudo registrar una ubicación (código ${String(error)}).`);
      });
      await BackgroundGeolocation.ready(gpsSpikeConfig);
      await BackgroundGeolocation.start();
      setTracking(true);
      // RNF-24/QUI-247: marca el límite real del recorrido — sin esto, reconstruir un
      // recorrido más adelante solo tenía los puntos GPS sueltos, sin saber dónde empezó.
      const db = await abrirOutbox();
      await encolarEvento(db, { deviceId, tipo: 'inicio_recorrido', payload: { sesionId } });
    } catch {
      subscription.current?.remove();
      subscription.current = null;
      setErrorGps('No se pudo iniciar el GPS. Revisa permisos y licencia del módulo nativo.');
    }
  }, [onLocation, deviceId, sesionId]);

  const detener = useCallback(async () => {
    setErrorGps(null);
    try {
      await BackgroundGeolocation.stop();
      subscription.current?.remove();
      subscription.current = null;
      setTracking(false);

      const db = await abrirOutbox();
      await encolarEvento(db, { deviceId, tipo: 'fin_recorrido', payload: { sesionId } });

      const duracionHoras = inicioMs.current ? (Date.now() - inicioMs.current) / 3_600_000 : 0;
      const reporteHuecos = detectarHuecos(timestamps.current);
      const consumo = bateriaConsumidaPorcentaje(bateria.current);
      const veredicto = evaluarCriteriosGo({
        bateriaConsumidaPorcentaje: consumo,
        reporteHuecos,
        duracionMedicionHoras: duracionHoras,
      });
      const totalOutbox = await contarEventosPendientes(await abrirOutbox());
      setResultado(
        [
          `Duración: ${duracionHoras.toFixed(2)} h`,
          `Puntos GPS: ${puntosRef.current} · pendientes: ${totalOutbox}`,
          `Batería estimada / 8h: ${veredicto.bateriaEstimadaPorJornada8h.toFixed(1)}%`,
          `Huecos > 2 min: ${reporteHuecos.cantidad}`,
          `Spike: ${veredicto.go ? 'GO' : 'NO-GO'}`,
        ].join('\n'),
      );
    } catch {
      setErrorGps('No se pudo detener correctamente el GPS. Intenta nuevamente.');
    }
  }, [deviceId, sesionId]);

  const simularDeteccion = useCallback((puntoControlId: string) => {
    const deteccion: DeteccionPuntoControl = {
      puntoControlId,
      distanciaM: 15,
      cumplido: true,
    };
    puntosControlDetectados.current.add(puntoControlId);
    setUltimaDeteccion(deteccion);
  }, []);

  return {
    tracking,
    puntos,
    resultado,
    errorGps,
    ultimaDeteccion,
    posicionActual,
    iniciar,
    detener,
    simularDeteccion,
  };
}
