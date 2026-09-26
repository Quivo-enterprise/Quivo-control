import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import BackgroundGeolocation, { type Location } from 'react-native-background-geolocation';
import { resolverTsFix, type PuntoControlPaquete } from '@quivo/shared';
import {
  abrirOutbox,
  contarEventosPendientes,
  encolarEvento,
  generarEventId,
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
import { cerrarRecorridoEnOutbox } from './cierre-recorrido';
import { intentarDrenarOportunista } from './drenaje-oportunista';
import {
  asegurarInicioRecorrido,
  crearEstadoInicioRecorrido,
  reiniciarEstadoInicioRecorrido,
} from './inicio-recorrido-retry';
import { resolverResultadoIniciar } from './resultado-iniciar-recorrido';
import {
  AUTORIZACION_DENEGADA,
  AUTORIZACION_NO_DETERMINADA,
  AUTORIZACION_SIEMPRE,
  decidirPermisoGps,
  type AccionPermisoGps,
  type DecisionPermisoGps,
} from '../../gps/permiso-ubicacion';
import {
  debeSolicitarPermisoActividad,
  estadoPermisoActividadDesde,
  type EstadoPermisoActividad,
} from '../../gps/permiso-actividad';
import {
  crearCoordinadorIniciarDetener,
  crearManejadorForegroundActivo,
  crearManejadorReafirmarMovimiento,
  crearSerializadorRestauracion,
  detenerNativoConTimeout,
  iniciarSeguimientoContinuo,
  reafirmarMovimiento,
  reafirmarMovimientoSiEstacionario,
  restaurarComportamientoNormal,
} from '../../gps/seguimiento-continuo';

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
  // Entrega 2 (drenado oportunista del outbox en background): el mismo `obtenerAccessToken`
  // que ya usa `usePaqueteDia`/`useSyncStatus` (`use-auth-movil.ts`), enhebrado desde
  // `GpsProvider` — ver el call site en `onLocation` más abajo. Requerido (sin default): las
  // dos pantallas que montan `GpsProvider` ya tienen esta función disponible.
  obtenerAccessToken: () => Promise<string | null>,
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
  // QUI-P0: estado del permiso ACTIVITY_RECOGNITION, expuesto para el preflight de la Entrega
  // 26 (`gps/permiso-actividad.ts`) — esta entrega NO construye esa UI, solo deja el dato
  // disponible. Fail-open: a diferencia de `permisoGps`, este NUNCA gatea "Iniciar recorrido".
  const [estadoPermisoActividad, setEstadoPermisoActividad] =
    useState<EstadoPermisoActividad>('no_solicitado');
  const [ultimaDeteccion, setUltimaDeteccion] = useState<DeteccionPuntoControl | null>(null);
  const [posicionActual, setPosicionActual] = useState<
    { lat: number; lng: number; speedKmh: number | null } | null
  >(null);
  const bateria = useRef<MuestraBateria[]>([]);
  const puntosRef = useRef(0);
  const erroresEscritura = useRef(0);
  const puntosControlDetectados = useRef<Map<string, EstadoPuntoControl>>(new Map());
  const subscription = useRef<{ remove: () => void } | null>(null);
  // Entrega 2: segundo punto de enganche del drenado oportunista, vía `onHeartbeat`
  // (`heartbeatInterval: 60` en `background-geolocation.config.ts`, declarado ahí sin
  // suscriptor hasta este cambio). `onLocation` (arriba) solo dispara con el vehículo en
  // movimiento — `distanceFilter: 15` no emite nada con el motor apagado o el vehículo
  // detenido en un control largo. El heartbeat es el único evento que sigue llegando cada 60 s
  // pase lo que pase, así que sin él un layover prolongado podía dejar el outbox sin drenar
  // aunque la app siguiera viva en background (no headless, no terminada). Ref separada del
  // `subscription` de `onLocation` porque son dos suscripciones independientes al SDK, cada
  // una con su propio ciclo de vida de limpieza.
  const heartbeatSubscription = useRef<{ remove: () => void } | null>(null);
  // QUI-P0: tercera suscripción al SDK, defensa en profundidad contra volver a estacionario en
  // medio de un recorrido (ver `crearManejadorReafirmarMovimiento`, `gps/seguimiento-continuo.ts`).
  const motionChangeSubscription = useRef<{ remove: () => void } | null>(null);
  // QUI-P0: espejo en ref de `tracking` — los handlers de `onMotionChange`/`AppState` que se
  // suscriben UNA sola vez (`suscribirUbicaciones`, más abajo) necesitan leer "¿hay un
  // recorrido en curso AHORA?" en el momento en que el evento nativo dispara, no el valor de
  // `tracking` capturado en el closure de cuando se instaló la suscripción (que quedaría
  // siempre en `false`, el valor inicial). Se actualiza en los tres lugares donde cambia
  // `tracking` (reenganche, `iniciar()`, `detener()`).
  const trackingRef = useRef(false);
  const estaEnRecorrido = useCallback(() => trackingRef.current, []);
  // R1 (merge post-drenado, Entrega 31a — gap de revisión): `detener()` dispara
  // `restaurarComportamientoNormal` (setConfig disableStopDetection:false) SIN esperarlo, para
  // no demorar el cierre del recorrido. Si el chofer vuelve a tocar "Iniciar" antes de que ese
  // `setConfig` termine de aplicarse, esa llamada podía resolver DESPUÉS del
  // `setConfig(disableStopDetection:true)` del `iniciarSeguimientoContinuo` del nuevo
  // `iniciar()` — pisando, por orden de llegada al nativo y no por intención, la política
  // "true" del recorrido que sí está activo. `crearSerializadorRestauracion`
  // (`gps/seguimiento-continuo.ts`, pura y testeada aparte) es el slot que guarda esa promesa
  // en vuelo para que el PRÓXIMO `iniciar()` la espere antes de reafirmar movimiento — ver el
  // `esperarPendiente()` en `iniciar()` y el `registrar()` en `detener()`. Una sola instancia
  // por hook, mismo ciclo de vida que `trackingRef`.
  const serializadorRestauracion = useRef(crearSerializadorRestauracion()).current;
  // REDISEÑO iniciar()/detener() (bug en producción, 2026-09-25 — reemplaza el enfoque de
  // "detener() espera a iniciar() con un timeout acotado", que atacaba el caso equivocado: el
  // timeout evitaba que `detener()` quedara colgado ESPERANDO a `iniciar()`, pero `detener()`
  // seguía colgándose ÉL MISMO en su propio outbox antes de escribir `fin_recorrido`). Ahora
  // `serializadorIniciar` (`crearCoordinadorIniciarDetener`, `gps/seguimiento-continuo.ts`) da
  // tres cosas:
  // 1. Single-flight de `iniciar()` — `iniciar()` (más abajo) reusa la promesa en curso en vez
  //    de arrancar `ejecutarIniciar` en paralelo.
  // 2. Single-flight de `detener()` — mismo mecanismo, para `detener()`.
  // 3. `invalidarEnCurso()` — `detener()` la llama SIN esperar nada (sync) para que, si hay un
  //    `iniciar()` en curso colgado en su propio outbox, sepa al resolver que ya no debe tocar
  //    `tracking`/estado React. Con el single-flight garantizado, nunca hace falta distinguir
  //    "generación más nueva" — solo puede haber UN intento de `iniciar()` en vuelo a la vez.
  const serializadorIniciar = useRef(crearCoordinadorIniciarDetener()).current;
  // Flags de UI del rediseño — `operation-screen.tsx`/`next-control-sheet.tsx` los usan para
  // deshabilitar "Comenzar"/"Finalizar" mientras corren y para elegir el mensaje correcto.
  const [iniciando, setIniciando] = useState(false);
  // `true` mientras haya un `iniciar()` en curso que un `detener()` ya invalidó pero que sigue
  // sin resolver (colgado en su propio outbox) — distingue "Iniciando…" (intento fresco) de
  // "Guardando recorrido anterior…" (el single-flight de `iniciar()` sigue bloqueado por ESE
  // intento viejo hasta que por fin termine).
  const [guardandoRecorridoAnterior, setGuardandoRecorridoAnterior] = useState(false);
  const [deteniendo, setDeteniendo] = useState(false);
  // Punto 4 del rediseño: el cierre real del recorrido (outbox + veredicto) corre en una tarea
  // de fondo que `detener()` dispara sin esperar. `ultimoCierreId` guarda cuál es el cierre MÁS
  // RECIENTE — la tarea de fondo solo actualiza `resultado`/`errorGps` si sigue siendo la suya
  // (nadie empezó y terminó un recorrido nuevo mientras tanto) y si el hook sigue montado
  // (`montadoRef`).
  const ultimoCierreId = useRef(0);
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);
  // LOW-MED (hallazgo de revisión, QUI-247): estado mutable compartido del marcador
  // `inicio_recorrido` del intento de `iniciar()` en curso — `reiniciarEstadoInicioRecorrido`
  // le asigna un `eventId` ESTABLE al arrancar cada intento, y `asegurarInicioRecorrido`
  // (`inicio-recorrido-retry.ts`) lo usa desde CUATRO puntos (el intento inicial en
  // `iniciar()`, cada `onLocation`, cada heartbeat, y `detener()` como última red de
  // seguridad) para que un fallo de escritura nunca quede sin reintento — antes de este fix,
  // si esa escritura fallaba una vez, `tracking` se quedaba en `true` pero NADA volvía a
  // intentar escribir el marcador: un recorrido con `fin_recorrido` pero sin `inicio_recorrido`.
  // `eventId: null` (estado inicial) protege el camino de re-enganche (nunca llama `iniciar()`,
  // nunca debe emitir este marcador) — ver el docblock del módulo.
  const estadoInicioRecorrido = useRef(crearEstadoInicioRecorrido()).current;
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
        // (el drenado de abajo, fuera de este catch, corre igual aunque esta escritura falle
        // — ver el comentario junto a la llamada)
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
        // Entrega 4 (`docs/plan-correccion-post-piloto-2026-09-09.md`, `docs/estados-red-vs-captura.md`):
        // ESTO ES CAPTURA, no transporte — falló la escritura a SQLite (disco lleno, handle
        // zombi, etc.), no el envío por red, así que SÍ tiene que verse. El texto viejo
        // ("No se pudo guardar una ubicación en el outbox... la evidencia se perdió") era
        // jerga técnica sin acción concreta para un chofer manejando. Este es en lenguaje de
        // chofer y apunta a la causa más común y accionable (espacio en disco) — el
        // `Sentry.captureException` de arriba sigue mandando el detalle técnico completo
        // (código de error, conteo de la corrida) para diagnóstico.
        setErrorGps('El teléfono no pudo guardar tu recorrido. Revisá el espacio disponible.');
      }

      // LOW-MED (hallazgo de revisión, QUI-247): reintento oportunista del marcador
      // `inicio_recorrido` si el intento de `iniciar()` (o un reintento previo, heartbeat u
      // otro fix) todavía no logró escribirlo. `asegurarInicioRecorrido` es un no-op barato
      // (un solo `if`) en el camino normal ya confirmado, y también en el camino de
      // re-enganche (`eventId: null`, nunca debe emitir este marcador) — ver
      // `inicio-recorrido-retry.ts`. Try/catch propio, separado del de arriba, para no inflar
      // `erroresEscritura` (que mide fallos de PUNTOS GPS para el veredicto del spike) con
      // fallos de este marcador aparte.
      if (!estadoInicioRecorrido.confirmado) {
        try {
          await asegurarInicioRecorrido(
            estadoInicioRecorrido,
            { abrirOutbox, encolarEvento },
            { deviceId, sesionId },
          );
        } catch (error) {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-foreground', paso: 'reintentar-inicio-recorrido-onlocation' },
          });
        }
      }

      // Entrega 2 (drenado oportunista del outbox en background): mismo motor que
      // `headless-task.ts`, enganchado acá tras CADA fix de foreground — sin `await` a
      // propósito (a diferencia del headless, acá no hay ninguna promesa de tarea del SDK
      // esperando que esta función termine para "cerrar" nada; bloquear `onLocation` en el
      // POST de sync solo demoraría el próximo fix sin ganar nada). `intentarDrenarOportunista`
      // nunca rechaza (ver su docblock: todo su cuerpo vive bajo un try/catch defensivo), así
      // que este `void` no deja una unhandled rejection colgando.
      void intentarDrenarOportunista(obtenerAccessToken);
    },
    [deviceId, sesionId, puntosControl, obtenerAccessToken, estadoInicioRecorrido],
  );

  // `onLocation` cambia de identidad cuando cambian `puntosControl`/`sesionId`, pero la
  // suscripción al SDK se registra una sola vez: se lee siempre la última versión por ref
  // para que no quede capturada una closure vieja (p. ej. con la lista de puntos de control
  // todavía vacía, antes de que baje el paquete del día).
  const onLocationRef = useRef(onLocation);
  useEffect(() => {
    onLocationRef.current = onLocation;
  }, [onLocation]);

  // Mismo patrón de ref que `onLocationRef` arriba, para el handler de `onHeartbeat` que se
  // registra una sola vez más abajo: sin esto, el closure quedaría atado al
  // `obtenerAccessToken` vigente al momento de suscribirse (potencialmente stale si el
  // caller — `GpsProvider` — lo redefine entre renders).
  const obtenerAccessTokenRef = useRef(obtenerAccessToken);
  useEffect(() => {
    obtenerAccessTokenRef.current = obtenerAccessToken;
  }, [obtenerAccessToken]);

  // REDISEÑO 2026-09-25: con el single-flight de `iniciar()`/`detener()` garantizado por
  // `serializadorIniciar` (`crearCoordinadorIniciarDetener`), nunca hay dos `iniciar()` en vuelo
  // a la vez — así que ya no hace falta que esta función devuelva los handles que instaló para
  // que un llamador los limpie "solo los suyos" (el viejo mecanismo `limpiarSuscripcionesPropias`
  // existía justo para eso, y se eliminó con este rediseño). `subscription.current`/
  // `heartbeatSubscription.current`/`motionChangeSubscription.current` son, en todo momento, la
  // única fuente de verdad de qué suscripción está activa — tanto `ejecutarIniciar` como
  // `detener()` los tocan directamente.
  //
  // `removerSuscripciones`: extraída para que `ejecutarIniciar` (fallo de `start()` mientras
  // sigue vigente — nadie más va a limpiar esas suscripciones, ver su catch más abajo) y
  // `detener()` (cierre normal) usen exactamente la misma lógica de remoción, siempre sobre los
  // refs compartidos directamente. Idempotente — `remove()` sobre una suscripción ya removida,
  // o un ref ya en `null`, no hace nada.
  const removerSuscripciones = useCallback((): void => {
    subscription.current?.remove();
    subscription.current = null;
    heartbeatSubscription.current?.remove();
    heartbeatSubscription.current = null;
    motionChangeSubscription.current?.remove();
    motionChangeSubscription.current = null;
  }, []);

  const suscribirUbicaciones = useCallback(() => {
    subscription.current?.remove();
    const subscripcionUbicacion = BackgroundGeolocation.onLocation(
      (location) => {
        void onLocationRef.current(location);
      },
      (error) => {
        setErrorGps(`No se pudo registrar una ubicación (código ${String(error)}).`);
      },
    );
    subscription.current = subscripcionUbicacion;

    // Entrega 2: segundo enganche del drenado oportunista — ver el comentario de
    // `heartbeatSubscription` arriba para el porqué. `getCurrentPosition({samples:1,
    // persist:true})` fuerza un fix fresco (el evento de heartbeat solo trae la ÚLTIMA
    // posición conocida, no una nueva — así lo documenta el SDK) y lo persiste igual que
    // cualquier otro punto, ANTES de intentar drenar: si el vehículo lleva rato detenido sin
    // emitir por `onLocation`, este es el único mecanismo que sigue dejando evidencia GPS
    // cada 60 s durante ese layover. Ambos pasos (fix + drenado) van bajo el mismo try/catch
    // defensivo que el resto del hook: un fallo acá es de transporte/instrumentación, nunca
    // debe llegarle al chofer (principio rector del plan).
    heartbeatSubscription.current?.remove();
    const subscripcionHeartbeat = BackgroundGeolocation.onHeartbeat(() => {
      void (async () => {
        try {
          await BackgroundGeolocation.getCurrentPosition({ samples: 1, persist: true });
        } catch (error) {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-foreground', paso: 'heartbeat-getCurrentPosition' },
          });
        }
        // G1 (merge post-drenado, Entrega 31a): el heartbeat es, junto con el regreso a
        // foreground (`crearManejadorForegroundActivo`), uno de los dos puntos que NO dependen
        // de `onMotionChange`/`ACTIVITY_RECOGNITION` para notar que el plugin volvió a
        // estacionario — ver el docblock de `reafirmarMovimientoSiEstacionario`
        // (`gps/seguimiento-continuo.ts`). Corre cada 60 s pase lo que pase, con o sin ese
        // permiso concedido.
        try {
          await reafirmarMovimientoSiEstacionario(BackgroundGeolocation, estaEnRecorrido);
        } catch (error) {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-foreground', paso: 'heartbeat-reafirmar-movimiento' },
          });
        }
        // LOW-MED (hallazgo de revisión, QUI-247): mismo reintento oportunista que
        // `onLocation` (ver ese comentario) — el heartbeat es el ÚNICO evento que sigue
        // llegando cada 60 s con o sin movimiento, así que sin este segundo enganche un
        // layover prolongado justo después de un `iniciar()` que falló al escribir
        // `inicio_recorrido` podía dejar el marcador sin ningún reintento hasta el próximo fix
        // de `onLocation` (que puede tardar de más con el vehículo detenido).
        if (!estadoInicioRecorrido.confirmado) {
          try {
            await asegurarInicioRecorrido(
              estadoInicioRecorrido,
              { abrirOutbox, encolarEvento },
              { deviceId, sesionId },
            );
          } catch (error) {
            Sentry.captureException(error, {
              tags: { contexto: 'gps-foreground', paso: 'heartbeat-reintentar-inicio-recorrido' },
            });
          }
        }
        // `intentarDrenarOportunista` nunca rechaza (ver su docblock) — no hace falta un
        // catch propio acá.
        await intentarDrenarOportunista(obtenerAccessTokenRef.current);
      })();
    });
    heartbeatSubscription.current = subscripcionHeartbeat;

    // QUI-P0: defensa EN PROFUNDIDAD contra volver a estacionario en medio de un recorrido —
    // el mecanismo PRIMARIO es `disableStopDetection: true` (default estático en
    // `gpsSpikeConfig.activity` + reafirmado en runtime por `reafirmarMovimiento`), este
    // handler es el respaldo si algún fabricante (el reporte de campo es de un Samsung Galaxy
    // A71, conocido por gestión de batería agresiva) empuja el plugin a estacionario pese a la
    // config. `estaEnRecorrido` lee `trackingRef` (no `tracking` del closure) para no quedar
    // atado al valor de cuando se instaló esta suscripción. Ver
    // `crearManejadorReafirmarMovimiento` (`gps/seguimiento-continuo.ts`) para el detalle.
    motionChangeSubscription.current?.remove();
    const subscripcionMotionChange = BackgroundGeolocation.onMotionChange(
      crearManejadorReafirmarMovimiento(BackgroundGeolocation, estaEnRecorrido),
    );
    motionChangeSubscription.current = subscripcionMotionChange;
    // `deviceId`/`sesionId` en las deps: el handler de `onHeartbeat` de arriba los usa
    // directamente (reintento de `inicio_recorrido`, QUI-247) — sin esto, un cambio de
    // `sesionId` entre renders dejaría el heartbeat cerrado sobre una sesión vieja.
  }, [estaEnRecorrido, deviceId, sesionId, estadoInicioRecorrido]);

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
        // LOW, verificado contra la doc oficial del SDK instalado (`react-native-background-
        // geolocation@5.4.0`, hallazgo de revisión): "You must call `.ready(config)` once and
        // only once, each time your app is launched" — y el patrón canónico de la propia doc
        // (`ready(config).then(state => { if (!state.enabled) start(); })`) llama `ready()`
        // SIEMPRE, incluso cuando espera que el plugin ya esté `enabled`; el chequeo de
        // `state.enabled` es solo para decidir si hace falta `start()`, nunca para saltear
        // `ready()`. Antes de este fix, este camino de re-enganche (el chofer mata la app a
        // mitad de turno y la reabre con el plugin ya corriendo) llamaba `changePace`/
        // `setConfig` (`reafirmarMovimiento`, abajo) sin haber llamado `ready()` en ESTE
        // lanzamiento del proceso — `ready()` solo corre dentro de `iniciar()`, que este camino
        // nunca ejecuta. `ready()` es seguro de llamar acá aunque el plugin ya esté `enabled`:
        // no lo reinicia ni lo detiene (mismo `gpsSpikeConfig` que usa `iniciar()`, para que la
        // config reafirmada sea la misma en los dos caminos de entrada).
        await BackgroundGeolocation.ready(gpsSpikeConfig);
        if (!montado) return;
        suscribirUbicaciones();
        setTracking(true);
        trackingRef.current = true;
        // QUI-P0: SEGUNDO punto de entrada de `reafirmarMovimiento` (ver su docblock,
        // `gps/seguimiento-continuo.ts`) — este camino de re-enganche NUNCA pasa por
        // `iniciar()` (el plugin ya está `enabled`, el botón va directo a "Finalizar
        // recorrido"), así que sin esta llamada el freeze del CTO ("mato la app para que se
        // actualice, la reabro, la flecha sigue sin moverse") reaparecería exactamente acá.
        // No se llama `iniciarSeguimientoContinuo` (que además hace `start()`): el plugin YA
        // está arrancado, volver a `start()` sería redundante e innecesario. Best-effort — un
        // fallo acá no debe impedir que el re-enganche deje la app usable.
        void reafirmarMovimiento(BackgroundGeolocation).catch((error) => {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-foreground', paso: 'reenganche-reafirmar-movimiento' },
          });
        });
      } catch {
        // Sin estado del plugin no hay nada que re-enganchar: "Iniciar" sigue disponible.
      }
    })();

    return () => {
      montado = false;
      subscription.current?.remove();
      subscription.current = null;
      heartbeatSubscription.current?.remove();
      heartbeatSubscription.current = null;
      motionChangeSubscription.current?.remove();
      motionChangeSubscription.current = null;
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
    // QUI-P0 (brief punto 4): con un recorrido en curso, volver a primer plano no debe dejar
    // el marcador con un fix viejo hasta el próximo evento natural del SDK — pide una posición
    // fresca de inmediato. `crearManejadorForegroundActivo` ya filtra por `estadoApp ===
    // 'active' && estaEnRecorrido()` internamente (ver `gps/seguimiento-continuo.ts`), así que
    // es seguro invocarlo en CADA cambio de `AppState`, no solo cuando hay recorrido.
    const manejadorForegroundActivo = crearManejadorForegroundActivo(
      BackgroundGeolocation,
      estaEnRecorrido,
    );
    // Repetir el chequeo cuando la app vuelve a primer plano: es el único momento en que el
    // conductor puede haber cambiado el permiso o prendido el GPS del sistema (fue a Ajustes
    // desde el propio flujo de esta pantalla, o desde la notificación de Android) sin que la
    // app se haya reiniciado — sin esto, el botón se quedaba mostrando el estado bloqueado
    // viejo hasta el próximo toque en "Iniciar recorrido".
    const subscripcionAppState = AppState.addEventListener('change', (estadoApp) => {
      if (estadoApp === 'active') void verificarPermisoGpsPasivo();
      manejadorForegroundActivo(estadoApp);
    });
    return () => {
      montado = false;
      subscripcionAppState.remove();
    };
  }, [verificarPermisoGpsPasivo, estaEnRecorrido]);

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

  // MEDIO (hallazgo de revisión, QUI-247): `ejecutarIniciar` es el cuerpo REAL de "Iniciar
  // recorrido". `iniciar()` (más abajo) es apenas un wrapper single-flight que registra la
  // promesa de ESTA función en `serializadorIniciar` ANTES de que nada más pueda correr — así
  // una segunda llamada mientras hay una en curso reusa la MISMA promesa en vez de arrancar un
  // intento en paralelo.
  //
  // REDISEÑO (2026-09-25): recibe `generacion` (asignada por `iniciar()`, vía
  // `serializadorIniciar.nuevaGeneracion()`) para poder chequear `sigueVigente()` DESPUÉS de
  // cada `await` — incluidos permisos, `generarEventId`, `ready`, `start` y outbox — antes de
  // cualquier paso con efecto. Con `detener()` invalidando el intento en curso de inmediato (sin
  // esperar nada, ver `ejecutarDetener` más abajo) en vez de esperarlo con un timeout, este
  // chequeo es lo único que evita que un `iniciar()` colgado en su propio outbox reactive
  // `tracking`/estado React después de que el chofer ya vio "Finalizar" completarse.
  const ejecutarIniciar = useCallback(async (generacion: number) => {
    const sigueVigente = (): boolean => serializadorIniciar.estaVigente(generacion);
    // Intento invalidado que YA arrancó el nativo (`start()`/`iniciarSeguimientoContinuo` ya
    // resolvió): apaga lo que él mismo prendió y restaura la config — seguro llamarlo sin
    // condiciones extra porque el single-flight de `serializadorIniciar` garantiza que nunca hay
    // un `iniciar()` MÁS NUEVO corriendo al mismo tiempo (sería redundante con la limpieza que
    // ya hizo `detener()` al invalidar, pero `remove()`/`setConfig` son idempotentes — inocuo).
    const detenerNativoYRestaurar = async (): Promise<void> => {
      await BackgroundGeolocation.stop().catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'iniciar-invalidado-stop' },
        });
      });
      await restaurarComportamientoNormal(BackgroundGeolocation).catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'iniciar-invalidado-restaurar' },
        });
      });
    };

    setErrorGps(null);
    setResultado(null);
    bateria.current = [];
    puntosRef.current = 0;
    erroresEscritura.current = 0;
    setPuntos(0);
    setUltimaDeteccion(null);

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

    // QUI-P0: permiso ACTIVITY_RECOGNITION, fail-open — se pide ACÁ (foreground, justo antes
    // de arrancar el tracking) para maximizar la chance de que esté concedido cuando el SDK
    // evalúe el paso a movimiento, pero NUNCA bloquea "Iniciar recorrido": a diferencia de
    // `permisoGps` de arriba, un resultado denegado (o un error al pedirlo) no cambia nada de
    // lo que sigue — `changePace(true)` + `disableStopDetection: true`
    // (`gps/seguimiento-continuo.ts`) no dependen de este permiso, solo lo hacen más
    // responsivo cuando está concedido. Solo Android 10+ (`debeSolicitarPermisoActividad`,
    // `gps/permiso-actividad.ts`); `Platform.Version` es `number` en Android y `string` en
    // iOS — el `0` de fallback nunca se evalúa de verdad porque la función ya cortocircuita
    // en `plataforma !== 'android'` antes de mirar `sdkInt`.
    if (
      debeSolicitarPermisoActividad(
        PLATAFORMA_GPS,
        typeof Platform.Version === 'number' ? Platform.Version : 0,
      )
    ) {
      try {
        const resultadoActividad = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
        );
        setEstadoPermisoActividad(estadoPermisoActividadDesde(resultadoActividad));
      } catch (error) {
        // Fail-open real: hasta un fallo del propio pedido (no una denegación del conductor,
        // sino un error del módulo) tampoco bloquea nada — se reporta para diagnóstico y el
        // flujo de abajo sigue exactamente igual.
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'pedir-permiso-actividad' },
        });
      }
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
    //
    // LOW-MED (hallazgo de revisión, QUI-247): arranca ACÁ un `eventId` estable NUEVO para el
    // marcador `inicio_recorrido` de ESTE intento — antes de `suscribirUbicaciones()`, para que
    // esté listo antes de que pueda llegar el primer fix (`onLocation` ya reintenta este
    // marcador si hace falta, ver ese comentario). `reiniciarEstadoInicioRecorrido` resetea
    // `confirmado` incluso si el intento anterior nunca llegó a escribirlo — un recorrido nuevo
    // (segundo/tercer `iniciar()` en la misma sesión) nunca debe reusar el `eventId` de uno
    // viejo. Ver `inicio-recorrido-retry.ts` para el porqué de la idempotencia por `eventId`
    // estable.
    // REDISEÑO (2026-09-25): si un `detener()` ya invalidó este intento (`invalidarEnCurso()`,
    // sync, sin timeout) mientras corrían los chequeos de permiso de arriba, no tiene sentido
    // arrancar el SDK ni suscribirse para un recorrido que el chofer ya dio por cerrado. Con el
    // single-flight de `serializadorIniciar` garantizado, nunca hay un `iniciar()` más nuevo que
    // pudiera estar reemplazando a este — la única razón de invalidez posible acá es un
    // `detener()`.
    if (!sigueVigente()) return;

    // H2 (hallazgo de revisión, 2026-09-25): `ts` capturado ACÁ — antes de cualquier operación
    // que pueda colgarse (`abrirOutbox()` más abajo, o el nativo) — es el instante REAL en que
    // este intento arrancó. `asegurarInicioRecorrido` (llamado más abajo, y en cada reintento:
    // `onLocation`, heartbeat, `detener()`, y ahora también `cerrarRecorridoEnOutbox` en segundo
    // plano) lo usa como `ts` explícito del evento `inicio_recorrido`, en vez de dejar que
    // `encolarEvento` le asigne la hora de cuando el `INSERT` finalmente se ejecuta contra
    // SQLite.
    const tsInicio = new Date().toISOString();
    const eventIdInicio = await generarEventId();
    // Punto 5 del rediseño: chequeo DESPUÉS de `generarEventId()` — si `detener()` invalidó este
    // intento mientras esa promesa estaba en vuelo, no se toca `estadoInicioRecorrido` (el
    // respaldo de `cerrarRecorridoEnOutbox`, con el `eventId`/`ts` del intento ORIGINAL que
    // `detener()` capturó, es quien se ocupa de esto ahora — ver `cierre-recorrido.ts`).
    if (!sigueVigente()) return;
    reiniciarEstadoInicioRecorrido(estadoInicioRecorrido, eventIdInicio, tsInicio);
    suscribirUbicaciones();

    try {
      await BackgroundGeolocation.ready(gpsSpikeConfig);
      // R1 (merge post-drenado, Entrega 31a — gap de revisión): si un `detener()` reciente
      // dejó una restauración de `disableStopDetection` en vuelo (ver
      // `serializadorRestauracion`, más arriba, y el `registrar()` en `detener()`), esperarla
      // ACÁ — antes de reafirmar movimiento del recorrido nuevo — para que el
      // `setConfig(false)` de la restauración quede SIEMPRE ordenado antes del
      // `setConfig(true)` de `iniciarSeguimientoContinuo` de abajo, nunca después. Sin este
      // `await`, un "Finalizar" + "Iniciar" rápido corría ambos `setConfig` en carrera, con el
      // nativo quedando en el estado de quien resolviera último en vez del que corresponde al
      // recorrido activo.
      await serializadorRestauracion.esperarPendiente();
      // QUI-P0: reemplaza el `BackgroundGeolocation.start()` suelto de antes de este fix.
      // `iniciarSeguimientoContinuo` (`gps/seguimiento-continuo.ts`) hace `start()` y INMEDIATAMENTE
      // después fuerza `changePace(true)` + `disableStopDetection: true` — sin guarda de "solo
      // la primera vez", así que corre igual en un segundo/tercer recorrido tras
      // `finalizar()` + `iniciar()` (el reporte de campo del CTO: "vuelvo a iniciar y hace lo
      // mismo que la primera vez"). Antes de este fix, el SDK arrancaba en modo ESTACIONARIO y
      // nada lo sacaba de ahí — dependía por completo del permiso `ACTIVITY_RECOGNITION` (ver
      // arriba) y, sin él, caía a la geocerca estacionaria de 200-500 m: la causa raíz de que
      // la flecha no se moviera.
      await iniciarSeguimientoContinuo(BackgroundGeolocation);
      // REDISEÑO (2026-09-25): este es el chequeo que de verdad importa — si lo que colgó era
      // justo el `ready()`/`start()` de arriba, `detener()` ya pudo haber invalidado este intento
      // (sync, sin esperar nada) y haber cerrado el recorrido SIN él (nativo detenido,
      // suscripciones removidas, `fin_recorrido` en camino vía `cerrarRecorridoEnOutbox`) antes
      // de que esta línea se alcanzara. Dejar que la resolución tardía marque `tracking=true` acá
      // resucitaría un recorrido que el chofer ya vio cerrarse. Con el single-flight de
      // `serializadorIniciar` garantizado, nunca hay un `iniciar()` MÁS NUEVO corriendo al mismo
      // tiempo — así que `stop()` + restaurar siempre es seguro y nunca redundante-con-otro-
      // intento-activo (a diferencia del diseño anterior, que necesitaba `hayIntentoMasNuevo`
      // para no pisar a un intento más nuevo).
      if (!sigueVigente()) {
        await detenerNativoYRestaurar();
        return;
      }
      // G2 (merge post-drenado, Entrega 31a — gap de revisión): `tracking` se marca `true`
      // ACÁ, apenas `start()` resuelve, y ya NO más abajo tras el outbox. Antes, con el outbox
      // fallando (SQLite sin espacio, handle zombi) DESPUÉS de un `start()` exitoso,
      // `tracking` se quedaba en `false` para siempre — el SDK nativo seguía grabando de
      // verdad (bloque de arriba: un fallo de outbox nunca lo detiene, ver el catch de abajo)
      // pero la UI (`next-control-sheet.tsx`) solo ofrece "COMENZAR RUTA" cuando `tracking` es
      // `false`, nunca "FINALIZAR RUTA" — el chofer quedaba sin forma de cerrar un recorrido
      // que sí estaba grabando. El estado del ALMACENAMIENTO local es una señal aparte
      // (`errorGps`, ver el catch de abajo): un fallo ahí ya no apaga ni bloquea `tracking`. La
      // decisión de qué vale `tracking`/`errorGps` ante un fallo (nativo o de outbox) vive en
      // `resolverResultadoIniciar` (`resultado-iniciar-recorrido.ts`) — pura y testeada aparte,
      // ver su docblock para el porqué de la invariante ("nativo OK ⇒ tracking SIEMPRE true").
      setTracking(true);
      trackingRef.current = true;
    } catch (error) {
      // RIESGO 1 (`/codex-debug verify-fix`, corregido en `iniciarSeguimientoContinuo` —
      // `gps/seguimiento-continuo.ts`): este catch YA NO puede dispararse por un fallo de
      // `changePace`/`setConfig` posterior a un `start()` exitoso — esa función absorbe esos
      // rechazos internamente (los reporta a Sentry con su propio tag y los deja para el
      // próximo `onMotionChange`) precisamente para que este bloque, que remueve suscripciones
      // y marca `tracking=false`, quede reservado a lo único que de verdad significa "no hay
      // nada grabándose": que `start()` mismo haya fallado. Si algún día se llega acá con el
      // SDK nativo ya `enabled`, es un bug de `iniciarSeguimientoContinuo`, no de este catch.
      //
      // Plan §2.4.4: mensaje distinto del de persistencia (bloque de abajo) — acá el módulo
      // NATIVO no pudo arrancar pese a que el permiso/servicio ya estaban en orden (licencia
      // del plugin, Google Play Services): no hay nada grabándose todavía, a diferencia del
      // catch siguiente.
      //
      // REDISEÑO (2026-09-25): si este intento sigue vigente, nadie más va a limpiar las
      // suscripciones que instaló (`suscribirUbicaciones()`, arriba) — no hay ningún `detener()`
      // de por medio, el chofer sigue viendo "Iniciar recorrido" — así que `ejecutarIniciar`
      // mismo las remueve acá (`removerSuscripciones`). Si en cambio YA NO es vigente, un
      // `detener()` invalidó este intento y es SU cierre (`removerSuscripciones` en `detener()`,
      // más abajo) el que se ocupa de los refs compartidos — tocarlos acá sería redundante en el
      // mejor caso (si `detener()` ya corrió) o, en la ventana entre `invalidarEnCurso()` y que
      // `detener()` termine su propio `stop()` acotado, inofensivo igual (misma remoción
      // idempotente) — de cualquier forma, nunca hace falta que este intento la dispare dos veces.
      if (!sigueVigente()) {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'iniciar-nativo-no-vigente' },
        });
        return;
      }
      removerSuscripciones();
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
      //
      // G2: acá SÍ corresponde `tracking: false` — a diferencia del catch de outbox de abajo,
      // este es el único caso donde de verdad no hay nada grabándose (`resolverResultadoIniciar`,
      // `resultado-iniciar-recorrido.ts`).
      const resultadoFalloNativo = resolverResultadoIniciar(false, false);
      setTracking(resultadoFalloNativo.tracking);
      trackingRef.current = resultadoFalloNativo.tracking;
      setErrorGps(resultadoFalloNativo.errorGps);
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
      // RNF-24/QUI-247: marca el límite real del recorrido — sin esto, reconstruir un
      // recorrido más adelante solo tenía los puntos GPS sueltos, sin saber dónde empezó.
      // LOW-MED (hallazgo de revisión): la escritura en sí vive en `asegurarInicioRecorrido`
      // (`inicio-recorrido-retry.ts`), con el `eventId` estable armado arriba — si ESTE intento
      // falla, `onLocation`/heartbeat siguen reintentando con el MISMO `eventId` hasta que
      // quede confirmado (o hasta `detener()`, como última red de seguridad).
      //
      // Punto 5 del rediseño (2026-09-25): chequeo DESPUÉS de esperar la semilla — si
      // `detener()` invalidó este intento mientras tanto, no se toca `estadoInicioRecorrido`
      // acá. `cerrarRecorridoEnOutbox` (el cierre de `detener()`, `cierre-recorrido.ts`) ya se
      // encarga del mismo respaldo con el `eventId`/`ts` de ESTE intento, así que no se pierde:
      // solo se evita escribirlo dos veces en paralelo (una desde acá, otra desde el cierre).
      if (!sigueVigente()) return;
      await asegurarInicioRecorrido(
        estadoInicioRecorrido,
        { abrirOutbox, encolarEvento },
        { deviceId, sesionId },
      );
    } catch (error) {
      // Plan §2.4.4 + G2 (merge post-drenado, Entrega 31a): el GPS nativo (bloque de arriba)
      // ya está corriendo y grabando en su propia base, y `tracking` ya quedó en `true` ahí —
      // este catch es SOLO el pipeline local app→outbox el que falló, y a propósito YA NO lo
      // revierte. No se llama `BackgroundGeolocation.stop()` acá: cortar el tracking nativo
      // por un fallo de SQLite tiraría exactamente la evidencia que este orden existe para
      // salvar (mismo principio que el plan §2.4.1 aplica al 401 de sesión — la evidencia
      // local es lo único irrecuperable). El estado de almacenamiento se comunica aparte, por
      // `errorGps` — nunca pisando `tracking` — para que "Finalizar recorrido" siga
      // disponible en `next-control-sheet.tsx` pase lo que pase con el outbox.
      //
      // B1: tampoco se REMUEVE la suscripción (antes sí se hacía). Lo único que falló acá es
      // el marcador `inicio_recorrido`; `onLocation` abre el outbox por su cuenta en cada fix
      // y se auto-sana vía `reabrirOutboxTrasFalloNativo` (`db/outbox.ts`). Removerla
      // convertía un fallo puntual de encolado en la pérdida de TODOS los puntos siguientes
      // hasta que el chofer volviera a apretar "Iniciar" — exactamente el daño que este
      // hallazgo describe. `suscribirUbicaciones` remueve la suscripción anterior antes de
      // instalar la nueva, y el nativo ya arrancado no se reinicia.
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'iniciar-outbox' },
      });
      // G2: `tracking` NO se toca acá — `resolverResultadoIniciar(true, false).tracking` es
      // siempre `true` (ver su docblock e invariante testeada), coherente con lo que ya se
      // asignó arriba tras el `start()` exitoso. Solo se usa el mensaje de error.
      //
      // H2 (hallazgo de revisión, 2026-09-25): salvo que este intento ya no sea vigente — ahí
      // `setErrorGps` NO se llama. Un intento invalidado por `detener()` no debe pisarle al
      // chofer un mensaje de error sobre un recorrido que ya vio cerrarse.
      if (sigueVigente()) {
        setErrorGps(resolverResultadoIniciar(true, false).errorGps);
      }
    }
  }, [
    suscribirUbicaciones,
    removerSuscripciones,
    sembrarCumplimientos,
    deviceId,
    sesionId,
    serializadorRestauracion,
    serializadorIniciar,
    estadoInicioRecorrido,
  ]);

  // REDISEÑO (2026-09-25): wrapper público de "Iniciar recorrido" — single-flight (punto 1). Si
  // ya hay un `iniciar()` en curso (`promesaIniciarEnCurso()`), esta llamada reusa la MISMA
  // promesa en vez de arrancar un intento en paralelo — chequeo y registro son SÍNCRONOS (sin
  // ningún `await` de por medio), así que dos toques casi simultáneos de "Comenzar" nunca ven
  // los dos `promesaIniciarEnCurso() === null` a la vez. `iniciando`/`guardandoRecorridoAnterior`
  // son lo que `operation-screen.tsx` usa para deshabilitar el botón y elegir el mensaje: si el
  // intento reusado ya fue invalidado por un `detener()` (`iniciarEnCursoInvalidado()`) pero
  // sigue en vuelo — colgado en SU propio outbox — se muestra "Guardando recorrido anterior…" en
  // vez de "Iniciando…".
  const iniciar = useCallback(async () => {
    let promesa = serializadorIniciar.promesaIniciarEnCurso();
    const reusada = promesa !== null;
    if (!promesa) {
      const generacion = serializadorIniciar.nuevaGeneracion();
      promesa = ejecutarIniciar(generacion);
      serializadorIniciar.registrarPromesaIniciar(promesa, generacion);
    }
    setIniciando(true);
    setGuardandoRecorridoAnterior(reusada && serializadorIniciar.iniciarEnCursoInvalidado());
    try {
      await promesa;
    } finally {
      setIniciando(false);
      setGuardandoRecorridoAnterior(false);
    }
  }, [ejecutarIniciar, serializadorIniciar]);

  // REDISEÑO (2026-09-25): `ejecutarDetener` es el cuerpo REAL de "Finalizar recorrido" — SOLO
  // el camino crítico que el chofer necesita ver completarse antes de que el botón vuelva a
  // responder: invalidar el `iniciar()` en curso (sync, punto 3), parar el nativo con un
  // timeout acotado (`detenerNativoConTimeout`, `gps/seguimiento-continuo.ts`), limpiar
  // suscripciones y marcar `tracking=false`. El cierre real del recorrido en el outbox
  // (respaldo de `inicio_recorrido` + `fin_recorrido` + cálculo del veredicto, punto 4) corre
  // DESPUÉS, en una tarea de fondo que esta función dispara con `void` — nunca bloquea el
  // camino crítico ni demora la vuelta de la UI a "detenido".
  //
  // Premisa que motiva este rediseño: "Finalizar" solo se muestra con `tracking=true`, que se
  // marca apenas `start()` resuelve — ANTES del outbox (ver `ejecutarIniciar`). El único cuelgue
  // alcanzable por este flujo era la fase de outbox (`abrirOutbox`/`encolarEvento` contra
  // SQLite trabada) — el fix anterior (esperar a `iniciar()` con un timeout) atacaba el síntoma
  // equivocado: `detener()` mismo se colgaba en SU PROPIO outbox antes de escribir
  // `fin_recorrido`. Este rediseño saca el outbox del camino crítico del todo.
  const ejecutarDetener = useCallback(async () => {
    setErrorGps(null);
    // Punto 3: capturado PRIMERO — el instante REAL en que el chofer tocó "Finalizar", antes de
    // cualquier operación que pueda demorarse. `cerrarRecorridoEnOutbox` (más abajo) lo usa como
    // `ts` explícito de `fin_recorrido`, nunca la hora en que el `INSERT` finalmente corre.
    const tsFin = new Date().toISOString();
    // Sync — invalida el `iniciar()` en curso, si lo hay, SIN esperar nada. Si ese intento ya
    // llamó `start()`, al resolver tarde se apaga y restaura solo (`detenerNativoYRestaurar` en
    // `ejecutarIniciar`) — ver el chequeo `sigueVigente()` ahí.
    serializadorIniciar.invalidarEnCurso();

    try {
      const resultadoStop = await detenerNativoConTimeout(BackgroundGeolocation);
      if (!resultadoStop.ok) {
        // No bloquea el cierre — "Finalizar" tiene que responder siempre, sin importar en qué
        // haya quedado trabado el `stop()` nativo. Solo diagnóstico.
        Sentry.captureException(
          resultadoStop.error ?? new Error('Fallo desconocido deteniendo BackgroundGeolocation'),
          { tags: { contexto: 'gps-foreground', paso: 'detener-stop-nativo' } },
        );
      }
    } catch (error) {
      // `detenerNativoConTimeout` no debería rechazar nunca (atrapa sus propios fallos) — red de
      // seguridad extra, mismo criterio que el resto de este camino crítico.
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'detener-stop-nativo-inesperado' },
      });
    }

    try {
      removerSuscripciones();
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'detener-remover-suscripciones' },
      });
    }
    setTracking(false);
    trackingRef.current = false;

    // QUI-P0: reverso de `reafirmarMovimiento` — restaura `disableStopDetection: false` para
    // que un futuro re-enganche o inspección de estado no encuentre la política "nunca apagar
    // el GPS" activa fuera de un recorrido real. Best-effort y SIN `await` acá mismo — un fallo
    // acá es solo de config persistida, no debe demorar el camino crítico que ya está por
    // devolver el control al chofer.
    //
    // R1: la promesa SÍ se registra (`serializadorRestauracion`) para que el PRÓXIMO `iniciar()`
    // pueda esperarla antes de reafirmar movimiento — sin este registro, un "Finalizar" +
    // "Iniciar" rápido corría este `setConfig(false)` en carrera con el `setConfig(true)` del
    // nuevo recorrido.
    serializadorRestauracion.registrar(
      restaurarComportamientoNormal(BackgroundGeolocation).catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'restaurar-comportamiento-normal' },
        });
      }),
    );
    // Camino crítico terminado acá — el chofer ya ve el recorrido detenido. Todo lo que sigue
    // corre en segundo plano, sin que nadie lo espere.

    // Punto 4 del rediseño: el cierre real (outbox + veredicto) corre en una tarea de fondo,
    // disparada con `void`. `idCierre` es el mecanismo de "solo el cierre MÁS RECIENTE puede
    // tocar `resultado`/`errorGps`" — si el chofer alcanza a iniciar y terminar OTRO recorrido
    // mientras este cierre sigue en vuelo, ese resultado no debe pisar al del recorrido nuevo.
    // `montadoRef` cubre el caso de que el hook ya se haya desmontado para cuando esto resuelva.
    const idCierre = ++ultimoCierreId.current;
    const deviceIdCierre = deviceId;
    const sesionIdCierre = sesionId;
    void (async () => {
      try {
        await cerrarRecorridoEnOutbox(
          estadoInicioRecorrido,
          { abrirOutbox, encolarEvento, generarEventId },
          { deviceId: deviceIdCierre, sesionId: sesionIdCierre },
          tsFin,
        );
      } catch (error) {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'detener-cerrar-recorrido-outbox' },
        });
      }

      if (!montadoRef.current || ultimoCierreId.current !== idCierre) return;

      try {
        // A1 (hallazgo de revisión, QUI-216 criterio B): los huecos se calculan desde el
        // OUTBOX, no desde un `useRef` en memoria — ese ref solo lo alimentaba `onLocation`,
        // que no corre en el camino headless (app terminada, sin hooks). Los puntos ya están
        // persistidos en el outbox con su `tsFix` (mismo instante que se persiste server-side
        // — ver `resolverTsFix`), así que leerlos de ahí cubre la ventana completa. Se filtra
        // por `sesionId` para no arrastrar puntos de una corrida anterior sin purgar.
        const db = await abrirOutbox();
        const eventosGps = await obtenerEventosPorTipo(db, 'gps_point');
        const timestampsMedicion = eventosGps
          .filter((evento) => evento.payload['sesionId'] === sesionIdCierre)
          // M3 (hallazgo de revisión, medio): excluye los puntos del rescate de emergencia del
          // día 1 (`rescate-dia1-core.ts`, `origen: 'rescate'`) — llevan el `sesionId` de la
          // sesión que CORRIÓ el rescate, que puede ser esta misma si el chofer rescata a mitad
          // de turno; sin este filtro sus `tsFix` viejos disparan `duracionHoras` y reportan un
          // hueco gigante falso.
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
        // A9 (hallazgo de revisión, QUI-216 criterio A): ventana de batería SEPARADA de
        // `duracionHoras` — `bateria.current` solo alimenta `onLocation`, no sobrevive a que
        // Android recicle el proceso. `evaluarCriteriosGo` aplica su propio piso de cobertura
        // sobre esta ventana — ver `battery-gap-monitor.ts`.
        const duracionBateriaHoras = duracionVentanaBateriaHoras(bateria.current);
        const veredicto = evaluarCriteriosGo({
          bateriaConsumidaPorcentaje: consumo,
          reporteHuecos,
          duracionMedicionHoras: duracionHoras,
          duracionBateriaHoras,
          erroresEscrituraOutbox: erroresEscritura.current,
        });
        const totalOutbox = await contarEventosPendientes(db);
        if (!montadoRef.current || ultimoCierreId.current !== idCierre) return;
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
      } catch (error) {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'detener-calcular-veredicto' },
        });
        if (montadoRef.current && ultimoCierreId.current === idCierre) {
          setErrorGps('No se pudo calcular el resultado del recorrido.');
        }
      }
    })();
  }, [deviceId, sesionId, serializadorRestauracion, serializadorIniciar, estadoInicioRecorrido, removerSuscripciones]);

  // Punto 2 del rediseño: wrapper público de "Finalizar recorrido" — single-flight, mismo
  // mecanismo que `iniciar()` (chequeo y registro síncronos, sin `await` de por medio). Una
  // segunda llamada mientras hay un `detener()` en curso reusa la MISMA promesa — nunca corre
  // el camino crítico dos veces en paralelo. `deteniendo` es lo que `operation-screen.tsx` usa
  // para deshabilitar "Finalizar" mientras corre.
  const detener = useCallback(async () => {
    let promesa = serializadorIniciar.promesaDetenerEnCurso();
    if (!promesa) {
      promesa = ejecutarDetener();
      serializadorIniciar.registrarPromesaDetener(promesa);
    }
    setDeteniendo(true);
    try {
      await promesa;
    } finally {
      setDeteniendo(false);
    }
  }, [ejecutarDetener, serializadorIniciar]);

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
    // QUI-P0: estado del permiso ACTIVITY_RECOGNITION — fail-open, nunca gatea nada acá. Solo
    // para el preflight de la Entrega 26 (QUI-338 continuación); esta entrega no construye esa
    // UI.
    estadoPermisoActividad,
    ultimaDeteccion,
    posicionActual,
    iniciar,
    detener,
    // REDISEÑO (2026-09-25, puntos 1-2): flags de single-flight para que
    // `operation-screen.tsx`/`next-control-sheet.tsx` deshabiliten "Comenzar"/"Finalizar"
    // mientras corren y elijan el mensaje correcto. `guardandoRecorridoAnterior` distingue,
    // dentro de `iniciando`, el caso "intento fresco" ("Iniciando…") del caso "el single-flight
    // sigue bloqueado por un intento anterior que un `detener()` ya invalidó pero que sigue
    // colgado en su propio outbox" ("Guardando recorrido anterior…").
    iniciando,
    guardandoRecorridoAnterior,
    deteniendo,
    simularDeteccion,
  };
}
