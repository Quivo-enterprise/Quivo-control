import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import BackgroundGeolocation, { type Location } from 'react-native-background-geolocation';
import { resolverTsFix, type PuntoControlPaquete } from '@quivo/shared';
import {
  abrirOutbox,
  contarEventosPendientes,
  encolarEvento,
  obtenerEventosPorTipo,
  obtenerPayloadsPorTipo,
} from '../../db/outbox';
import { gpsSpikeConfig, logVerboseHabilitado } from '../../gps/background-geolocation.config';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  duracionVentanaBateriaHoras,
  evaluarCriteriosGo,
  type MuestraBateria,
} from '../../gps/battery-gap-monitor';
import { claveCumplimiento, type DeteccionPuntoControl } from '../../gps/geofence';
import { registrarPuntoGps } from '../../gps/headless-task';
import { clavesCumplimientoDesdePayloads } from '../../gps/location-task';

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
  const bateria = useRef<MuestraBateria[]>([]);
  const puntosRef = useRef(0);
  const erroresEscritura = useRef(0);
  const puntosControlDetectados = useRef<Set<string>>(new Set());
  const subscription = useRef<{ remove: () => void } | null>(null);

  const onLocation = useCallback(
    // La escritura al outbox (gps_point + cumplimiento_punto_control) vive en
    // `registrarPuntoGps` (`gps/headless-task.ts`), compartida con el headless task que
    // corre cuando la app está terminada (QUI-216) — acá solo queda lo que es
    // genuinamente de React: estado de UI y los refs que alimentan el veredicto del spike.
    async (location: Location) => {
      // El contador cuenta UBICACIONES RECIBIDAS del SDK, y se incrementa antes de cualquier
      // `await`: si la escritura al outbox falla, la línea "Puntos GPS: N" del veredicto NO
      // debe desviarse por debajo de lo realmente recibido (eso hacía parecer parcialmente
      // limpia una corrida en la que se estaba perdiendo evidencia). Lo que no se pudo
      // escribir se cuenta aparte, en `erroresEscritura`, y vuelve NO-GO el veredicto.
      puntosRef.current += 1;
      setPuntos(puntosRef.current);
      setPosicionActual({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
      const ts = new Date(location.timestamp).getTime();
      // El tipo del SDK declara `battery: Battery` (con `level: number`) NO opcional, pero
      // son datos que cruzan el bridge nativo y no hay garantía real de que respeten el
      // `.d.ts` en todos los dispositivos/versiones — antes había un centinela `-1` que,
      // multiplicado por 100, se colaba como "-100%" válido en `bateriaConsumidaPorcentaje`:
      // con la primera muestra sin batería y la última con, `Math.max(0, -180)` daba 0% de
      // consumo sin importar el consumo real (hallazgo de revisión A7). Ahora la muestra sin
      // lectura usable simplemente NO se cuenta, en vez de inyectar un número que ensucia el
      // cálculo.
      const nivelBateria = location.battery?.level;
      if (typeof nivelBateria === 'number' && Number.isFinite(nivelBateria)) {
        bateria.current.push({ ts, nivel: nivelBateria * 100 });
      }

      try {
        const db = await abrirOutbox();
        const { deteccion } = await registrarPuntoGps(
          db,
          location,
          { deviceId, sesionId, puntosControl },
          puntosControlDetectados.current,
        );
        if (deteccion) setUltimaDeteccion(deteccion);
      } catch (error) {
        // Sin este catch, `onLocation` (async) rechazaba y el fallo quedaba como unhandled
        // rejection: evidencia perdida en silencio.
        erroresEscritura.current += 1;
        console.error('[QUIVO][gps] No se pudo guardar la ubicación en el outbox', error);
        // Mismo motivo que los `captureException` de `headless-task.ts` (QUI-365): el único
        // rastro que tenía este fallo antes era `console.error`, y nadie lee la consola del
        // teléfono de un conductor en ruta — este es justo el camino en vivo (foreground) que
        // NO estaba reportado, a diferencia del headless.
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'encolar-punto' },
          extra: {
            code: typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined,
            // H10 (hallazgo de revisión, bajo): `erroresEscritura.current` solo se resetea en
            // `iniciar()`, nunca tras una escritura exitosa — es acumulativo DE LA CORRIDA
            // actual, no de fallos consecutivos sin éxitos de por medio. Renombrado para que
            // coincida con el string de UI de abajo ("... en esta corrida").
            erroresEnCorrida: erroresEscritura.current,
          },
        });
        setErrorGps(
          `No se pudo guardar una ubicación en el outbox (${erroresEscritura.current} en esta corrida). La evidencia de esos puntos se perdió.`,
        );
      }
    },
    [deviceId, sesionId, puntosControl],
  );

  // `onLocation` cambia de identidad cuando cambian `puntosControl`/`sesionId`, pero la
  // suscripción al SDK se registra una sola vez: se lee siempre la última versión por ref
  // para que no quede capturada una closure vieja (p. ej. con la lista de puntos de control
  // todavía vacía, antes de que baje el paquete del día).
  const onLocationRef = useRef(onLocation);
  useEffect(() => {
    onLocationRef.current = onLocation;
  }, [onLocation]);

  const suscribirUbicaciones = useCallback(() => {
    subscription.current?.remove();
    subscription.current = BackgroundGeolocation.onLocation(
      (location) => {
        void onLocationRef.current(location);
      },
      (error) => {
        setErrorGps(`No se pudo registrar una ubicación (código ${String(error)}).`);
      },
    );
  }, []);

  useEffect(() => {
    // Attempt to get the initial location without starting the tracker
    BackgroundGeolocation.getCurrentPosition({
      samples: 1,
      persist: false,
    })
      .then((location) => {
        setPosicionActual({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        });
      })
      .catch(() => {
        // Ignorar fallo silencioso (puede que no tenga permisos aún)
      });

    // Con `stopOnTerminate: false` + `startOnBoot: true` el tracking nativo corre
    // independiente del proceso de la app. Si el chofer mata la app a mitad de turno
    // (headless escribiendo) y después la reabre para mirar la ruta SIN tocar "Iniciar", el
    // headless deja de dispararse (Transistorsoft solo lo invoca con la app terminada) y no
    // hay ninguna suscripción `onLocation`: el SDK seguiría grabando nativo mientras NADA
    // copia puntos a `quivo-outbox.db`. Re-enganchamos la suscripción si el plugin ya está
    // `enabled`, sin re-emitir `inicio_recorrido` — el recorrido ya empezó y un segundo
    // marcador de inicio deformaría el recorrido reconstruido (QUI-247).
    let montado = true;
    BackgroundGeolocation.getState()
      .then((estado) => {
        if (!montado || !estado.enabled) return;
        suscribirUbicaciones();
        setTracking(true);
      })
      .catch(() => {
        // Sin estado del plugin no hay nada que re-enganchar: "Iniciar" sigue disponible.
      });

    return () => {
      montado = false;
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [suscribirUbicaciones]);

  const iniciar = useCallback(async () => {
    setErrorGps(null);
    setResultado(null);
    bateria.current = [];
    puntosRef.current = 0;
    erroresEscritura.current = 0;
    setPuntos(0);
    setUltimaDeteccion(null);
    try {
      const db = await abrirOutbox();
      // A6 (hallazgo de revisión): sembrar el Set desde el outbox en vez de `new Set()`.
      // Escenario que esto cierra: el chofer mata la app, el headless registra el
      // cumplimiento de `pc-1`, reabre y aprieta "Iniciar" (comportamiento normal, el botón
      // sigue visible) — con `new Set()` el vehículo vuelve a pasar por `pc-1` en el tramo de
      // retorno de una ruta circular y el hook emite un SEGUNDO `cumplimiento_punto_control`
      // con `eventId` nuevo, que el worker no puede deduplicar (dedupe es por `eventId`, no
      // por `(sesionId, puntoControlId)`) — doble evidencia de paso para una sola sanción.
      // Reusa la misma función pura y testeada que usa `asegurarSemillaCumplimientos` del
      // lado headless (`location-task.ts`).
      const payloadsCumplimiento = await obtenerPayloadsPorTipo(db, 'cumplimiento_punto_control');
      puntosControlDetectados.current = clavesCumplimientoDesdePayloads(payloadsCumplimiento);

      suscribirUbicaciones();
      await BackgroundGeolocation.ready(gpsSpikeConfig);
      await BackgroundGeolocation.start();
      setTracking(true);
      // RNF-24/QUI-247: marca el límite real del recorrido — sin esto, reconstruir un
      // recorrido más adelante solo tenía los puntos GPS sueltos, sin saber dónde empezó.
      await encolarEvento(db, { deviceId, tipo: 'inicio_recorrido', payload: { sesionId } });
    } catch {
      subscription.current?.remove();
      subscription.current = null;
      setErrorGps('No se pudo iniciar el GPS. Revisa permisos y licencia del módulo nativo.');
    }
  }, [suscribirUbicaciones, deviceId, sesionId]);

  const detener = useCallback(async () => {
    setErrorGps(null);
    try {
      await BackgroundGeolocation.stop();
      subscription.current?.remove();
      subscription.current = null;
      setTracking(false);

      const db = await abrirOutbox();
      await encolarEvento(db, { deviceId, tipo: 'fin_recorrido', payload: { sesionId } });

      // A1 (hallazgo de revisión, QUI-216 criterio B): los huecos se calculan desde el
      // OUTBOX, no desde un `useRef` en memoria — ese ref solo lo alimentaba `onLocation`,
      // que no corre en el camino headless (app terminada, sin hooks). Si el chofer mata la
      // app a mitad de turno, el proceso que reabre arranca con un ref vacío y
      // `detectarHuecos` terminaba evaluando solo el último tramo en vivo, reportando "0
      // huecos" sobre una ventana que en realidad no se midió. Los puntos ya están
      // persistidos en el outbox con su `tsFix` (mismo instante que se persiste
      // server-side — ver `resolverTsFix`), así que leerlos de ahí cubre la ventana
      // completa, incluida la parte grabada con la app terminada, y sobrevive a la muerte
      // del proceso. Se filtra por `sesionId` para no arrastrar puntos de una corrida
      // anterior que sigan en el outbox sin purgar.
      const eventosGps = await obtenerEventosPorTipo(db, 'gps_point');
      const timestampsMedicion = eventosGps
        .filter((evento) => evento.payload['sesionId'] === sesionId)
        // M3 (hallazgo de revisión, medio): excluye los puntos que vinieron del rescate de
        // emergencia del día 1 (`rescate-dia1-core.ts`, `origen: 'rescate'`). Esos puntos
        // llevan el `sesionId` de la sesión que CORRIÓ el rescate (H5, por diseño), que puede
        // ser esta misma sesión si el chofer rescata a mitad de turno — sin este filtro, sus
        // `tsFix` del día 1 se mezclan con la ventana de medición de la corrida en vivo:
        // `primerTs` salta al día 1, `duracionHoras` se dispara a 24h+, `detectarHuecos`
        // reporta un hueco gigante y `evaluarCriteriosGo` emite un NO-GO falso sobre una
        // corrida que en realidad estuvo bien.
        .filter((evento) => evento.payload['origen'] !== 'rescate')
        .map((evento) => Date.parse(resolverTsFix(evento.payload, evento.ts)))
        .filter((ts) => !Number.isNaN(ts))
        .sort((a, b) => a - b);
      const primerTs = timestampsMedicion[0];
      const ultimoTs = timestampsMedicion[timestampsMedicion.length - 1];
      // Misma ventana para huecos y duración: si los huecos salen del outbox, la duración
      // tiene que hablar del mismo rango, o la extrapolación de batería a 8h queda
      // inconsistente con lo que realmente se detectó de huecos.
      const duracionHoras =
        primerTs !== undefined && ultimoTs !== undefined ? (ultimoTs - primerTs) / 3_600_000 : 0;
      const reporteHuecos = detectarHuecos(timestampsMedicion);
      const consumo = bateriaConsumidaPorcentaje(bateria.current);
      // A9 (hallazgo de revisión, QUI-216 criterio A): la ventana de batería es OTRA ventana,
      // distinta de `duracionHoras` de arriba. `bateria.current` sigue siendo un `useRef` que
      // solo alimenta `onLocation` — no corre en el camino headless y no sobrevive a que
      // Android recicle el proceso si el chofer mata la app — así que puede cubrir solo una
      // fracción de la corrida real. Pasarle a `evaluarCriteriosGo` la ventana de huecos como
      // denominador de la extrapolación de batería (como se hacía antes) daba una estimación
      // deprimida: numerador corto (poca batería muestreada) sobre denominador largo (la
      // corrida completa). `evaluarCriteriosGo` aplica además su propio piso de cobertura
      // sobre esta ventana — ver `battery-gap-monitor.ts` — así que una ventana de batería
      // corta no puede colarse como GO.
      const duracionBateriaHoras = duracionVentanaBateriaHoras(bateria.current);
      const veredicto = evaluarCriteriosGo({
        bateriaConsumidaPorcentaje: consumo,
        reporteHuecos,
        duracionMedicionHoras: duracionHoras,
        duracionBateriaHoras,
        erroresEscrituraOutbox: erroresEscritura.current,
      });
      const totalOutbox = await contarEventosPendientes(db);
      setResultado(
        [
          `Duración: ${duracionHoras.toFixed(2)} h`,
          `Ubicaciones recibidas: ${puntosRef.current} · pendientes en outbox: ${totalOutbox}`,
          `Fallos de escritura al outbox: ${erroresEscritura.current}`,
          // A9: ventana de batería aparte de la de arriba, para que quien lea el veredicto
          // vea las dos ventanas y no confunda "cuánto duró la corrida" con "cuánto se
          // muestreó de batería".
          `Batería medida durante: ${duracionBateriaHoras.toFixed(2)} h (de ${duracionHoras.toFixed(2)} h totales)`,
          `Batería estimada / 8h: ${veredicto.bateriaEstimadaPorJornada8h.toFixed(1)}%`,
          `Huecos > 2 min: ${reporteHuecos.cantidad}`,
          // A8c (hallazgo de revisión): sin esto, una corrida contaminada por logging
          // VERBOSE (I/O extra a la SQLite nativa del plugin, que el propio criterio A mide)
          // y una corrida limpia con ERROR producen el mismo string — no se puede reclamar
          // un GO de batería sin saber con qué nivel de log se instrumentó.
          `Log GPS: ${logVerboseHabilitado ? 'VERBOSE' : 'ERROR'}`,
          `Spike: ${veredicto.go ? 'GO' : 'NO-GO'}`,
        ].join('\n'),
      );
    } catch {
      setErrorGps('No se pudo detener correctamente el GPS. Intenta nuevamente.');
    }
  }, [deviceId, sesionId]);

  const simularDeteccion = useCallback(
    (puntoControlId: string) => {
      const deteccion: DeteccionPuntoControl = {
        puntoControlId,
        distanciaM: 15,
        cumplido: true,
      };
      puntosControlDetectados.current.add(claveCumplimiento(sesionId, puntoControlId));
      setUltimaDeteccion(deteccion);
    },
    [sesionId],
  );

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
