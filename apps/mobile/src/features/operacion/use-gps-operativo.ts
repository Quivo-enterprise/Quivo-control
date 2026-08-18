import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import BackgroundGeolocation, { type Location } from 'react-native-background-geolocation';
import { resolverTsFix, type PuntoControlPaquete } from '@quivo/shared';
import {
  abrirOutbox,
  contarEventosPendientes,
  encolarEvento,
  obtenerEventosPorTipo,
} from '../../db/outbox';
import { gpsSpikeConfig, logVerboseHabilitado } from '../../gps/background-geolocation.config';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  duracionVentanaBateriaHoras,
  evaluarCriteriosGo,
  type MuestraBateria,
} from '../../gps/battery-gap-monitor';
import { claveCumplimiento, type DeteccionPuntoControl, type EstadoPuntoControl } from '../../gps/geofence';
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
  const puntosControlDetectados = useRef<Map<string, EstadoPuntoControl>>(new Map());
  const subscription = useRef<{ remove: () => void } | null>(null);
  // C1 (hallazgo de revisión CRÍTICO): promesa de la siembra en curso/completada — la
  // referencia ambos caminos que pueden necesitar sembrar (el `useEffect` de re-enganche y
  // `iniciar()`) leen para no sembrar dos veces y para no suscribirse/arrancar antes de que
  // termine. Ver `sembrarCumplimientos` más abajo.
  const semillaPromise = useRef<Promise<void> | null>(null);

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
        // C1/B6: esperar la semilla ACÁ (y no antes de suscribirse) es lo que permite que la
        // suscripción se instale ANTES de `BackgroundGeolocation.start()` sin abrir la ventana
        // que ese orden existía para cerrar. Un fix que llegue mientras la semilla está en
        // curso queda RETENIDO hasta que termine, en vez de procesarse contra un Map vacío
        // (que lo re-emitiría como `pasada: 1`) o de perderse por no haber suscripción todavía.
        // La semilla nunca rechaza (best-effort, ver `sembrarCumplimientos`).
        await semillaPromise.current;
        const db = await abrirOutbox();
        const { deteccion } = await registrarPuntoGps(
          db,
          location,
          { deviceId, sesionId, puntosControl },
          // B6 (hallazgo de revisión, bajo): se pasa el REF, no `.current` — la cola FIFO de
          // `registrarPuntoGps` difiere la ejecución, y `sembrarCumplimientos` puede reemplazar
          // el Map en el medio. Ver `ContenedorEstadosPuntosControl` (`gps/headless-task.ts`).
          puntosControlDetectados,
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

  /**
   * C1 (hallazgo de revisión CRÍTICO): siembra `puntosControlDetectados.current` desde el
   * outbox local, reusando la misma función pura y testeada que usa el headless task
   * (`asegurarSemillaCumplimientos` en `headless-task.ts`), incluida la histéresis (A1: la
   * semilla siempre deriva `dentro: true` cuando hay una emisión previa — ver el comentario
   * de `clavesCumplimientoDesdePayloads`, `location-task.ts`).
   *
   * Extraída a función reutilizable porque tiene que correr en DOS caminos, y los dos tienen
   * que esperar la MISMA promesa (`semillaPromise`, arriba) en vez de sembrar cada uno por su
   * cuenta:
   * - El `useEffect` de re-enganche de abajo, SIEMPRE al montar — es el único lugar que puede
   *   garantizar que la siembra corrió también cuando el chofer mata la app a mitad de turno
   *   y la reabre SIN tocar "Iniciar": con el plugin nativo ya `enabled`, el botón pasa
   *   directo a "Finalizar recorrido" (`next-control-sheet.tsx`) y `iniciar()` — el único
   *   lugar que sembraba antes de este fix — se vuelve INALCANZABLE.
   * - `iniciar()`, más abajo, para el arranque manual — ya no siembra por su cuenta, solo
   *   espera esta promesa.
   *
   * Best-effort: nunca rechaza — un fallo acá (SQLite, outbox corrupto) no debe bloquear ni
   * el re-enganche ni "Iniciar"; el Map queda como estaba (vacío en el peor caso, mismo
   * comportamiento que antes de este fix) y se reporta a Sentry, igual que el equivalente
   * headless (`asegurarSemillaCumplimientos`).
   */
  const sembrarCumplimientos = useCallback(async (): Promise<void> => {
    try {
      const db = await abrirOutbox();
      const eventosCumplimiento = await obtenerEventosPorTipo(
        db,
        'cumplimiento_punto_control',
        sesionId,
      );
      puntosControlDetectados.current = clavesCumplimientoDesdePayloads(eventosCumplimiento);
    } catch (error) {
      console.error('[QUIVO][gps] No se pudo sembrar cumplimientos desde el outbox', error);
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'sembrar-cumplimientos' },
      });
    }
  }, [sesionId]);

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

    // C1 (hallazgo de revisión CRÍTICO): la siembra corre SIEMPRE al montar (keyed por
    // `sesionId`, ver las deps de este efecto), ANTES de decidir si re-enganchar la
    // suscripción — no solo cuando el chofer aprieta "Iniciar" (ver el comentario de
    // `sembrarCumplimientos` arriba para el porqué).
    semillaPromise.current = sembrarCumplimientos();

    // Con `stopOnTerminate: false` + `startOnBoot: true` el tracking nativo corre
    // independiente del proceso de la app. Si el chofer mata la app a mitad de turno
    // (headless escribiendo) y después la reabre para mirar la ruta SIN tocar "Iniciar", el
    // headless deja de dispararse (Transistorsoft solo lo invoca con la app terminada) y no
    // hay ninguna suscripción `onLocation`: el SDK seguiría grabando nativo mientras NADA
    // copia puntos a `quivo-outbox.db`. Re-enganchamos la suscripción si el plugin ya está
    // `enabled`, sin re-emitir `inicio_recorrido` — el recorrido ya empezó y un segundo
    // marcador de inicio deformaría el recorrido reconstruido (QUI-247).
    //
    // B1: este camino YA NO espera a que termine la siembra antes de suscribirse — esa espera
    // era una ventana de fixes perdidos (mismo defecto que en `iniciar()`), porque el plugin
    // está emitiendo y nadie más copia esos puntos. La garantía de "ningún fix se procesa con
    // el Map vacío" la da ahora `onLocation`, que espera `semillaPromise` antes de escribir.
    let montado = true;
    void (async () => {
      try {
        const estado = await BackgroundGeolocation.getState();
        if (!montado || !estado.enabled) return;
        suscribirUbicaciones();
        setTracking(true);
      } catch {
        // Sin estado del plugin no hay nada que re-enganchar: "Iniciar" sigue disponible.
      }
    })();

    return () => {
      montado = false;
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [sesionId, suscribirUbicaciones, sembrarCumplimientos]);

  const iniciar = useCallback(async () => {
    setErrorGps(null);
    setResultado(null);
    bateria.current = [];
    puntosRef.current = 0;
    erroresEscritura.current = 0;
    setPuntos(0);
    setUltimaDeteccion(null);

    // ORDEN (B1, hallazgo de revisión — corrige el reordenamiento del plan §2.4.2 sin perder
    // lo que ese reordenamiento buscaba). Las dos propiedades que este bloque tiene que
    // sostener a la vez son:
    //
    //  (a) **El nativo arranca aunque el outbox falle** (plan §2.4.2): un fallo de SQLite (la
    //      regresión de `expo-sqlite@16.0.10`) no debe impedir `start()`, porque el SDK de
    //      Transistorsoft sigue grabando en su propia base nativa (`persist: true`, el mismo
    //      mecanismo que sostuvo el rescate de la Entrega 1) y eso es lo único recuperable.
    //  (b) **Ningún fix se pierde por llegar antes de la suscripción**: el plugin emite
    //      `onLocation` apenas arranca, y el headless task NO corre mientras la app está viva
    //      (Transistorsoft solo lo invoca con la app terminada). Cada fix de la ventana entre
    //      `start()` y `suscribirUbicaciones()` no lo copia NADIE al outbox: queda solo en la
    //      base nativa del plugin, que nada vuelve a leer.
    //
    // La versión anterior dejaba `start()` antes de la suscripción y metía en el medio un
    // `await` de la semilla (una lectura COMPLETA del outbox) más `abrirOutbox()` — cientos de
    // milisegundos, o segundos, de fixes perdidos. La solución es suscribir PRIMERO (es
    // sincrónico y no toca SQLite) y arrancar el nativo después: `onLocation` ya espera la
    // semilla por su cuenta (ver su comentario), así que un fix que llegue antes de que
    // termine la siembra queda retenido, no descartado ni mal contado.
    suscribirUbicaciones();

    try {
      await BackgroundGeolocation.ready(gpsSpikeConfig);
      await BackgroundGeolocation.start();
    } catch (error) {
      // Plan §2.4.4: mensaje distinto del de persistencia (bloque de abajo) — acá el módulo
      // NATIVO no pudo arrancar (permisos del SO, licencia del plugin, Play Services): no
      // hay nada grabándose todavía, a diferencia del catch siguiente. La suscripción que
      // acabamos de instalar no tiene nada que escuchar: se remueve.
      subscription.current?.remove();
      subscription.current = null;
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'iniciar-nativo' },
      });
      setErrorGps('No se pudo iniciar el módulo nativo de GPS. Revisa permisos y licencia del dispositivo.');
      return;
    }

    try {
      // C1 (hallazgo de revisión CRÍTICO): la siembra ya NO ocurre acá — corre en el
      // `useEffect` de montaje de arriba (keyed por `sesionId`), que es el ÚNICO lugar que
      // puede garantizar que corrió SIEMPRE, incluido el camino de re-enganche donde
      // `iniciar()` nunca se invoca (con `tracking === true` el botón pasa directo a
      // "Finalizar recorrido", ver `next-control-sheet.tsx`). Acá solo se espera esa MISMA
      // promesa — nunca se vuelve a sembrar por cuenta propia.
      await (semillaPromise.current ?? sembrarCumplimientos());
      const db = await abrirOutbox();
      // RNF-24/QUI-247: marca el límite real del recorrido — sin esto, reconstruir un
      // recorrido más adelante solo tenía los puntos GPS sueltos, sin saber dónde empezó.
      await encolarEvento(db, { deviceId, tipo: 'inicio_recorrido', payload: { sesionId } });
      // Plan §2.4.3: `tracking` recién se marca `true` ACÁ, después de que la suscripción
      // quedó conectada Y el marcador de inicio encoló con éxito.
      setTracking(true);
    } catch (error) {
      // Plan §2.4.4: el GPS nativo (bloque de arriba) ya está corriendo y grabando en su
      // propia base — este catch es SOLO el pipeline local app→outbox el que falló. No se
      // llama `BackgroundGeolocation.stop()` acá: cortar el tracking nativo por un fallo de
      // SQLite tiraría exactamente la evidencia que este orden existe para salvar (mismo
      // principio que el plan §2.4.1 aplica al 401 de sesión — la evidencia local es lo único
      // irrecuperable).
      //
      // B1: tampoco se REMUEVE la suscripción (antes sí se hacía). Lo único que falló acá es
      // el marcador `inicio_recorrido`; `onLocation` abre el outbox por su cuenta en cada fix
      // y se auto-sana vía `reabrirOutboxTrasFalloNativo` (`db/outbox.ts`). Removerla
      // convertía un fallo puntual de encolado en la pérdida de TODOS los puntos siguientes
      // hasta que el chofer volviera a apretar "Iniciar" — exactamente el daño que este
      // hallazgo describe. La UI queda en "Iniciar" (`tracking` sigue false) y ese reintento
      // es idempotente: `suscribirUbicaciones` remueve la suscripción anterior antes de
      // instalar la nueva, y el nativo ya arrancado no se reinicia.
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'iniciar-outbox' },
      });
      setErrorGps(
        'El GPS ya está grabando en el dispositivo, pero no se pudo abrir el almacenamiento local. Reintenta "Iniciar"; si persiste, revisa el espacio disponible.',
      );
    }
  }, [suscribirUbicaciones, sembrarCumplimientos, deviceId, sesionId]);

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

  /**
   * B3 (hallazgo de revisión, bajo): Map SEPARADO de `puntosControlDetectados` — antes de este
   * fix, `simularDeteccion` escribía en el MISMO Map que consulta la máquina de histéresis
   * real (`filtrarNuevosCumplimientos`), así que apretar el botón de debug bloqueaba la pasada
   * REAL de ese punto de control durante `PASADA_MIN_MS` (2 min). El comentario de la función
   * decía lo contrario ("no participa en ninguna evaluación de histéresis real"), que era
   * falso — corregido acá y, ya que salía barato, aislado de verdad: el simulador nunca más
   * toca el estado que usa el geofence real.
   */
  const puntosControlSimulados = useRef<Map<string, EstadoPuntoControl>>(new Map());

  const simularDeteccion = useCallback(
    (puntoControlId: string) => {
      // Botón de debug/QA (`operation-screen.tsx`, gateado por `__DEV__`): `radioToleranciaM`
      // es un valor de relleno razonable (no viene de un punto de control real acá) solo para
      // satisfacer el contrato de `DeteccionPuntoControl`. Escribe en `puntosControlSimulados`
      // (B3, arriba), no en `puntosControlDetectados` — este simulador no pasa por
      // `filtrarNuevosCumplimientos` y ya no comparte estado con lo que sí pasa por ahí.
      const clave = claveCumplimiento(sesionId, puntoControlId);
      const previo = puntosControlSimulados.current.get(clave);
      const pasada = (previo?.pasadas ?? 0) + 1;
      puntosControlSimulados.current.set(clave, {
        dentro: true,
        ultimoEmitidoMs: Date.now(),
        pasadas: pasada,
      });
      // B4 (hallazgo de revisión, bajo): incluye `pasada` — `gps-provider.tsx` la usa para
      // distinguir dos pasadas consecutivas del mismo punto al decidir el aviso por voz.
      const deteccion: DeteccionPuntoControl = {
        puntoControlId,
        distanciaM: 15,
        cumplido: true,
        radioToleranciaM: 30,
        pasada,
      };
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
