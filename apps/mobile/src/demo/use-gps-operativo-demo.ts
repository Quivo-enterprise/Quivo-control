import { useCallback, useMemo } from 'react';
import type { PuntoControlPaquete } from '@quivo/shared';
import type { AccionPermisoGps, DecisionPermisoGps } from '../gps/permiso-ubicacion';
import type { EstadoPermisoActividad } from '../gps/permiso-actividad';
import type { DeteccionPuntoControl } from '../gps/geofence';
import type { MotivoAnuncio } from '../features/operacion/decidir-anuncio';
import type { useGpsOperativo } from '../features/operacion/use-gps-operativo';
import { idParadaDemo } from './cuentas';
import { useDemo } from './demo-provider';
import { DATOS_HOY_BASE_MB, MB_POR_PUNTO, VELOCIDAD_NOMINAL_KMH } from './motor';

/**
 * Equivalente demo de `useGpsOperativo` (`../features/operacion/use-gps-operativo.ts`) — mismo
 * contrato (`ReturnType<typeof useGpsOperativo>`), pero **nunca importa el SDK nativo de
 * geolocalización en segundo plano** (Transistorsoft): este archivo solo importa TIPOS (`import
 * type`, se borran por completo al transpilar — cero `require()` en el JS final) de los módulos
 * reales que sí lo hacen transitivamente. En runtime, todo sale del motor (`./motor.ts`) vía
 * `useDemo()`.
 *
 * `iniciar`/`detener` disparan las acciones del motor (`iniciarJornada`/`finalizarJornada`);
 * `ultimaDeteccion` traduce la última detección del motor (ids slug internos) al contrato real
 * `DeteccionPuntoControl` con ids UUID (`idParadaDemo`, iguales a los que usa
 * `use-paquete-dia-demo.ts` para `puntosControl[].id`) — así el toast/sonido de confirmación
 * EXISTENTES (`control-feedback-toast.tsx`, `gps-provider.tsx`) disparan sin que B/C toquen esos
 * archivos. `deteccionAproximacion` (el aviso de voz "te estás acercando", separado de la
 * confirmación) NO se simula — queda `null` siempre; el guion de grabación no lo necesita, solo
 * el toast/sonido de confirmación al cruzar (`ultimaDeteccion`/`ultimoAnuncioLlegada`).
 */

const PERMISO_GPS_DEMO: DecisionPermisoGps = {
  estado: 'listo',
  bloqueante: false,
  titulo: '',
  mensaje: '',
  accion: null,
  etiquetaAccion: null,
};

export function useGpsOperativoDemo(
  _sesionId: string,
  _deviceId: string,
  _puntosControl: PuntoControlPaquete[] = [],
  _obtenerAccessToken: () => Promise<string | null>,
): ReturnType<typeof useGpsOperativo> {
  const { estado, acciones, posicionPropia } = useDemo();

  const ultimaDeteccion = useMemo<DeteccionPuntoControl | null>(() => {
    const d = estado.ultimaDeteccion;
    if (!d) return null;
    return {
      puntoControlId: idParadaDemo(estado.lineaPropiaId, d.puntoControlId),
      distanciaM: d.distanciaM,
      cumplido: true,
      radioToleranciaM: 30,
      pasada: d.pasada,
      fase: 'confirmado',
    };
  }, [estado.ultimaDeteccion, estado.lineaPropiaId]);

  const ultimoAnuncioLlegada = useMemo(() => {
    if (!ultimaDeteccion) return null;
    return {
      puntoControlId: ultimaDeteccion.puntoControlId,
      pasada: ultimaDeteccion.pasada ?? 1,
      motivo: 'proximidad' as MotivoAnuncio,
    };
  }, [ultimaDeteccion]);

  const posicionActual = useMemo(() => {
    if (!posicionPropia || !estado.tracking) return null;
    return { lat: posicionPropia.lat, lng: posicionPropia.lng, speedKmh: VELOCIDAD_NOMINAL_KMH };
  }, [posicionPropia, estado.tracking]);

  // Aproximación razonable de "cuántos puntos GPS se grabaron esta jornada" a partir del
  // crecimiento de `datosHoyMB` (mismo `MB_POR_PUNTO` que usa `tick()` en `./motor.ts`) — el
  // motor no lleva un contador de puntos propio separado porque nada en el demo lo necesita
  // salvo este campo de compatibilidad (no se renderiza hoy en `operation-screen.tsx`).
  const puntos = useMemo(
    () => Math.max(0, Math.round((estado.datosHoyMB - DATOS_HOY_BASE_MB) / MB_POR_PUNTO)),
    [estado.datosHoyMB],
  );

  const iniciar = useCallback(async () => {
    acciones.iniciarJornada();
  }, [acciones]);

  const detener = useCallback(async () => {
    acciones.finalizarJornada();
  }, [acciones]);

  const abrirAjustesPermisoGps = useCallback(async (_accion: AccionPermisoGps | null) => {}, []);

  const simularDeteccion = useCallback(
    (_puntoControlId: string, _distanciaM: number | null = null) => {
      acciones.saltarAlProximoPunto();
    },
    [acciones],
  );

  return {
    tracking: estado.tracking,
    puntos,
    resultado: null,
    errorGps: null,
    permisoGps: PERMISO_GPS_DEMO,
    abrirAjustesPermisoGps,
    estadoPermisoActividad: 'concedido' as EstadoPermisoActividad,
    ultimaDeteccion,
    deteccionAproximacion: null,
    ultimoAnuncioLlegada,
    posicionActual,
    iniciar,
    detener,
    simularDeteccion,
  };
}
