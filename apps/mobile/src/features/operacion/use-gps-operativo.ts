import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { asegurarPermisoNotificaciones } from './anuncio-punto-control';
import {
  AUTORIZACION_DENEGADA,
  AUTORIZACION_NO_DETERMINADA,
  AUTORIZACION_SIEMPRE,
  decidirPermisoGps,
  type AccionPermisoGps,
  type DecisionPermisoGps,
} from '../../gps/permiso-ubicacion';

/** `Platform.OS` reducido a las dos plataformas que `permiso-ubicacion.ts` distingue — ver el
 * comentario de cabecera de ese módulo para el porqué de la semántica de `status` distinta
 * por SO (en Android solo existe ALWAYS/DENIED; NotDetermined/Restricted/WhenInUse son de
 * iOS). Constante de módulo porque `Platform.OS` no cambia en runtime. */
const PLATAFORMA_GPS: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android';

/** Clave de `AsyncStorage` (mismo mecanismo no-sensible que usa `rescate-dia1.ts` para "esto
 * ya pasó una vez" — no es un dato de sesión, así que no va a SecureStore) que marca si esta
 * app YA invocó `BackgroundGeolocation.requestPermission()` alguna vez en este dispositivo.
 *
 * QUI-338 (hallazgo CRÍTICO de revisión): en Android, `getProviderState().status` no puede
 * distinguir "instalación nueva, nunca se preguntó" de "el conductor ya lo rechazó" — las dos
 * leen `DENIED` (ver `permiso-ubicacion.ts`). Sin esta flag, el chequeo pasivo que corre al
 * montar (`verificarPermisoGpsPasivo` más abajo) no tiene forma de distinguirlas y, si se
 * asume "denegado" por defecto, deja el botón "Iniciar recorrido" deshabilitado en una
 * instalación nueva sin que el conductor vea jamás el diálogo del sistema — la regresión que
 * motivó esta revisión. */
const CLAVE_PERMISO_GPS_SOLICITADO = 'quivo-gps:permiso-solicitado';

/**
 * QUI-338 (hallazgo ALTO #2 de revisión): `RNBackgroundGeolocationModule.java`
 * (`requestPermission`, ~línea 993) hace `response.reject("Permission request failed with
 * status: " + status)` cuando el conductor deniega el permiso o concede solo "mientras se usa
 * la app" — es decir, `await BackgroundGeolocation.requestPermission()` RECHAZA en el camino
 * normal de una denegación, no solo ante un fallo real del módulo nativo. Este parser
 * recupera el status numérico de ese mensaje para poder tratar la denegación como lo que es
 * (`permiso_denegado`, con su acción de ir a Ajustes), en vez de como `error_nativo` genérico
 * ("cerrá la app y volvé a abrirla", sin acción) — y para que el llamador sepa que NO hace
 * falta reportarlo a Sentry (es un flujo esperado, no un bug).
 *
 * Devuelve `null` si el mensaje no tiene el formato esperado (SDK de otra versión, error de
 * otro tipo) — en ese caso el llamador vuelve a leer el estado real con `getProviderState()`
 * en vez de asumir un número a ciegas.
 */
function parsearEstadoDeRechazoPermiso(error: unknown): number | null {
  const mensaje =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const coincidencia = /status:\s*(-?\d+)/i.exec(mensaje);
  if (!coincidencia) return null;
  const status = Number(coincidencia[1]);
  return Number.isFinite(status) ? status : null;
}

/** `location.coords.speed` del SDK viene en metros/segundo y es `-1` (o `undefined`) cuando el
 * fix no trae velocidad real (ver `Location.d.ts` del SDK) — nunca un valor negativo válido en
 * la práctica, así que cualquier negativo se trata igual que "no disponible" en vez de
 * mostrarse como un número sin sentido en la UI. */
function velocidadKmhDesde(speedMps: number | undefined): number | null {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < 0) return null;
  return speedMps * 3.6;
}

/** Estado inicial de `permisoGps`: no bloqueante, sin mensaje — se sobrescribe apenas corre
 * el primer chequeo pasivo (ver el `useEffect` de permisos más abajo), pero evita que el
 * botón arranque en un estado "bloqueado" fantasma antes de que ese chequeo resuelva.
 * `permisoYaSolicitado: false` de entrada es intencional (aunque el dispositivo ya hubiera
 * pedido el permiso en una sesión anterior): mantiene este default no-bloqueante en las dos
 * plataformas hasta que el chequeo real (que sí lee la flag persistida) resuelva. */
