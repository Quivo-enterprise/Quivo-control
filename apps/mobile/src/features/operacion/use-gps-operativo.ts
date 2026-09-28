import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform, type AppStateStatus } from 'react-native';
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
  obtenerVisitasPendientes,
} from '../../db/outbox';
import {
  canalVisualHabilitado,
  gpsSpikeConfig,
  logVerboseHabilitado,
} from '../../gps/background-geolocation.config';
import { esFixVisual, fixVisualDesdeLocation } from './movimiento/fix-visual';
import {
  alimentarEstadoVisual,
  configurarObsolescencia,
  reiniciarEstadoVisual,
} from './movimiento/store-visual';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  duracionVentanaBateriaHoras,
  evaluarCriteriosGo,
  type MuestraBateria,
} from '../../gps/battery-gap-monitor';
import {
  claveCumplimiento,
  UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
  type DeteccionPuntoControl,
  type EstadoPuntoControl,
} from '../../gps/geofence';
import { confirmarVisitasVencidasEnCola, registrarPuntoGps } from '../../gps/headless-task';
import { clavesCumplimientoDesdePayloads, combinarConVisitasPendientes } from '../../gps/location-task';
import {
  anunciarLlegadaPuntoControl,
  asegurarPermisoNotificaciones,
  limpiarAproximacionesAnunciadas,
} from './anuncio-punto-control';
import type { MotivoAnuncio } from './decidir-anuncio';
import { intentarDrenarOportunista } from './drenaje-oportunista';
import { marcarRecorridoActivoGlobal } from './estado-recorrido-activo';
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
  crearManejadorForegroundActivo,
  crearManejadorReafirmarMovimiento,
  crearSerializadorPromesaEnCurso,
  crearSerializadorRestauracion,
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
  // `GpsProvider` — ver el call site en `onLocation`/`onHeartbeat` más abajo. Requerido (sin
  // default): las dos pantallas que montan `GpsProvider` ya tienen esta función disponible.
  obtenerAccessToken: () => Promise<string | null>,
) {
  const [tracking, setTracking] = useState(false);
  // FIX POST-REVISIÓN (hallazgo ALTO, rescope SESION_NO_VIGENTE — Entrega 28): `false` hasta que
  // este hook tenga un VEREDICTO REAL sobre si hay un recorrido activo — el re-enganche nativo
  // (efecto más abajo: `getState()`/`ready()` resuelven, con o sin plugin `enabled`) o un cambio
  // real de `tracking` por `iniciar()`/`detener()`. Antes de este fix, el efecto `[tracking]` de
  // abajo publicaba el `false` INICIAL de este `useState` apenas montaba el componente, varios
  // `await`s antes de que el re-enganche resolviera — `restaurarSesion` (`use-auth-movil.ts`)
  // leía ese `false` prematuro como si fuera el veredicto real (`huboLecturaDeRecorridoActivo()`
  // ya daba `true` desde ese primer efecto) y borraba la sesión con el recorrido TODAVÍA activo,
  // matando el tracking sin `fin_recorrido` — justo lo que el rescope de
  // `estado-recorrido-activo.ts` existía para evitar. Se resetea a `false` al montar/cambiar
  // `sesionId` (ver el efecto de re-enganche más abajo, junto a `semillaHidratadaRef`); se pone
  // en `true` cuando el re-enganche resuelve (haya o no un plugin `enabled` para re-enganchar) o
  // cuando `iniciar()`/`detener()` cambian `tracking` de verdad.
  const veredictoPublicable = useRef(false);
  // Rescope SESION_NO_VIGENTE (code review): espeja `tracking` a un módulo compartido, sin
  // React, que `use-auth-movil.ts` (más arriba en el árbol que `GpsProvider`) lee para saber si
  // hay un recorrido activo antes de decidir si puede borrar la sesión de inmediato — ver el
  // docblock de `estado-recorrido-activo.ts` para el porqué de esta wiring.
  //
  // FIX POST-REVISIÓN: publica SOLO cuando `veredictoPublicable` ya está en `true` (ver ese ref,
  // arriba) — evita publicar el `false` inicial del `useState` de arriba como si fuera un
  // veredicto real. Cubre los cambios REALES de `tracking` (`iniciar()`/`detener()`, y el
  // re-enganche cuando SÍ encuentra un plugin `enabled` — ahí `tracking` pasa de `false` a
  // `true` y este efecto sí vuelve a correr). El caso en que el re-enganche NO encuentra nada que
  // re-enganchar (`tracking` se queda en `false`, este efecto nunca vuelve a disparar porque el
  // valor no cambió) lo publica el propio re-enganche de forma EXPLÍCITA — ver ese bloque más
  // abajo.
  useEffect(() => {
    if (veredictoPublicable.current) marcarRecorridoActivoGlobal(tracking);
  }, [tracking]);
  const [puntos, setPuntos] = useState(0);
  // Spike `ubicación fluida` (overlay de métricas S1, `spike-metrics-overlay.tsx`): espejo de
  // `visualFixesRecibidos.current` (ver ese ref más abajo, ya existía para el `console.log` de
  // `logVerboseHabilitado`) como estado — mismo patrón que `puntos`/`puntosRef` de arriba. Solo
  // cambia mientras el canal visual corre (`canalVisualHabilitado`, apagado por default —
  // `EXPO_PUBLIC_GPS_CANAL_VISUAL !== '1'`): fuera del spike este estado nunca se mueve de `0`,
  // cero impacto en el build normal.
  const [fixesVisuales, setFixesVisuales] = useState(0);
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
  // ENTREGA 6/7 (plan post-piloto 2026-09-09): aviso de aproximación (`fase: 'aproximacion'`),
  // SEPARADO de `ultimaDeteccion` (que ahora solo lleva confirmaciones, `fase: 'confirmado'`) —
  // `gps-provider.tsx` los consume por separado: éste dispara SOLO la voz informativa,
  // `ultimaDeteccion` dispara vibración + notificación (+ el sonido custom foreground). Ver
  // `deteccionAproximacion` en `ResultadoConstruirEventos` (`gps/location-task.ts`).
  const [deteccionAproximacion, setDeteccionAproximacion] = useState<DeteccionPuntoControl | null>(
    null,
  );
  // REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
  // 2026-09-23): el anuncio de "llegaste" YA NO se deriva de la evidencia (`ultimaDeteccion`) —
  // es la última decisión (`AnuncioDecidido`, `decidir-anuncio.ts`) que tomó el único punto de
  // llamada dentro de `colaRegistroGps` (`gps/headless-task.ts`). `gps-provider.tsx` lo consume
  // SOLO para el sonido custom EXTRA de foreground (`confirmacion-sonido.ts`) — la vibración y la
  // notificación ya las ejecutó este mismo hook, ver `onLocation`/`onHeartbeat` más abajo.
  const [ultimoAnuncioLlegada, setUltimoAnuncioLlegada] = useState<
    { puntoControlId: string; pasada: number; motivo: MotivoAnuncio } | null
  >(null);
  const [posicionActual, setPosicionActual] = useState<
    { lat: number; lng: number; speedKmh: number | null } | null
  >(null);
  const bateria = useRef<MuestraBateria[]>([]);
  const puntosRef = useRef(0);
  const erroresEscritura = useRef(0);
  const puntosControlDetectados = useRef<Map<string, EstadoPuntoControl>>(new Map());
  const subscription = useRef<{ remove: () => void } | null>(null);
  // FIX POST-REVISIÓN (bug 2): suscripción SEPARADA de `onHeartbeat` — ver `onHeartbeat` más
  // abajo. No comparte el mismo `subscription.current` que `onLocation`: las dos deben poder
  // instalarse/removerse de forma independiente (el SDK expone un `remove()` propio por cada
  // `addListener`).
  const heartbeatSubscription = useRef<{ remove: () => void } | null>(null);
  // QUI-P0: tercera suscripción al SDK, defensa en profundidad contra volver a estacionario en
  // medio de un recorrido (ver `crearManejadorReafirmarMovimiento`, `gps/seguimiento-continuo.ts`).
  const motionChangeSubscription = useRef<{ remove: () => void } | null>(null);
  // FASE B (`docs/plan-ubicacion-fluida.md`): cuarta suscripción, la del canal visual
  // (`BackgroundGeolocation.watchPosition`, ver `iniciarCanalVisual`/`detenerCanalVisual` más
  // abajo) — detrás del flag `canalVisualHabilitado` (`gps/background-geolocation.config.ts`),
  // apagado por default. `watchPosition` devuelve una `Subscription` con `.remove()`, igual que
  // `onLocation`/`onHeartbeat`/`onMotionChange` (confirmado contra el `.d.ts` instalado:
  // `@transistorsoft/background-geolocation-types@5.2.2/dist/core/api/
  // BackgroundGeolocation.d.ts:89`, `watchPosition(...): Subscription`).
  const watchVisualSubscription = useRef<{ remove: () => void } | null>(null);
  // Contador de fixes recibidos por el canal visual desde el último `iniciarCanalVisual()` —
  // solo para los logs `[gps-visual]` del spike S1 (instrumentación, no afecta la evidencia).
  const visualFixesRecibidos = useRef(0);
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
  // MEDIO (hallazgo de revisión, QUI-247): instancia INDEPENDIENTE del mismo factory de
  // arriba — serializa `detener()` contra un `iniciar()` en curso, no la restauración de
  // config. `iniciar()` registra acá su propia promesa (envolviendo `ejecutarIniciar`, más
  // abajo) apenas arranca, y `detener()` la espera ANTES de tocar nada (nativo, suscripciones,
  // outbox, `tracking`). Sin esto, un toque rápido Iniciar→Finalizar podía hacer que
  // `detener()` escribiera `fin_recorrido` (y pisara `trackingRef`) ANTES de que el `iniciar()`
  // en vuelo llegara a escribir `inicio_recorrido` — reconstrucción de recorrido rota. Ver el
  // docblock de `crearSerializadorPromesaEnCurso` (`gps/seguimiento-continuo.ts`) y su test
  // dedicado a esta carrera.
  const serializadorIniciar = useRef(crearSerializadorPromesaEnCurso()).current;
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
  // FIX POST-REVISIÓN (Codex `verify-fix`, punto 5, "semilla fallida"): `true` solo cuando
  // `sembrarCumplimientos` terminó de leer el outbox SIN excepción — separado de
  // `semillaPromise` a propósito, igual criterio que `semillasHidratadasPorSesion` en
  // `gps/headless-task.ts`: la promesa de la siembra resuelve aunque su `catch` interno haya
  // corrido, así que no alcanza para saber si el Map de estados quedó bien hidratado o vacío
  // por un fallo transitorio (SQLite ocupada). `onLocation` lo consulta antes de procesar
  // cumplimientos (ver más abajo).
  const semillaHidratadaRef = useRef(false);

  const onLocation = useCallback(
    // La escritura al outbox (gps_point + cumplimiento_punto_control) vive en
    // `registrarPuntoGps` (`gps/headless-task.ts`), compartida con el headless task que
    // corre cuando la app está terminada (QUI-216) — acá solo queda lo que es
    // genuinamente de React: estado de UI y los refs que alimentan el veredicto del spike.
    async (location: Location) => {
      // FASE B (`docs/plan-ubicacion-fluida.md`, "guard de evidencia"): alimenta el store visual
      // con TODO fix que llega ACÁ — de evidencia (esta suscripción, `distanceFilter: 15`) —
      // igual que siempre. Va ANTES que nada más, incluso antes del contador de evidencia.
      //
      // FIX POST-REVISIÓN (hallazgo CRÍTICO, "canal visual enruta a la evidencia"): el canal
      // visual (`watchPosition`, `iniciarCanalVisual` más abajo) YA NO llama a esta función —
      // alimenta el store directamente y nunca pasa por acá. Antes, sus fixes se enrutaban a
      // `onLocationRef.current` (esta misma función) confiando en que `esFixVisual(location)`
      // (`location.extras?.fuente === 'visual'`) cortara acá ANTES de tocar
      // `puntosRef`/batería/outbox/lógica de puntos de control (todos de EVIDENCIA, RF-67..73) —
      // pero que `extras` sobreviva el viaje ida y vuelta por el SDK nativo (`watchPosition` →
      // callback) NUNCA se verificó en dispositivo real; si no sobrevive, cada fix del canal
      // visual a 1Hz se convertía en un `gps_point` de evidencia falso. El guard `esFixVisual` de
      // abajo se queda como defensa en profundidad, por si el SDK ADEMÁS difunde esos mismos
      // fixes por esta suscripción de `onLocation` (no solo por el callback de `watchPosition`) —
      // nunca debería depender de él como único filtro.
      alimentarEstadoVisual(fixVisualDesdeLocation(location));
      if (esFixVisual(location)) return;

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
        // FIX POST-REVISIÓN (Codex `verify-fix`, punto 5): si la siembra todavía no hidrató
        // (falló la última vez), reintenta ACÁ MISMO antes de procesar este fix — "se reintenta
        // en cada tick" — en vez de quedar pegado para siempre a la promesa fallida.
        if (!semillaHidratadaRef.current) {
          semillaPromise.current = sembrarCumplimientos();
          await semillaPromise.current;
        }
        const db = await abrirOutbox();
        // FIX POST-REVISIÓN (punto 5): mientras no hidrate, no se procesan transiciones de
        // cumplimiento — `puntosControl: []` hace que `construirEventosDeUbicacion` salte esa
        // parte (ver su chequeo `contexto.puntosControl.length > 0`); la captura de `gps_point`
        // sigue exactamente igual, no depende de esto.
        const puntosControlDelTick = semillaHidratadaRef.current ? puntosControl : [];
        // FIX POST-REVISIÓN (hallazgo 10, cleanup — "`void puntosRearmados` es código muerto"):
        // `registrarPuntoGps` también devuelve `puntosRearmados` (histéresis de DETECCIÓN) — sin
        // ningún consumidor acá desde el rediseño (`puntosRearmadosVoz`, la histéresis PROPIA de
        // voz, es la que sí se usa). Se deja fuera de la desestructuración en vez de traerlo solo
        // para descartarlo.
        const {
          deteccion,
          deteccionAproximacion: nuevaAproximacion,
          puntosRearmadosVoz,
          anunciosLlegada,
        } = await registrarPuntoGps(
          db,
          location,
          { deviceId, sesionId, puntosControl: puntosControlDelTick },
          // B6 (hallazgo de revisión, bajo): se pasa el REF, no `.current` — la cola FIFO de
          // `registrarPuntoGps` difiere la ejecución, y `sembrarCumplimientos` puede reemplazar
          // el Map en el medio. Ver `ContenedorEstadosPuntosControl` (`gps/headless-task.ts`).
          puntosControlDetectados,
        );
        // FIX POST-REVISIÓN (bug 4, ajustado por G1): libera el dedupe de voz de aproximación
        // para los puntos cuya histéresis PROPIA de voz re-armó de verdad este tick — ver
        // `limpiarAproximacionesAnunciadas` y el comentario largo de `puntosRearmadosVoz` en
        // `gps/geofence.ts` (independiente de la histéresis de DETECCIÓN). Incondicional (no
        // gatea en `settings.navegacionVoz`): limpiar el Set nunca hace daño si la voz está
        // apagada (el Set solo tiene entradas de anuncios que SÍ se emitieron).
        if (puntosRearmadosVoz.length > 0) limpiarAproximacionesAnunciadas(puntosRearmadosVoz);
        if (deteccion) setUltimaDeteccion(deteccion);
        // ENTREGA 6/7: se actualiza en CADA tick con puntos de control (incluso a `null` cuando
        // ninguno está en rango) — a diferencia de `ultimaDeteccion`, que solo cambia con una
        // confirmación real. Sin el `null` explícito, la última aproximación anunciada quedaría
        // "pegada" en el estado del hook después de que el vehículo se aleja.
        setDeteccionAproximacion(nuevaAproximacion);
        // REDISEÑO: `anunciosLlegada` YA fue DECIDIDO dentro de `registrarPuntoGps` (la cola) —
        // acá SOLO se ejecuta (reclamar intención durable + programar notificación/vibración),
        // el mismo camino que usa el headless (`anunciarLlegadaPuntoControl`,
        // `anuncio-punto-control.ts`) — "el foreground no tiene disparador propio: consume las
        // decisiones de esa misma cola".
        //
        // FIX POST-REVISIÓN (hallazgo 3, code review — "el chime suena aunque el reclamo se
        // perdió"): antes, `setUltimoAnuncioLlegada` (que dispara el sonido custom de foreground,
        // `confirmacion-sonido.ts`, en `gps-provider.tsx`) se llamaba INCONDICIONALMENTE, ANTES
        // de saber si `anunciarLlegadaPuntoControl` de verdad reclamó/programó algo — si el
        // reclamo se perdía (otra llamada ya estaba a cargo de la MISMA visita, o el reclamo
        // mismo fallaba), el chime sonaba igual sin que hubiera pasado NADA. Ahora se llama
        // recién cuando `anunciarLlegadaPuntoControl` resuelve `true` (reclamó Y programó de
        // verdad — ver su docblock).
        for (const anuncio of anunciosLlegada) {
          anunciarLlegadaPuntoControl(
            db,
            anuncio.puntoControlId,
            anuncio.pasada,
            anuncio.motivo,
            { sesionId, puntosControl: puntosControlDelTick },
          )
            .then((exitoso) => {
              if (exitoso) {
                setUltimoAnuncioLlegada({
                  puntoControlId: anuncio.puntoControlId,
                  pasada: anuncio.pasada,
                  motivo: anuncio.motivo,
                });
              }
            })
            .catch((error: unknown) => {
              Sentry.captureException(error, {
                tags: { contexto: 'gps-foreground', paso: 'anunciar-llegada' },
              });
            });
        }
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

  /**
   * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): mitad foreground del fix
   * — ver `manejarHeartbeatHeadless` (`gps/headless-task.ts`) para la mitad headless y el
   * porqué completo. Sin un fix nuevo (vehículo detenido, `distanceFilter: 15`) ninguna visita
   * en curso puede cerrar por el camino normal — el `heartbeat` del SDK
   * (`heartbeatInterval: 60`) es el único evento que sigue llegando con el vehículo quieto.
   *
   * Deliberadamente NO escribe ningún `gps_point`: el heartbeat no trae una posición fresca
   * (`HeartbeatEvent.location` es "the last-known location", no una lectura nueva) — solo
   * evalúa si alguna visita ya lleva `>= UMBRAL_ANTIGUEDAD_CANDIDATO_MS` sin mejorar su mínimo
   * y, si es así, la confirma con el candidato YA observado (mismo camino transaccional que el
   * confirm normal — `aplicarConfirmacionesForzadas`, `gps/headless-task.ts`).
   *
   * FIX POST-REVISIÓN (R1, "evidencia duplicada por concurrencia"): la lectura del estado +
   * `confirmarVisitasVencidas` + `aplicarConfirmacionesForzadas` corren ahora DENTRO de
   * `confirmarVisitasVencidasEnCola` — la MISMA cola FIFO que serializa los fixes reales
   * (`registrarPuntoGps`, `gps/headless-task.ts`). Antes corrían acá directo, por FUERA de la
   * cola: un fix real concurrente (`onLocation`) podía leer la MISMA visita pendiente antes de
   * que este heartbeat terminara de escribirla (o viceversa) y los dos terminaban emitiendo la
   * MISMA pasada con `eventId` distintos — el servidor dedupea solo por `eventId` (QUI-241), así
   * que el paso se contaba dos veces. `filtrarSesionActual: false` — a diferencia del heartbeat
   * headless, `puntosControlDetectados` ya está scopeado a la sesión actual (`sembrarCumplimientos`
   * lo reemplaza entero en cada cambio de `sesionId`), no hace falta filtrar de nuevo.
   */
  const onHeartbeat = useCallback(async () => {
    // Entrega 2 (drenado oportunista del outbox en background): fuerza un fix fresco
    // (`HeartbeatEvent.location` es la ÚLTIMA posición conocida, no una lectura nueva — ver el
    // docblock de arriba) y lo persiste igual que cualquier otro punto — si el vehículo lleva
    // rato detenido sin emitir por `onLocation` (`distanceFilter: 15` no dispara nada quieto),
    // este es el único mecanismo que sigue dejando evidencia GPS cada 60 s durante ese layover.
    // Va ANTES del resto (confirmación de visitas/anuncios) y en su PROPIO try/catch: un fallo
    // acá es de instrumentación, nunca debe impedir que el resto del heartbeat corra.
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
    // LOW-MED (hallazgo de revisión, QUI-247): mismo reintento oportunista que `onLocation`
    // (ver ese comentario) — el heartbeat es el ÚNICO evento que sigue llegando cada 60 s con
    // o sin movimiento, así que sin este segundo enganche un layover prolongado justo después
    // de un `iniciar()` que falló al escribir `inicio_recorrido` podía dejar el marcador sin
    // ningún reintento hasta el próximo fix de `onLocation` (que puede tardar de más con el
    // vehículo detenido).
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
    try {
      await semillaPromise.current;
      const db = await abrirOutbox();
      const { emitir, anunciosLlegada } = await confirmarVisitasVencidasEnCola(
        db,
        deviceId,
        sesionId,
        puntosControlDetectados,
        Date.now(),
        UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
        false,
        puntosControl,
      );
      if (emitir.length > 0) {
        // Refleja la confirmación forzada en la UI igual que una confirmación normal — el chofer
        // ve el punto tachado aunque haya sido el heartbeat, no un fix nuevo, quien lo cerró.
        setUltimaDeteccion(emitir[emitir.length - 1]?.deteccion ?? null);
      }
      // REDISEÑO: fallback de TIEMPO del anuncio de llegada — ver el docblock de
      // `confirmarVisitasVencidasEnCola`. Mismo camino de ejecución que `onLocation`.
      // FIX POST-REVISIÓN (hallazgo 3): el chime (`setUltimoAnuncioLlegada`) solo se dispara si
      // `anunciarLlegadaPuntoControl` reclamó Y programó de verdad — ver el comentario largo en
      // `onLocation`, arriba.
      for (const anuncio of anunciosLlegada) {
        anunciarLlegadaPuntoControl(db, anuncio.puntoControlId, anuncio.pasada, anuncio.motivo, {
          sesionId,
          puntosControl,
        })
          .then((exitoso) => {
            if (exitoso) {
              setUltimoAnuncioLlegada({
                puntoControlId: anuncio.puntoControlId,
                pasada: anuncio.pasada,
                motivo: anuncio.motivo,
              });
            }
          })
          .catch((error: unknown) => {
            Sentry.captureException(error, {
              tags: { contexto: 'gps-foreground', paso: 'anunciar-llegada-heartbeat' },
            });
          });
      }
    } catch (error) {
      console.error('[QUIVO][gps] No se pudo procesar el heartbeat', error);
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'procesar-heartbeat' },
      });
    }
    // Entrega 2: mismo motor que `onLocation` — `intentarDrenarOportunista` nunca rechaza (ver
    // su docblock), así que corre sin su propio try/catch, incondicional al resultado del
    // bloque de arriba (un heartbeat que falló en confirmar visitas igual puede tener trabajo
    // de sync pendiente que drenar).
    await intentarDrenarOportunista(obtenerAccessToken);
  }, [deviceId, sesionId, puntosControl, obtenerAccessToken, estadoInicioRecorrido, estaEnRecorrido]);

  const onHeartbeatRef = useRef(onHeartbeat);
  useEffect(() => {
    onHeartbeatRef.current = onHeartbeat;
  }, [onHeartbeat]);

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
    // FIX POST-REVISIÓN (bug 2): suscripción de heartbeat en el MISMO punto que la de
    // ubicaciones (arranque manual e re-enganche al montar) — así el vehículo detenido en la
    // TERMINAL, en la parada final de la ruta, también confirma su último punto de control.
    heartbeatSubscription.current?.remove();
    heartbeatSubscription.current = BackgroundGeolocation.onHeartbeat(() => {
      // Merge (Entrega 31a + anuncio): main movió `getCurrentPosition`/reafirmar
      // movimiento/reintento de `inicio_recorrido` al `onHeartbeat` real (arriba, useCallback),
      // junto al resto de la lógica de anuncio — un solo camino, sin duplicar el fix forzado
      // ni el drenado (que `onHeartbeat` ya hace al final).
      void onHeartbeatRef.current();
    });

    // QUI-P0: defensa EN PROFUNDIDAD contra volver a estacionario en medio de un recorrido —
    // el mecanismo PRIMARIO es `disableStopDetection: true` (default estático en
    // `gpsSpikeConfig.activity` + reafirmado en runtime por `reafirmarMovimiento`), este
    // handler es el respaldo si algún fabricante (el reporte de campo es de un Samsung Galaxy
    // A71, conocido por gestión de batería agresiva) empuja el plugin a estacionario pese a la
    // config. `estaEnRecorrido` lee `trackingRef` (no `tracking` del closure) para no quedar
    // atado al valor de cuando se instaló esta suscripción. Ver
    // `crearManejadorReafirmarMovimiento` (`gps/seguimiento-continuo.ts`) para el detalle.
    motionChangeSubscription.current?.remove();
    motionChangeSubscription.current = BackgroundGeolocation.onMotionChange(
      crearManejadorReafirmarMovimiento(BackgroundGeolocation, estaEnRecorrido),
    );
    // `deviceId`/`sesionId`/`estadoInicioRecorrido` NO van acá: el handler de `onHeartbeat`
    // (arriba, su propio `useCallback`) es quien los usa directamente (reintento de
    // `inicio_recorrido`, QUI-247) — esta función solo lo referencia vía `onHeartbeatRef`, que
    // siempre apunta a la versión más reciente (ver el `useEffect` que lo mantiene al día).
  }, [estaEnRecorrido]);

  /**
   * FASE B (`docs/plan-ubicacion-fluida.md`, "canal visual con watchPosition"): arranca (si no
   * está corriendo ya) un `watchPosition` a 1Hz, `persist: false` — nunca toca la SQLite nativa
   * del plugin de evidencia — con `extras: {fuente: 'visual'}` (queda por si algún día hace
   * falta distinguir el origen desde afuera, p. ej. logs; ya no lo consume ningún guard propio).
   *
   * FIX POST-REVISIÓN (hallazgo CRÍTICO, "canal visual enruta a la evidencia"): el callback de
   * este `watchPosition` alimenta el store visual DIRECTAMENTE (`alimentarEstadoVisual`) — YA NO
   * enruta sus fixes a `onLocationRef.current` (la función que procesa la evidencia). El diseño
   * anterior dependía de que `esFixVisual(location)` cortara dentro de `onLocation` ANTES de
   * tocar `puntosRef`/batería/outbox — pero que `location.extras.fuente` sobreviva el viaje por
   * el SDK nativo (`watchPosition` → callback) nunca se confirmó en dispositivo real; si el SDK
   * no lo respeta, cada fix visual a 1Hz se colaba como un `gps_point` de evidencia. Con esta
   * función alimentando el store por su cuenta, la evidencia queda gobernada EXCLUSIVAMENTE por
   * la suscripción de `onLocation` (`distanceFilter: 15`) — el guard `esFixVisual` de esa función
   * se mantiene como defensa en profundidad, no como el único filtro.
   *
   * También habilita la reevaluación de `obsoleto` del store (`configurarObsolescencia`, ver su
   * docblock en `store-visual.ts`): sin el canal visual, "sin fix hace 15s" es un vehículo
   * detenido normal (evidencia por distancia/heartbeat), no una señal perdida.
   *
   * Firma verificada contra el `.d.ts` instalado (`@transistorsoft/background-geolocation-
   * types@5.2.2/dist/core/api/BackgroundGeolocation.d.ts:89`):
   * `watchPosition(options: WatchPositionRequest, locationCallback, errorCallback?): Subscription`.
   */
  const iniciarCanalVisual = useCallback(() => {
    if (watchVisualSubscription.current) return; // ya corriendo
    configurarObsolescencia(true);
    visualFixesRecibidos.current = 0;
    setFixesVisuales(0);
    if (logVerboseHabilitado) {
      void BackgroundGeolocation.getCount()
        .then((n) => console.log(`[gps-visual] getCount() antes de iniciar: ${n}`))
        .catch(() => {
          // Instrumentación best-effort del spike S1: un fallo acá no debe impedir arrancar.
        });
    }
    try {
      watchVisualSubscription.current = BackgroundGeolocation.watchPosition(
        {
          interval: 1000,
          persist: false,
          desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
          extras: { fuente: 'visual' },
        },
        (location) => {
          visualFixesRecibidos.current += 1;
          setFixesVisuales(visualFixesRecibidos.current);
          if (logVerboseHabilitado) {
            console.log(`[gps-visual] fix visual #${visualFixesRecibidos.current}`);
          }
          // FIX POST-REVISIÓN: alimenta el store visual directo, sin pasar por `onLocationRef`
          // (ver el docblock de `iniciarCanalVisual`, arriba) — este fix NUNCA debe convertirse
          // en un `gps_point` de evidencia.
          alimentarEstadoVisual(fixVisualDesdeLocation(location));
        },
        (errorCode) => {
          Sentry.captureException(new Error(`watchPosition error ${String(errorCode)}`), {
            tags: { contexto: 'gps-foreground', paso: 'canal-visual-watch' },
          });
        },
      );
      if (logVerboseHabilitado) console.log('[gps-visual] canal visual iniciado');
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'canal-visual-iniciar' },
      });
    }
  }, []);

  /** Detiene el canal visual si está corriendo — no-op si ya estaba parado (llamado tanto al
   * salir a background como en cada cambio de `tracking`, ver el efecto de abajo: idempotente a
   * propósito), y también explícitamente desde `detener()` (hallazgo de revisión, ver ese
   * comentario). Deshabilita la reevaluación de `obsoleto` del store SIEMPRE que se llama
   * (`configurarObsolescencia(false)`, antes del guard de no-op) — sin canal visual corriendo,
   * "sin fix hace 15s" ya no debe marcar obsoleto (ver `store-visual.ts`). */
  const detenerCanalVisual = useCallback(() => {
    configurarObsolescencia(false);
    if (!watchVisualSubscription.current) return;
    watchVisualSubscription.current.remove();
    watchVisualSubscription.current = null;
    if (logVerboseHabilitado) {
      const recibidos = visualFixesRecibidos.current;
      console.log(`[gps-visual] canal visual detenido (fixes recibidos: ${recibidos})`);
      void BackgroundGeolocation.getCount()
        .then((n) => console.log(`[gps-visual] getCount() tras detener: ${n}`))
        .catch(() => {
          // Best-effort, ver comentario de arriba.
        });
    }
  }, []);

  // FASE B: el canal visual corre SOLO con el flag activo (`canalVisualHabilitado`, apagado por
  // default — con él apagado este efecto es un no-op completo, ver el `return` de abajo), con un
  // recorrido en curso (`tracking`) y la app en foreground (`AppState === 'active'`) — plan
  // explícito del CTO: "Se detiene al ir a segundo plano y en `detener()`". Un solo efecto cubre
  // los tres disparadores (cambio de `tracking`, cambio de `AppState`, desmontaje) sin necesitar
  // un efecto separado por cada uno: reevalúa la condición completa en cada `AppState` change Y
  // cada vez que cambia `tracking` (dependencia del efecto — lo reinstala con el valor actual).
  useEffect(() => {
    if (!canalVisualHabilitado) return;
    const evaluarCanalVisual = (estadoApp: AppStateStatus) => {
      if (tracking && estadoApp === 'active') {
        iniciarCanalVisual();
      } else {
        detenerCanalVisual();
      }
    };
    evaluarCanalVisual(AppState.currentState);
    const subscripcionAppState = AppState.addEventListener('change', evaluarCanalVisual);
    return () => {
      subscripcionAppState.remove();
      detenerCanalVisual();
    };
  }, [tracking, iniciarCanalVisual, detenerCanalVisual]);

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
      const base = clavesCumplimientoDesdePayloads(eventosCumplimiento);
      // FIX POST-REVISIÓN (bug 5, "reabrir la app a mitad de visita pierde la pasada"):
      // superpone las visitas PENDIENTES persistidas (SQLite) — ver el docblock de
      // `combinarConVisitasPendientes` (`gps/location-task.ts`). Sin esto, matar y reabrir la
      // app a mitad de una visita en curso la devolvía como si nunca hubiera pasado (o, con una
      // pasada previa del mismo punto, como "ya confirmada" — la máquina de estados nunca más
      // la re-evaluaba).
      const visitasPendientes = await obtenerVisitasPendientes(db, sesionId);
      puntosControlDetectados.current = combinarConVisitasPendientes(base, visitasPendientes);
      // FIX POST-REVISIÓN (Codex `verify-fix`, punto 5): recién ACÁ, tras terminar sin
      // excepción, se marca hidratada — ver el comentario largo de `semillaHidratadaRef`.
      semillaHidratadaRef.current = true;
    } catch (error) {
      console.error('[QUIVO][gps] No se pudo sembrar cumplimientos desde el outbox', error);
      Sentry.captureException(error, {
        tags: { contexto: 'gps-foreground', paso: 'sembrar-cumplimientos' },
      });
      // FIX POST-REVISIÓN (punto 5): NO se marca hidratada — `onLocation` reintenta la siembra
      // en el próximo fix mientras siga en `false` (ver su uso más abajo).
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

    // FIX POST-REVISIÓN (punto 5): nueva sesión (o primer montaje) — arranca sin hidratar hasta
    // que `sembrarCumplimientos` termine bien.
    semillaHidratadaRef.current = false;
    // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): nueva sesión (o primer
    // montaje) — todavía sin veredicto real de recorrido activo hasta que el re-enganche de
    // abajo resuelva o el chofer toque "Iniciar"/"Finalizar". Ver el comentario largo de
    // `veredictoPublicable`, arriba.
    veredictoPublicable.current = false;
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
        if (!montado) return;
        if (!estado.enabled) {
          // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): esto YA ES el
          // veredicto real ("no hay nada que re-enganchar, 'Iniciar' sigue disponible") — antes
          // de este fix, esta rama hacía `return` sin publicar nada, y `tracking` se quedaba en
          // su `false` inicial sin que el efecto `[tracking]` de arriba volviera a correr (el
          // valor no cambia de `false` a `false`), así que el veredicto nunca llegaba a
          // `estado-recorrido-activo.ts`. Se publica EXPLÍCITAMENTE acá, en vez de depender de
          // ese efecto — mismo motivo que la publicación explícita del bloque `catch`, más abajo.
          veredictoPublicable.current = true;
          marcarRecorridoActivoGlobal(false);
          return;
        }
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
        // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): este SÍ es un
        // veredicto real ("re-enganchado, hay recorrido activo") — a diferencia del `false`
        // inicial del montaje, este `setTracking(true)` cambia el valor de verdad (`false` →
        // `true`), así que el efecto `[tracking]` de arriba vuelve a correr y publica, siempre
        // que `veredictoPublicable` ya esté en `true` para entonces (se marca acá, antes de la
        // mutación de estado que dispara ese efecto).
        veredictoPublicable.current = true;
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
        //
        // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): mismo veredicto real
        // que la rama `!estado.enabled` de arriba ("nada que re-enganchar" — la app no sabe si
        // hay un recorrido nativo corriendo, pero el botón "Iniciar recorrido" queda disponible,
        // así que para efectos de `estado-recorrido-activo.ts` NO hay recorrido activo bajo el
        // control de esta app). Publicado explícitamente por el mismo motivo: `tracking` se queda
        // en su `false` inicial, el efecto `[tracking]` no vuelve a correr.
        if (montado) {
          veredictoPublicable.current = true;
          marcarRecorridoActivoGlobal(false);
        }
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
      // FIX POST-REVISIÓN (hallazgo ALTO, "store visual nunca se reinicia"): este cleanup corre
      // tanto al desmontar el hook como al cambiar `sesionId` (dependencia de este efecto,
      // logout/cambio de sesión en el mismo proceso) — los dos casos en los que la posición VIEJA
      // del store (singleton de módulo) no debe seguir mostrándose por encima del prop
      // `posicionActual` fresco de la sesión que arranca. Ver el docblock de
      // `reiniciarEstadoVisual` (`movimiento/store-visual.ts`).
      reiniciarEstadoVisual();
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
  // recorrido" — sin cambios de comportamiento respecto de antes de este fix, salvo la
  // generación del `eventId` estable de `inicio_recorrido` (ver más abajo). `iniciar()` (más
  // abajo del todo, después de `detener()`... en realidad la envoltura queda inmediatamente
  // después de esta función) es apenas un wrapper que registra la promesa de ESTA función en
  // `serializadorIniciar` ANTES de que nada más pueda correr — es lo que le permite a
  // `detener()` esperarla y garantizar `inicio_recorrido < fin_recorrido` siempre. Se separó en
  // dos funciones (en vez de registrar la promesa desde dentro de esta misma) porque necesitamos
  // la referencia a la promesa completa DESDE AFUERA, antes de que la función empiece a correr
  // de verdad — exactamente el mismo motivo por el que `crearSerializadorPromesaEnCurso` existe
  // como abstracción aparte (ver su docblock, `gps/seguimiento-continuo.ts`).
  const ejecutarIniciar = useCallback(async () => {
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
    reiniciarEstadoInicioRecorrido(estadoInicioRecorrido, await generarEventId());
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
      //
      // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): "Iniciar recorrido"
      // es, junto con "Finalizar", un veredicto real — ver el comentario largo de
      // `veredictoPublicable` al inicio del hook.
      veredictoPublicable.current = true;
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
      // catch siguiente. Las suscripciones que acabamos de instalar (ubicación, heartbeat y
      // motion-change) no tienen nada que escuchar: se remueven.
      subscription.current?.remove();
      subscription.current = null;
      heartbeatSubscription.current?.remove();
      heartbeatSubscription.current = null;
      motionChangeSubscription.current?.remove();
      motionChangeSubscription.current = null;
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
      // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): también un veredicto
      // real, aunque `resultadoFalloNativo.tracking` sea siempre `false` acá (el fallo nativo
      // nunca deja nada grabándose) — ver el comentario largo de `veredictoPublicable`.
      veredictoPublicable.current = true;
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
      setErrorGps(resolverResultadoIniciar(true, false).errorGps);
    }
  }, [
    suscribirUbicaciones,
    sembrarCumplimientos,
    deviceId,
    sesionId,
    serializadorRestauracion,
    estadoInicioRecorrido,
  ]);

  // MEDIO (hallazgo de revisión, QUI-247): wrapper público de "Iniciar recorrido". Lo único que
  // agrega sobre `ejecutarIniciar` es registrar su promesa en `serializadorIniciar` — y hacerlo
  // ANTES de cualquier `await` de esta misma función, así que para cuando el conductor pudiera
  // llegar a tocar "Finalizar" (una interacción de UI separada, nunca en el mismo tick de JS)
  // el registro ya está hecho. `detener()`, más abajo, llama `serializadorIniciar.esperarPendiente()`
  // ANTES de tocar nada, así que el orden `inicio_recorrido < fin_recorrido` queda garantizado
  // sin importar qué tan rápido se toquen los dos botones. Ver el test dedicado a esta carrera
  // en `gps/seguimiento-continuo.test.ts` (`crearSerializadorPromesaEnCurso`).
  const iniciar = useCallback(async () => {
    const promesa = ejecutarIniciar();
    serializadorIniciar.registrar(promesa);
    await promesa;
  }, [ejecutarIniciar, serializadorIniciar]);

  const detener = useCallback(async () => {
    setErrorGps(null);
    try {
      // MEDIO (hallazgo de revisión, QUI-247): si hay un `iniciar()` en vuelo, esperarlo ACÁ —
      // antes de tocar el nativo, las suscripciones, el outbox o `tracking` — para que
      // `fin_recorrido` nunca pueda escribirse antes de que ese `iniciar()` termine de intentar
      // escribir `inicio_recorrido` (y de asentar `trackingRef`). `ejecutarIniciar` nunca
      // rechaza (todos sus fallos internos se atrapan y se reportan a Sentry por su cuenta), así
      // que esperar acá no puede hacer fallar `detener()`.
      await serializadorIniciar.esperarPendiente();
      await BackgroundGeolocation.stop();
      subscription.current?.remove();
      subscription.current = null;
      heartbeatSubscription.current?.remove();
      heartbeatSubscription.current = null;
      motionChangeSubscription.current?.remove();
      motionChangeSubscription.current = null;
      // FIX POST-REVISIÓN (hallazgo ALTO, "store visual nunca se reinicia"): corta el canal
      // visual y reinicia el store ACÁ, de forma explícita y síncrona — no alcanza con dejarlo
      // solo al efecto `[tracking]` de `iniciarCanalVisual`/`detenerCanalVisual` (más arriba):
      // ese efecto recién corre en el PRÓXIMO render tras `setTracking(false)` (abajo), y
      // mientras tanto `route-map-view.tsx` seguía mostrando la posición VIEJA del store
      // (singleton de módulo, nunca se limpiaba solo) en vez de caer al prop `posicionActual`
      // fresco. `detenerCanalVisual()` es idempotente (no-op sobre la suscripción si el canal ya
      // estaba parado o el flag está apagado) — segura de llamar siempre. Ver los docblocks de
      // `detenerCanalVisual` y `reiniciarEstadoVisual` (`movimiento/store-visual.ts`).
      detenerCanalVisual();
      reiniciarEstadoVisual();
      // FIX POST-REVISIÓN (hallazgo ALTO, sesión no vigente — Entrega 28): "Finalizar" también es
      // un veredicto real — ver el comentario largo de `veredictoPublicable`, al inicio del hook.
      veredictoPublicable.current = true;
      setTracking(false);
      trackingRef.current = false;
      // QUI-P0: reverso de `reafirmarMovimiento` — restaura `disableStopDetection: false` para
      // que un futuro re-enganche o inspección de estado no encuentre la política "nunca
      // apagar el GPS" activa fuera de un recorrido real (ver docblock en
      // `gps/seguimiento-continuo.ts`). Best-effort y SIN `await` acá mismo:
      // `BackgroundGeolocation.stop()` de arriba ya cortó el tracking nativo — un fallo acá es
      // solo de config persistida, no debe demorar ni hacer fallar el cierre del recorrido
      // (outbox, veredicto) que sigue abajo.
      //
      // R1: la promesa SÍ se registra (`serializadorRestauracion`, ver su comentario más
      // arriba y el docblock de `crearSerializadorRestauracion`) para que el PRÓXIMO
      // `iniciar()` pueda esperarla antes de reafirmar movimiento — sin este registro, un
      // "Finalizar" + "Iniciar" rápido corría este `setConfig(false)` en carrera con el
      // `setConfig(true)` del nuevo recorrido, con el nativo quedando en el estado de quien
      // resuelva último y no de quien debería ganar.
      serializadorRestauracion.registrar(
        restaurarComportamientoNormal(BackgroundGeolocation).catch((error) => {
          Sentry.captureException(error, {
            tags: { contexto: 'gps-foreground', paso: 'restaurar-comportamiento-normal' },
          });
        }),
      );

      // LOW-MED (hallazgo de revisión, QUI-247): última red de seguridad ANTES de escribir
      // `fin_recorrido` — si `iniciar()` y todos sus reintentos (`onLocation`, heartbeat)
      // todavía no lograron escribir `inicio_recorrido`, este es el último intento posible
      // (después de esto las suscripciones ya están removidas — arriba — así que no habrá más
      // reintentos). Con `estadoInicioRecorrido.eventId === null` (nunca hubo un `iniciar()`
      // real en este proceso — camino de re-enganche) `asegurarInicioRecorrido` es un no-op, tal
      // cual tiene que ser: un recorrido re-enganchado no debe generar un `inicio_recorrido`
      // nuevo (ver `inicio-recorrido-retry.ts`). Best-effort: si ni siquiera este último intento
      // logra escribirlo, `detener()` sigue igual con `fin_recorrido` — no bloquear el cierre
      // del recorrido por esto, mismo criterio que el resto de esta función.
      try {
        await asegurarInicioRecorrido(
          estadoInicioRecorrido,
          { abrirOutbox, encolarEvento },
          { deviceId, sesionId },
        );
      } catch (error) {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'detener-asegurar-inicio-recorrido' },
        });
      }

      const db = await abrirOutbox();

      // FIX POST-REVISIÓN (bug 2, diseño B "cierre del recorrido"): descarga TODAS las visitas
      // pendientes y encola sus eventos ANTES del `fin_recorrido` de abajo — sin esto, una
      // visita todavía "en el mínimo local" al momento de finalizar (el chofer para el motor y
      // aprieta "Finalizar" antes de que la distancia vuelva a crecer, o antes de que pase
      // `UMBRAL_ANTIGUEDAD_CANDIDATO_MS`) se perdía: nada volvía a evaluarla una vez detenido el
      // tracking. `umbralMs: 0` fuerza la confirmación de CUALQUIER visita pendiente sin
      // importar su edad — "ante la duda, emitir" (invariante del diseño). Encolar ANTES de
      // `fin_recorrido` (no después) mantiene el orden causal del recorrido: el paso por el
      // último punto de control queda registrado como parte del recorrido que cerró, no
      // colgando después de que ya "terminó".
      //
      // FIX POST-REVISIÓN (R1, "evidencia duplicada por concurrencia"): corre DENTRO de
      // `confirmarVisitasVencidasEnCola` (la MISMA cola FIFO que `registrarPuntoGps`) — antes
      // corría directo, por fuera de la cola: un fix real que llegara justo antes de que el
      // chofer apretara "Finalizar" podía solaparse con este cierre y terminar emitiendo la
      // MISMA pasada dos veces con `eventId` distintos (el servidor solo dedupea por `eventId`,
      // QUI-241). `filtrarSesionActual: false` — mismo motivo que `onHeartbeat`.
      try {
        // FIX POST-REVISIÓN (code review — "Finalizar puede dejar un 'llegaste' sin anunciar"):
        // `umbralAnuncioMs: 0`, igual criterio que `umbralMs: 0` de arriba ("ante la duda,
        // emitir"). Sin este 9° argumento explícito, `confirmarVisitasVencidasEnCola` caía a su
        // default (`UMBRAL_ANUNCIO_PROXIMIDAD_MS`, 90 s, ver `decidir-anuncio.ts`) — una visita
        // hecha MENOS de 90 s antes de apretar "Finalizar" se confirmaba (evidencia intacta, por
        // el `umbralMs: 0` de la confirmación) pero nunca se anunciaba: el fallback de tiempo de
        // `evaluarAnuncioDeHeartbeat` la descartaba por no haber esperado el umbral de 90 s que
        // ya no tiene sentido exigir en un cierre — el chofer se queda sin la vibración/
        // notificación de "llegaste" para el último punto de su recorrido.
        const { anunciosLlegada } = await confirmarVisitasVencidasEnCola(
          db,
          deviceId,
          sesionId,
          puntosControlDetectados,
          Date.now(),
          0,
          false,
          puntosControl,
          0,
        );
        // REDISEÑO: un cierre de recorrido también puede dejar una visita sin su "llegaste" —
        // mismo camino de ejecución que `onLocation`/`onHeartbeat`.
        for (const anuncio of anunciosLlegada) {
          anunciarLlegadaPuntoControl(db, anuncio.puntoControlId, anuncio.pasada, anuncio.motivo, {
            sesionId,
            puntosControl,
          }).catch((error: unknown) => {
            Sentry.captureException(error, {
              tags: { contexto: 'gps-foreground', paso: 'anunciar-llegada-cierre' },
            });
          });
        }
      } catch (error) {
        console.error('[QUIVO][gps] No se pudo descargar las visitas pendientes al finalizar', error);
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'descargar-visitas-pendientes-fin' },
        });
      }

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
  }, [
    deviceId,
    sesionId,
    puntosControl,
    serializadorRestauracion,
    serializadorIniciar,
    estadoInicioRecorrido,
    detenerCanalVisual,
  ]);

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
    // Spike `ubicación fluida` (S1): ver el docblock de `fixesVisuales`/`setFixesVisuales` más
    // arriba. Siempre `0` fuera del spike (canal visual apagado).
    fixesVisuales,
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
    deteccionAproximacion,
    ultimoAnuncioLlegada,
    posicionActual,
    iniciar,
    detener,
    simularDeteccion,
  };
}