const PERMISO_GPS_INICIAL: DecisionPermisoGps = decidirPermisoGps({
  servicioUbicacionActivo: true,
  estadoPermiso: AUTORIZACION_NO_DETERMINADA,
  plataforma: PLATAFORMA_GPS,
  permisoYaSolicitado: false,
});

export function useGpsOperativo(
  sesionId: string,
  deviceId: string,
  puntosControl: PuntoControlPaquete[] = [],
) {
  const [tracking, setTracking] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultado, setResultado] = useState<string | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  // QUI-338: estado del flujo de permisos de ubicación, separado de `errorGps` a propósito —
  // `errorGps` es para fallos EN VIVO ya arrancado el tracking (escritura al outbox, stop
  // fallido); `permisoGps` es el gate PREVIO a arrancar, con su propio mensaje por caso y una
  // acción concreta (ver `permiso-ubicacion.ts`). Mezclarlos en un solo string le quitaba al
  // conductor la posibilidad de saber qué botón tocar.
  const [permisoGps, setPermisoGps] = useState<DecisionPermisoGps>(PERMISO_GPS_INICIAL);
  const [ultimaDeteccion, setUltimaDeteccion] = useState<DeteccionPuntoControl | null>(null);
  // ENTREGA 6/7 (plan post-piloto 2026-09-09): aviso de aproximación (`fase: 'aproximacion'`),
  // SEPARADO de `ultimaDeteccion` (que ahora solo lleva confirmaciones, `fase: 'confirmado'`) —
  // `gps-provider.tsx` los consume por separado: éste dispara SOLO la voz informativa,
  // `ultimaDeteccion` dispara vibración + notificación (+ el sonido custom foreground). Ver
  // `deteccionAproximacion` en `ResultadoConstruirEventos` (`gps/location-task.ts`).
  const [deteccionAproximacion, setDeteccionAproximacion] = useState<DeteccionPuntoControl | null>(
    null,
  );
  const [posicionActual, setPosicionActual] = useState<
    { lat: number; lng: number; speedKmh: number | null } | null
  >(null);
  const bateria = useRef<MuestraBateria[]>([]);
  const puntosRef = useRef(0);
  const erroresEscritura = useRef(0);
  const puntosControlDetectados = useRef<Map<string, EstadoPuntoControl>>(new Map());
  const subscription = useRef<{ remove: () => void } | null>(null);
  // QUI-338: si esta app YA invocó `requestPermission()` alguna vez en este dispositivo,
  // persistido en `AsyncStorage` bajo `CLAVE_PERMISO_GPS_SOLICITADO` (ver ese comentario para
  // el porqué). Vive en un ref, no en `useState`: se lee de forma síncrona dentro de
  // `verificarPermisoGpsPasivo`/`iniciar()`, y el valor persistido se carga UNA vez al montar
  // (efecto de abajo) — no hace falta re-render por sí solo, solo por el resultado del chequeo
  // de permiso que dispara después de cargarlo. Arranca en `false` (el default seguro: no
  // bloquear) hasta que la carga desde `AsyncStorage` resuelva.
  const permisoYaSolicitadoRef = useRef(false);
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
        speedKmh: velocidadKmhDesde(location.coords.speed),
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
        const { deteccion, deteccionAproximacion: nuevaAproximacion } = await registrarPuntoGps(
          db,
          location,
          { deviceId, sesionId, puntosControl },
          // B6 (hallazgo de revisión, bajo): se pasa el REF, no `.current` — la cola FIFO de
          // `registrarPuntoGps` difiere la ejecución, y `sembrarCumplimientos` puede reemplazar
          // el Map en el medio. Ver `ContenedorEstadosPuntosControl` (`gps/headless-task.ts`).
          puntosControlDetectados,
        );
        if (deteccion) setUltimaDeteccion(deteccion);
        // ENTREGA 6/7: se actualiza en CADA tick con puntos de control (incluso a `null` cuando
        // ninguno está en rango) — a diferencia de `ultimaDeteccion`, que solo cambia con una
        // confirmación real. Sin el `null` explícito, la última aproximación anunciada quedaría
        // "pegada" en el estado del hook después de que el vehículo se aleja.
        setDeteccionAproximacion(nuevaAproximacion);
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
          speedKmh: velocidadKmhDesde(location.coords.speed),
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

  /**
   * QUI-338: chequeo PASIVO (solo lectura, nunca pide permiso) del estado real de ubicación
   * — para que "Iniciar recorrido" refleje la realidad ANTES de que el conductor lo toque,
   * en vez de solo descubrirla al intentar arrancar. `getProviderState()` no dispara ningún
   * diálogo del sistema (a diferencia de `requestPermission()`, reservado para el chequeo
   * ACTIVO de `iniciar()` más abajo), así que es seguro correrlo sin que el conductor lo pida.
   */
  const verificarPermisoGpsPasivo = useCallback(async () => {
    try {
      const providerState = await BackgroundGeolocation.getProviderState();
      setPermisoGps(
        decidirPermisoGps({
          servicioUbicacionActivo: providerState.enabled,
          estadoPermiso: providerState.status,
          plataforma: PLATAFORMA_GPS,
          permisoYaSolicitado: permisoYaSolicitadoRef.current,
        }),
      );
    } catch {
      // Chequeo pasivo, no interactivo: si falla acá no hay nada confiable que mostrarle al
      // conductor todavía — el chequeo ACTIVO de `iniciar()` (que sí reporta a Sentry) es el
      // que manda cuando el conductor realmente toca "Iniciar recorrido".
    }
  }, []);

  useEffect(() => {
    let montado = true;
    // Carga `permisoYaSolicitadoRef` desde `AsyncStorage` ANTES del primer chequeo pasivo: es
    // la única forma de que, en Android, ese primer chequeo pueda distinguir "instalación
    // nueva" de "ya se pidió y se denegó" (ver el comentario del ref y el docblock de
    // `permiso-ubicacion.ts`). Si la lectura falla o todavía no resolvió, el ref se queda en su
    // default seguro (`false`, no bloquea) — nunca se asume `true` sin haberlo leído.
    void (async () => {
      try {
        const valor = await AsyncStorage.getItem(CLAVE_PERMISO_GPS_SOLICITADO);
        if (montado) permisoYaSolicitadoRef.current = valor === 'true';
      } catch {
        // Falla de lectura: se mantiene el default `false` (no bloquear) — un falso negativo
        // acá en el peor caso vuelve a pedir el permiso, nunca deja a un conductor bloqueado.
      } finally {
        if (montado) void verificarPermisoGpsPasivo();
      }
    })();
    // Repetir el chequeo cuando la app vuelve a primer plano: es el único momento en que el
    // conductor puede haber cambiado el permiso o prendido el GPS del sistema (fue a Ajustes
    // desde el propio flujo de esta pantalla, o desde la notificación de Android) sin que la
    // app se haya reiniciado — sin esto, el botón se quedaba mostrando el estado bloqueado
    // viejo hasta el próximo toque en "Iniciar recorrido".
    const subscripcionAppState = AppState.addEventListener('change', (estadoApp) => {
      if (estadoApp === 'active') void verificarPermisoGpsPasivo();
    });
    return () => {
      montado = false;
      subscripcionAppState.remove();
    };
  }, [verificarPermisoGpsPasivo]);

  /**
   * QUI-338: lleva al conductor a la pantalla del sistema que corresponde según `accion`
   * (`permiso-ubicacion.ts`). `DeviceSettings` del SDK (`node_modules/.../core/api/
   * DeviceSettings.d.ts`) solo cubre batería/power-manager — nada de permisos ni del
   * interruptor de ubicación — así que para `ajustes_ubicacion_sistema` se usa el intent
   * nativo de Android directo vía `Linking.sendIntent` (API estándar de React Native, sin
   * dependencias nuevas). Para `ajustes_app` (y como fallback si el intent fallara) se usa
   * `Linking.openSettings()`, que abre la pantalla de datos de la app — a un toque de
   * Permisos → Ubicación → "Permitir todo el tiempo".
   */
  const abrirAjustesPermisoGps = useCallback(async (accion: AccionPermisoGps | null) => {
    if (!accion) return;
    if (accion === 'ajustes_ubicacion_sistema' && Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
        return;
      } catch (error) {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'abrir-ajustes-ubicacion-sistema' },
        });
        // Sigue al fallback de `openSettings()` de abajo.
      }
    }
    await Linking.openSettings();
  }, []);

  const iniciar = useCallback(async () => {
    setErrorGps(null);
    setResultado(null);
    bateria.current = [];
    puntosRef.current = 0;
    erroresEscritura.current = 0;
    setPuntos(0);
    setUltimaDeteccion(null);

    // HALLAZGO DE CAMPO (Entrega 7, Sentry build 10, Galaxy A71 Android 13): pedir
    // `POST_NOTIFICATIONS` ACÁ, con la app en foreground y ANTES de tocar el SDK de
    // geolocalización — `asegurarPermisoNotificaciones` (`./anuncio-punto-control.ts`) nunca
    // rechaza (best-effort interno con su propio try/catch + Sentry), así que este `await` no
    // necesita su propio try/catch y NUNCA bloquea "Iniciar recorrido" si el chofer deniega o
    // el pedido falla: la vibración y la voz de aproximación no dependen de este permiso. Efecto
    // colateral deseado: al resolverse ANTES de `BackgroundGeolocation.ready()/start()` de más
    // abajo, si el chofer concede, la notificación NATIVA del foreground service del propio SDK
    // (`background-geolocation.config.ts`, también gateada por este mismo permiso de Android
    // 13+) queda visible desde el primer arranque, no solo la de confirmación de puntos.
    await asegurarPermisoNotificaciones();

    // QUI-338 — VERIFICACIÓN PREVIA (brief punto 1): consultar el estado real de permiso y
    // servicio de ubicación ANTES de intentar `ready()`/`start()`, y ramificar según el caso
    // en vez de intentar y fallar. Antes de este fix no había NINGÚN chequeo acá: se llamaba
    // directo a `ready()`/`start()` y se dejaba que el SDK pidiera el permiso como efecto
    // colateral — con targetSdk 34+ (Android 14+), arrancar un foreground service de tipo
    // `location` sin el permiso ya otorgado tira `SecurityException` nativo en vez de
    // simplemente no arrancar, y en versiones más viejas de Android (el caso reportado desde
    // la calle: Samsung Galaxy A71, Android 10-13) el conductor quedaba sin ningún mensaje
    // que le dijera qué tocar.
    let servicioUbicacionActivo = true;
    let estadoPermiso: number | null;
    try {
      const providerState = await BackgroundGeolocation.getProviderState();
      servicioUbicacionActivo = providerState.enabled;
      estadoPermiso = providerState.status;
      if (servicioUbicacionActivo && estadoPermiso !== AUTORIZACION_SIEMPRE) {
        // Marca "ya se pidió el permiso en este dispositivo" ANTES de invocar
        // `requestPermission()` (no cuando se conoce el resultado): lo que importa para
        // `decidirPermisoGps` es si YA se preguntó, no si la respuesta fue favorable. Se
        // persiste en `AsyncStorage` (best-effort — un fallo de escritura acá en el peor caso
        // vuelve a pedir el permiso la próxima vez, nunca bloquea) y nunca vuelve a `false`.
        if (!permisoYaSolicitadoRef.current) {
          permisoYaSolicitadoRef.current = true;
          void AsyncStorage.setItem(CLAVE_PERMISO_GPS_SOLICITADO, 'true').catch(() => {
            // Ver comentario de arriba: fallo silencioso, no bloqueante.
          });
        }
        // PEDIDO EXPLÍCITO (brief punto 2): antes esto quedaba 100% delegado al efecto
        // colateral de `ready()`/`start()` — acá se pide con `requestPermission()` (el único
        // método del `.d.ts` de 5.4.0 pensado para esto,
        // `node_modules/.../core/api/BackgroundGeolocation.d.ts:95`) y se espera la
        // respuesta antes de seguir.
        try {
          estadoPermiso = await BackgroundGeolocation.requestPermission();
        } catch (errorRechazo) {
          // QUI-338 (hallazgo ALTO #2 de revisión): `requestPermission()` RECHAZA cuando el
          // conductor deniega (o concede solo "mientras se usa la app") — no es un error real
          // del módulo nativo (ver docblock de `parsearEstadoDeRechazoPermiso`). Primero se
          // intenta recuperar el status real del propio mensaje de rechazo (funciona con el
          // formato actual del SDK, `RNBackgroundGeolocationModule.java:993`, sin volver a
          // cruzar el bridge nativo). Si el mensaje no tiene ese formato (otra versión del
          // SDK, u otro tipo de error), se recurre a releer `getProviderState()` — el estado
          // real ya debería reflejar lo que el conductor acaba de elegir — en vez de asumir un
          // número a ciegas. Solo si ESA relectura también falla se trata como error nativo
          // genuino y se reporta a Sentry: una denegación normal del conductor nunca llega ahí.
          const statusParseado = parsearEstadoDeRechazoPermiso(errorRechazo);
          if (statusParseado !== null) {
            estadoPermiso = statusParseado;
          } else {
            try {
              const estadoTrasRechazo = await BackgroundGeolocation.getProviderState();
              estadoPermiso = estadoTrasRechazo.status;
            } catch (errorRelectura) {
              estadoPermiso = null;
              Sentry.captureException(errorRelectura, {
                tags: { contexto: 'gps-foreground', paso: 'releer-tras-rechazo-permiso' },
              });
            }
          }
        }
        if (estadoPermiso === AUTORIZACION_NO_DETERMINADA) {
          // El conductor cerró el diálogo del sistema sin elegir ninguna opción. El valor
          // "no determinado" es ambiguo (es el mismo que "todavía no se preguntó"), así que
          // ante la duda se trata como denegado (fail closed) en vez de intentar arrancar
          // sin saber realmente si hay permiso.
          estadoPermiso = AUTORIZACION_DENEGADA;
        }
      }
    } catch (error) {
      estadoPermiso = null;
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'verificar-permiso' },
      });
    }
    const decisionPermiso = decidirPermisoGps({
      servicioUbicacionActivo,
      estadoPermiso,
      plataforma: PLATAFORMA_GPS,
      permisoYaSolicitado: permisoYaSolicitadoRef.current,
    });
    setPermisoGps(decisionPermiso);
    if (decisionPermiso.bloqueante) {
      // Ninguno de los cuatro casos bloqueantes llama a `ready()`/`start()`: la UI
      // (`operation-screen.tsx`) muestra `decisionPermiso.mensaje` con su acción, y
      // "Iniciar recorrido" queda sin efecto hasta que el conductor la resuelva.
      return;
    }

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
      // NATIVO no pudo arrancar pese a que el permiso/servicio ya estaban en orden (licencia
      // del plugin, Google Play Services): no hay nada grabándose todavía, a diferencia del
      // catch siguiente. La suscripción que acabamos de instalar no tiene nada que escuchar:
      // se remueve.
      subscription.current?.remove();
      subscription.current = null;
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'iniciar-nativo' },
      });
      // QUI-338 (hallazgo MEDIO de revisión): este es un fallo TRANSITORIO del módulo nativo
      // (licencia de Transistorsoft, Google Play Services) con el permiso/servicio YA en
      // orden — `decisionPermiso.bloqueante` es `false` para haber llegado hasta acá. Antes se
      // reusaba el canal `permisoGps` (`decidirPermisoGps` con `estadoPermiso: null` →
      // `error_nativo`, bloqueante), lo que dejaba `canStart` en `false` hasta que el listener
      // de `AppState 'active'` lo limpiara — obligando al conductor a mandar la app a segundo
      // plano y volver solo para poder reintentar. Se usa `errorGps` en su lugar: mismo canal
      // informativo que ya usa el resto del hook para fallos en vivo, que `operation-screen.tsx`
      // muestra sin gatear `canStart` — así "Iniciar recorrido" queda disponible para
      // reintentar de inmediato.
      setErrorGps(
        'No se pudo activar el GPS en este momento. Volvé a tocar "Iniciar recorrido" para reintentar.',
      );
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
    // Botón de debug/QA (`operation-screen.tsx`, gateado por `__DEV__`). `distanciaM` recibe
    // la distancia real ya calculada por Haversine en pantalla (`distanciaProximoPunto`) para
    // que la voz/sonido de la simulación anuncien la distancia de verdad al punto, no un
    // número inventado — antes esto era un `15` fijo sin relación con la posición real del
    // conductor, que confundía al probar (siempre decía "15 metros" sin importar qué tan lejos
    // se estuviera en realidad). Cae a `15` solo si todavía no hay ninguna distancia calculada
    // (por ejemplo, sin fix de GPS aún), para que el botón siga siendo utilizable.
    // `radioToleranciaM` es un valor de relleno razonable (no viene de un punto de control real
    // acá) solo para satisfacer el contrato de `DeteccionPuntoControl`. Escribe en
    // `puntosControlSimulados` (B3, arriba), no en `puntosControlDetectados` — este simulador
    // no pasa por `filtrarNuevosCumplimientos` y ya no comparte estado con lo que sí pasa por ahí.
    (puntoControlId: string, distanciaM: number | null = null) => {
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
        distanciaM: distanciaM !== null ? Math.round(distanciaM) : 15,
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
    // QUI-338: gate de permisos previo a "Iniciar recorrido" — `operation-screen.tsx` lo usa
    // para mostrar el mensaje/acción correctos y para que el botón refleje si realmente se
    // puede arrancar (ver `permisoGps.bloqueante`).
    permisoGps,
    abrirAjustesPermisoGps,
    ultimaDeteccion,
    deteccionAproximacion,
    posicionActual,
    iniciar,
    detener,
    simularDeteccion,
  };
}
