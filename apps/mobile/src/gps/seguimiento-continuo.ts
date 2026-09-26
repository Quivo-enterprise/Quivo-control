import * as Sentry from '@sentry/react-native';

/**
 * QUI-P0 (la flecha del conductor no se mueve en el mapa — pedido explícito del CTO,
 * `docs/plan-correccion-post-piloto-2026-09-09.md`, "Principio rector"): el diagnóstico
 * encontró que `BackgroundGeolocation` arranca en modo ESTACIONARIO y nada en el repo lo saca
 * de ahí (`changePace(true)` no existía en ningún lado). En estacionario el SDK depende del
 * permiso `ACTIVITY_RECOGNITION` (Android 10+) para detectar movimiento vía acelerómetro; sin
 * ese permiso (nunca puede concederse si el manifest no lo declara — ver `app.config.ts`) cae
 * a una geocerca de 200-500 m, y `onLocation` prácticamente no dispara con el vehículo en
 * movimiento real dentro de esa geocerca. Reporte de campo del CTO (2026-09-11, probado en
 * varios teléfonos): "Al activar el recorrido hace focus en mi ubicación y aparezco, pero
 * JAMÁS se mueve la flecha... Finalizo el recorrido, vuelvo a iniciar y hace lo mismo que la
 * primera vez" — confirma que el fix tiene que aplicarse en CADA arranque (no solo la primera
 * vez que se instala la app ni solo al primer `iniciar()` de la sesión).
 *
 * Funciones PURAS (sin importar `react-native-background-geolocation` en runtime, mismo
 * espíritu que `permiso-ubicacion.ts`/`geofence.ts`): reciben el subconjunto de la API del SDK
 * que necesitan vía parámetro, así que son testeables en Node/vitest con mocks simples, sin
 * levantar React Native ni el módulo nativo. `use-gps-operativo.ts` es el único lugar que las
 * conecta con el `BackgroundGeolocation` real.
 */

/** Subconjunto de `BackgroundGeolocationAPI` (`@transistorsoft/background-geolocation-types`
 * 5.2.2, `core/api/BackgroundGeolocation.d.ts`) que este módulo necesita. Se declara acá en vez
 * de importar el tipo completo del SDK para no acoplar este módulo puro a esa dependencia y
 * para que los tests puedan pasar objetos mock mínimos sin cumplir la interfaz entera. Las
 * firmas están copiadas literal del `.d.ts` instalado (confirmado en el repo,
 * `node_modules/.pnpm/@transistorsoft+background-geolocation-types@5.2.2/...`):
 * `start(): Promise<State>`, `changePace(isMoving: boolean): Promise<State>`,
 * `setConfig(config: Partial<Config>): Promise<State>`. */
export interface SdkSeguimientoContinuo {
  start: () => Promise<unknown>;
  changePace: (isMoving: boolean) => Promise<unknown>;
  setConfig: (config: { activity?: { disableStopDetection?: boolean } }) => Promise<unknown>;
  /** `State.isMoving` — la única forma de LEER lo que el plugin cree que está pasando AHORA,
   * sin esperar a que dispare un evento. La necesita `reafirmarMovimientoSiEstacionario` (ver
   * su docblock, más abajo) para el gap G1 (merge post-drenado, Entrega 31a). */
  getState: () => Promise<{ isMoving: boolean }>;
}

/**
 * Re-arranca el estado "moving" y la política de no-detección-de-parada. Separada de
 * `iniciarSeguimientoContinuo` (que además llama `start()`) porque hay UN SEGUNDO punto de
 * entrada que la necesita sin volver a arrancar el plugin: el re-enganche de
 * `use-gps-operativo.ts` cuando el chofer mata la app a mitad de turno y la reabre con el SDK
 * nativo ya `enabled` (`stopOnTerminate: false`) — ese camino nunca pasa por `iniciar()`, así
 * que sin este segundo punto de entrada el freeze reaparecería exactamente en el escenario que
 * más le costó al piloto (matar la app "para que se actualice").
 *
 * `setConfig({ activity: { disableStopDetection: true } })` es la defensa ESTRUCTURAL contra
 * volver a estacionario en medio de un recorrido: según la doc del SDK (`State.d.ts`,
 * `disableStopDetection` > Android), en Android "prevendrá que los location-services se
 * apaguen automáticamente alguna vez", y pone en manos de la app decidir cuándo apagarlos
 * (`changePace(false)`/`stop()`) — que es justo lo que hace `restaurarComportamientoNormal`
 * más abajo cuando el recorrido termina. Ya está también horneado como default estático en
 * `gpsSpikeConfig.activity` (`background-geolocation.config.ts`) para que aplique desde el
 * primer `ready()`; se reafirma acá explícitamente (no confiar solo en el default persistido)
 * porque este mismo código corre en dispositivos que YA tenían el plugin instalado con una
 * versión vieja de la config (el piloto), y `setConfig` es la única llamada que garantiza que
 * el valor nuevo pisa lo que haya quedado persistido nativamente de antes.
 *
 * TRADEOFF DE BATERÍA (a propósito, documentado — pedido explícito del CTO: seguimiento
 * continuo tipo Google Maps, no del tipo "se apaga solo si no me muevo"): con
 * `disableStopDetection: true` el GPS sigue prendido durante paradas largas (semáforo, control,
 * layover) en vez de bajar a la geocerca de bajo consumo. Es el costo aceptado para que el
 * marcador nunca se congele — el criterio A del GO (< 5% batería/jornada) sigue siendo lo que
 * mide si el costo real es sostenible en una jornada de 8h, no algo que este cambio decida por
 * su cuenta.
 */
export async function reafirmarMovimiento(
  sdk: Pick<SdkSeguimientoContinuo, 'changePace' | 'setConfig'>,
): Promise<void> {
  // `changePace(true)` primero: es la señal que le importa al conductor AHORA (motor de
  // tracking agresivo encendido de inmediato). `setConfig` después: fija la política para que
  // ese estado no se revierta solo más tarde. Si `setConfig` fallara, `changePace` ya corrió —
  // preferible a que un error de config bloquee el efecto inmediato que el chofer sí nota.
  await sdk.changePace(true);
  await sdk.setConfig({ activity: { disableStopDetection: true } });
}

/**
 * Arranca el tracking nativo y fuerza moving+no-stop-detection de entrada.
 *
 * ORDEN CRÍTICO (test cubre esto explícitamente): `start()` SIEMPRE antes que
 * `changePace`/`setConfig`. Invertirlo llamaría a esos métodos contra un plugin que todavía no
 * está `enabled` — la doc del SDK no documenta ese caso (todos los ejemplos de `changePace`
 * asumen el plugin ya arrancado), así que en vez de asumir que es inocuo, se respeta el orden
 * que si está documentado: `ready()` → `start()` → (opcionalmente) `changePace`.
 *
 * SIN GUARDA DE "SOLO LA PRIMERA VEZ": esta función corre en CADA `iniciar()`, incluido un
 * segundo/tercer recorrido en la misma sesión tras `finalizar()` — el reporte de campo del CTO
 * confirma que el freeze se repite igual en el segundo arranque, así que la re-afirmación de
 * movimiento tiene que ser incondicional en cada arranque, nunca "ya se hizo una vez, no hace
 * falta de nuevo".
 *
 * RIESGO 1 (`/codex-debug verify-fix` sobre la Entrega 31a — `use-gps-operativo.ts` llamaba a
 * esta función dentro de un único `try/catch` que trataba CUALQUIER rechazo, `start()` o
 * `reafirmarMovimiento`, como "no se pudo iniciar el recorrido": removía las suscripciones y
 * dejaba `tracking=false` en la UI aun cuando `start()` ya había arrancado el SDK nativo — el
 * GPS (y el headless task) seguían grabando en la base nativa del plugin sin que la app tuviera
 * forma de detenerlos. La distinción que importa es esta: `start()` es la única llamada de la
 * que depende si hay algo grabándose; `reafirmarMovimiento` es solo la puesta a punto de la
 * política de movimiento sobre un plugin que YA está grabando. Por eso acá adentro (no en el
 * llamador) un fallo de `reafirmarMovimiento` se reporta a Sentry y se ABSORBE — nunca se deja
 * subir como rechazo de `iniciarSeguimientoContinuo` — así el `try/catch` de
 * `use-gps-operativo.ts` sigue disparando SOLO ante un fallo real de `start()` (comportamiento
 * sin cambios: nada grabándose, subscripciones fuera, `tracking=false`) y jamás ante este otro
 * caso, donde el recorrido sigue activo de verdad. No hace falta reintentar `changePace` desde
 * acá: `crearManejadorReafirmarMovimiento`, ya suscrito a `onMotionChange` en cada arranque
 * (`use-gps-operativo.ts`), vuelve a intentarlo apenas el SDK reporte el próximo cambio de
 * movimiento — la reafirmación fallida no queda sin reintento, solo demorada al próximo evento.
 */
export async function iniciarSeguimientoContinuo(sdk: SdkSeguimientoContinuo): Promise<void> {
  await sdk.start();
  try {
    await reafirmarMovimiento(sdk);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'gps-foreground', paso: 'iniciar-reafirmar-movimiento' },
    });
  }
}

/**
 * Restaura la política de stop-detection normal del SDK al finalizar el recorrido — el reverso
 * de `reafirmarMovimiento`. `detener()` (`use-gps-operativo.ts`) ya llama `BackgroundGeolocation
 * .stop()`, que por sí solo apaga el tracking; esta llamada además deja la CONFIG persistida en
 * su valor por defecto (`disableStopDetection: false`) para que un futuro re-enganche o
 * inspección de estado no encuentre la política "nunca apagar el GPS" activa fuera de un
 * recorrido real. Best-effort: un fallo acá no debe impedir que `detener()` complete su cierre
 * (outbox, veredicto) — el llamador decide cómo tratar el error (ver `use-gps-operativo.ts`).
 */
export async function restaurarComportamientoNormal(
  sdk: Pick<SdkSeguimientoContinuo, 'setConfig'>,
): Promise<void> {
  await sdk.setConfig({ activity: { disableStopDetection: false } });
}

/**
 * G1 (merge post-drenado, Entrega 31a — gap de revisión sobre esta misma entrega): defensa que
 * NO depende de `onMotionChange`. `crearManejadorReafirmarMovimiento` (más abajo) es la defensa
 * en profundidad "oficial" contra un `changePace(true)` que falló en silencio (absorbido por
 * `iniciarSeguimientoContinuo`, ver su docblock) — pero depende de que el SDK EMITA el evento
 * `onMotionChange`, y ese evento nativo usa el sensor de actividad de Android
 * (`ACTIVITY_RECOGNITION`, Android 10+): con el permiso denegado (el chofer lo puede negar sin
 * que nada en la app lo bloquee, ver `permiso-actividad.ts`) el plugin puede quedar sin ningún
 * disparador que note que sigue estacionario, y el freeze original (la flecha no se mueve)
 * reaparece exactamente por la vía que este módulo existe para cerrar.
 *
 * Esta función en cambio LEE el estado real (`getState().isMoving`) desde dos puntos que
 * ocurren SIEMPRE, con o sin ese permiso: el heartbeat del SDK (cada 60 s,
 * `background-geolocation.config.ts`) y el regreso a foreground
 * (`crearManejadorForegroundActivo`, abajo). Si el recorrido sigue activo (`estaEnRecorrido`) y
 * el plugin reporta `isMoving: false`, vuelve a correr `reafirmarMovimiento` — el mismo
 * `changePace(true)` + `setConfig(disableStopDetection: true)` que ya usa
 * `iniciarSeguimientoContinuo`. Nunca reafirma fuera de un recorrido (`estaEnRecorrido() ===
 * false`): no hay nada que defender ahí, mismo criterio que
 * `crearManejadorReafirmarMovimiento`.
 */
export async function reafirmarMovimientoSiEstacionario(
  sdk: Pick<SdkSeguimientoContinuo, 'changePace' | 'setConfig' | 'getState'>,
  estaEnRecorrido: () => boolean,
): Promise<void> {
  if (!estaEnRecorrido()) return;
  const estado = await sdk.getState();
  if (estado.isMoving) return;
  await reafirmarMovimiento(sdk);
}

/**
 * Handler de `AppState` para el punto 4 del brief: con un recorrido en curso, volver a
 * primer plano no debe dejar el marcador con un fix viejo hasta el próximo evento natural del
 * SDK — pide una posición fresca de inmediato. Devuelve el propio handler (factory) en vez de
 * ejecutar nada acá: así queda testeable con un mock de `getCurrentPosition` y un
 * `estaEnRecorrido` fijo, sin necesitar `AppState` real ni React.
 *
 * `samples: 1, persist: true` — mismo patrón que ya usa el heartbeat de
 * `use-gps-operativo.ts` (`suscribirUbicaciones`): un solo fix (no 3, el default) para no
 * demorar de más, persistido como evidencia real del recorrido (mismo criterio que la
 * inmediata al iniciar — ver `use-gps-operativo.ts`). `getCurrentPosition` dispara `onLocation`
 * igual que cualquier otro fix (confirmado en la doc del SDK: "Every location recorded by the
 * SDK is provided to your callback, including those from onMotionChange, getCurrentPosition and
 * watchPosition"), así que el marcador se actualiza por el mismo camino de siempre — no hace
 * falta setear `posicionActual` acá.
 *
 * RIESGO 2 (`/codex-debug verify-fix`): `getCurrentPosition` puede rechazar (timeout nativo,
 * GPS momentáneamente sin señal) y antes esa promesa quedaba suelta sin `catch` — un rechazo
 * sin manejar, y además ningún rastro de que el fix forzado al volver a primer plano falló. Se
 * encadena `.catch()` (nunca `await`: el handler de `AppState` tiene que devolver sincrónico,
 * igual que antes) que reporta a Sentry con un tag que identifica este handler puntual.
 *
 * G1 (merge post-drenado, Entrega 31a): además del fix inmediato de arriba, este handler ahora
 * también corre `reafirmarMovimientoSiEstacionario` — el regreso a foreground es, junto con el
 * heartbeat, uno de los dos puntos que NO dependen de `onMotionChange`/`ACTIVITY_RECOGNITION`
 * (ver el docblock de esa función). Va en su propia promesa `.catch()`-eada, independiente de
 * la de `getCurrentPosition` de arriba: un fallo de una no debe impedir el intento de la otra.
 */
export function crearManejadorForegroundActivo(
  sdk: Pick<SdkSeguimientoContinuo, 'changePace' | 'setConfig' | 'getState'> & {
    getCurrentPosition: (opts: { samples: number; persist: boolean }) => Promise<unknown>;
  },
  estaEnRecorrido: () => boolean,
): (estadoApp: string) => void {
  return (estadoApp: string) => {
    if (estadoApp === 'active' && estaEnRecorrido()) {
      void sdk.getCurrentPosition({ samples: 1, persist: true }).catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'foreground-activo-getCurrentPosition' },
        });
      });
      void reafirmarMovimientoSiEstacionario(sdk, estaEnRecorrido).catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'foreground-activo-reafirmar-movimiento' },
        });
      });
    }
  };
}

/**
 * Handler de `onMotionChange` — defensa EN PROFUNDIDAD, no el mecanismo primario (ese es
 * `disableStopDetection: true`, ver `reafirmarMovimiento`). Documentado en el diseño original
 * como fallback "si v5 no permite desactivar la detección de parada por config" — v5 SÍ lo
 * permite en Android (confirmado arriba), así que en el camino normal este handler no debería
 * tener nada que hacer. Se deja igual, activo, por si algún fabricante (el reporte de campo es
 * de un Samsung Galaxy A71, conocido por gestión de batería agresiva que a veces no respeta la
 * config estándar del framework) empuja el plugin a estacionario pese a la config: si eso pasa
 * mientras hay un recorrido activo, reafirma `changePace(true)` de inmediato en vez de esperar
 * a que algo más lo note.
 *
 * RIESGO 2 (`/codex-debug verify-fix`): mismo problema que `crearManejadorForegroundActivo` de
 * arriba — `changePace` puede rechazar (el mismo escenario Samsung Galaxy A71 de gestión de
 * batería agresiva documentado arriba es justo el que más probablemente lo haga fallar) y la
 * promesa quedaba suelta sin `catch`. Se reporta a Sentry con un tag propio para poder
 * distinguirlo en el dashboard del fallo del handler de foreground.
 */
export function crearManejadorReafirmarMovimiento(
  sdk: Pick<SdkSeguimientoContinuo, 'changePace'>,
  estaEnRecorrido: () => boolean,
): (event: { isMoving: boolean }) => void {
  return (event: { isMoving: boolean }) => {
    if (!event.isMoving && estaEnRecorrido()) {
      void sdk.changePace(true).catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'motion-change-reafirmar-movimiento' },
        });
      });
    }
  };
}

/**
 * R1 (merge post-drenado, Entrega 31a — gap de revisión): serializa una restauración de config
 * en vuelo (`detener()`, `restaurarComportamientoNormal`) con el PRÓXIMO arranque (`iniciar()`,
 * `reafirmarMovimiento`/`iniciarSeguimientoContinuo`).
 *
 * EL RIESGO que esto cierra: `detener()` dispara `restaurarComportamientoNormal`
 * (`setConfig({disableStopDetection: false})`) sin esperarlo — a propósito, para no demorar el
 * cierre del recorrido (outbox, veredicto). Si el chofer vuelve a tocar "Iniciar" ANTES de que
 * ese `setConfig` termine de aplicarse contra el nativo, esa llamada podía resolver DESPUÉS del
 * `setConfig({disableStopDetection: true})` del nuevo `iniciar()` — pisando, por orden de
 * llegada al nativo y no por intención, la política "true" del recorrido que sí está activo
 * con un "false" que ya no aplica a nada. El síntoma sería el freeze original (la flecha no se
 * mueve) reapareciendo en un segundo recorrido iniciado muy rápido tras el anterior.
 *
 * `crearSerializadorRestauracion` es un slot de UNA sola promesa "en vuelo" — `registrar` la
 * guarda (y la limpia sola cuando resuelve, salvo que ya haya sido reemplazada por una más
 * nueva, ver el comentario en `registrar`), y `esperarPendiente` es lo que el próximo
 * `iniciar()` llama ANTES de reafirmar movimiento para garantizar el orden. Pura (sin React,
 * sin el SDK): un slot de estado + dos funciones, testeable con promesas de control manual.
 * `use-gps-operativo.ts` crea UNA instancia por hook (vive en un `useRef`, mismo ciclo de vida
 * que `trackingRef`) y la usa desde `detener()`/`iniciar()`.
 */
export interface SerializadorRestauracion {
  /** Registra una promesa "en vuelo" — reemplaza cualquier registro anterior sin esperarlo
   * (si `detener()` corriera dos veces seguidas, cosa que no debería pasar en la práctica, la
   * más nueva gana). Al resolver (éxito o fallo, `finally`), se limpia sola SOLO si nadie la
   * reemplazó ni la consumió mientras tanto — evita que una limpieza tardía borre el registro
   * de una promesa más nueva que la reemplazó. */
  registrar(promesa: Promise<void>): void;
  /** Si hay una promesa registrada, la espera y limpia el registro; si no hay ninguna, resuelve
   * de inmediato. Después de esta llamada, el slot siempre queda vacío. */
  esperarPendiente(): Promise<void>;
}

export function crearSerializadorRestauracion(): SerializadorRestauracion {
  let enCurso: Promise<void> | null = null;

  return {
    registrar(promesa: Promise<void>): void {
      enCurso = promesa;
      void promesa.finally(() => {
        if (enCurso === promesa) enCurso = null;
      });
    },
    async esperarPendiente(): Promise<void> {
      if (enCurso) {
        await enCurso;
        enCurso = null;
      }
    },
  };
}

/**
 * MEDIO (hallazgo de revisión, QUI-247): alias genérico de `crearSerializadorRestauracion` —
 * el mecanismo (una promesa "en vuelo" que un consumidor posterior espera antes de proceder)
 * no es exclusivo de la restauración de `disableStopDetection`. `use-gps-operativo.ts` lo
 * reusa para una SEGUNDA instancia independiente que serializa `detener()` contra un
 * `iniciar()` en curso: antes de este fix, `tracking` pasaba a `true` apenas resolvía
 * `start()` (bien antes de que `inicio_recorrido` se escribiera al outbox, que espera la
 * semilla de cumplimientos + `abrirOutbox()` — puede tardar segundos), y `next-control-
 * sheet.tsx` ya ofrecía "FINALIZAR RUTA" en esa ventana. Un toque rápido Iniciar→Finalizar
 * hacía que `detener()` escribiera `fin_recorrido` ANTES de que el `iniciar()` en vuelo
 * terminara de escribir `inicio_recorrido` — reconstrucción de recorrido rota (fin sin
 * inicio) — y además el `trackingRef = false` de `detener()` podía pisar el `trackingRef =
 * true` que el `iniciar()` en vuelo todavía no había asignado. `detener()` ahora llama
 * `esperarPendiente()` de ESTA instancia ANTES de tocar nada (nativo, suscripciones, outbox,
 * estado), así que el orden `inicio_recorrido < fin_recorrido` queda garantizado siempre, sin
 * importar qué tan rápido se toquen los dos botones. Misma implementación exacta, sin
 * acoplar los dos usos entre sí (dos instancias, un `useRef` cada una en el hook).
 */
export const crearSerializadorPromesaEnCurso = crearSerializadorRestauracion;
export type SerializadorPromesaEnCurso = SerializadorRestauracion;

/**
 * BUG EN PRODUCCIÓN (hallazgo 2026-09-25): `detener()` (`use-gps-operativo.ts`) esperaba el
 * `iniciar()` en curso vía `serializadorIniciar.esperarPendiente()` (el alias de arriba,
 * `crearSerializadorPromesaEnCurso`) SIN ningún límite de tiempo. Si `iniciar()` se cuelga
 * (`abrirOutbox()` contra una SQLite corrupta, o `BackgroundGeolocation.ready()`/`.start()`
 * trabado contra el nativo), "Finalizar recorrido" quedaba esperando esa promesa PARA SIEMPRE:
 * el botón dejaba de responder, sin mensaje ni reintento, y sin forma de cerrar el recorrido
 * salvo matar la app.
 *
 * `crearCoordinadorIniciarDetener` reemplaza, PARA ESTE USO PUNTUAL (la instancia
 * `serializadorIniciar` de `use-gps-operativo.ts` — `serializadorRestauracion`, la otra
 * instancia del alias de arriba, sigue igual: no tiene este problema porque nadie más la
 * espera con el chofer bloqueado de por medio), al `crearSerializadorPromesaEnCurso` de
 * arriba. Mismo slot de "promesa en vuelo" en su núcleo, con dos capacidades nuevas:
 *
 * 1. **Timeout acotado** (`esperarIniciarConTimeout`, `TIMEOUT_ESPERA_INICIAR_MS` = 10 s): si
 *    el `iniciar()` en curso no resuelve dentro del plazo, `detener()` sigue igual con el
 *    cierre del recorrido (parar el SDK, marcar `tracking=false`, escribir `fin_recorrido`) —
 *    "Finalizar" tiene que responder siempre, sin importar en qué haya quedado trabado
 *    `iniciar()`.
 * 2. **Generación de cancelación** (`nuevaGeneracion`/`estaVigente`): evita la carrera inversa —
 *    si el `iniciar()` colgado resuelve DESPUÉS de que `detener()` ya se cansó de esperarlo, no
 *    debe dejar el tracking arrancado. Vencido el timeout, la generación de ESE intento queda
 *    invalidada; `ejecutarIniciar` (`use-gps-operativo.ts`) chequea `estaVigente(generacion)`
 *    justo ANTES de sus pasos con efecto (arrancar el SDK, marcar `tracking` activo) y aborta
 *    sin tocarlos si ya no es la generación vigente.
 *
 * H1 (hallazgo de revisión CRÍTICO, 2026-09-25 — revisión de esta misma entrega): la
 * invalidación por generación de arriba no alcanzaba sola. Un intento invalidado (por timeout, o
 * por un `iniciar()` más nuevo) seguía limpiando/tocando estado COMPARTIDO cuando por fin
 * resolvía tarde (`subscription.current`/`heartbeatSubscription.current`/
 * `motionChangeSubscription.current`, `tracking`/`trackingRef`, `BackgroundGeolocation.stop()`):
 * si para entonces un `iniciar()` más nuevo ya estaba corriendo, el intento viejo le removía las
 * suscripciones, le paraba el SDK y/o le pisaba `tracking` al nuevo. El fix vive en
 * `use-gps-operativo.ts` (`ejecutarIniciar` captura los handles que ÉL MISMO instaló al
 * suscribirse y limpia solo esos, nunca los refs compartidos a ciegas) apoyado en dos
 * capacidades nuevas de este coordinador: `hayIntentoMasNuevo` (para no llamar `stop()` sobre el
 * SDK de un intento más nuevo) y la separación entre "vigente" (`estaVigente`, afectada por
 * timeout) y "la generación más nueva que existió" (`hayIntentoMasNuevo`, no afectada por
 * timeout). Ver el docblock de `CoordinadorIniciarDetener.hayIntentoMasNuevo` arriba.
 *
 * L1 (hallazgo de revisión, 2026-09-25): `esperarIniciarConTimeout` limpia su propio registro
 * (`enCurso`/`generacionEnCurso`) al vencer el timeout, no solo cuando la promesa colgada
 * finalmente resuelve — un segundo `detener()` inmediato no debe volver a esperar 10 s por el
 * mismo intento ya dado por perdido.
 *
 * Pura, sin React ni el SDK — testeable con promesas de control manual y fake timers (ver
 * `seguimiento-continuo.test.ts`).
 */
export const TIMEOUT_ESPERA_INICIAR_MS = 10_000;

export interface CoordinadorIniciarDetener {
  /** Sync — llamar al arrancar CADA `iniciar()`, antes de invocar la función real
   * (`ejecutarIniciar` en `use-gps-operativo.ts`), para obtener la generación de ESE intento. */
  nuevaGeneracion(): number;
  /** Registra la promesa de ESE intento como "en curso" — lo que `esperarIniciarConTimeout`
   * espera desde `detener()`. `generacion` es la que devolvió `nuevaGeneracion()` para ESE
   * mismo intento (hallazgo H1, ver más abajo: hace falta saber a qué generación pertenece la
   * promesa en curso para poder invalidar SOLO esa al vencer el timeout). */
  registrarPromesaEnCurso(promesa: Promise<void>, generacion: number): void;
  /** `true` si `generacion` sigue siendo la del intento de `iniciar()` más reciente Y no fue
   * invalidada — `false` si un `detener()` posterior se cansó de esperarla (timeout) o si otro
   * `iniciar()` ya arrancó encima. Chequear ANTES de cada paso con efecto. */
  estaVigente(generacion: number): boolean;
  /**
   * H1 (hallazgo de revisión CRÍTICO, 2026-09-25): `true` si ya existe un `iniciar()` MÁS
   * NUEVO que `generacion` (`nuevaGeneracion()` corrió de nuevo después) — a diferencia de
   * `estaVigente`, ignora la invalidación por timeout. Un intento invalidado por timeout pero
   * sin ningún `iniciar()` posterior sigue siendo "el más nuevo que existió": es seguro que
   * termine de apagar lo que él mismo prendió (`BackgroundGeolocation.stop()`) — `detener()` ya
   * lo llamó una vez en su propio cierre, una segunda llamada es redundante pero inocua. Si en
   * cambio SÍ hay un `iniciar()` más nuevo corriendo (o ya corrido), apagar el SDK apagaría el
   * recorrido de ESE intento, no el propio: nunca debe llamarse `stop()` en ese caso. Ver el
   * escenario completo en el docblock de `use-gps-operativo.ts` (`limpiarSuscripcionesPropias`).
   */
  hayIntentoMasNuevo(generacion: number): boolean;
  /** `detener()` llama esto ANTES de tocar nada (nativo, suscripciones, outbox, estado). Si no
   * hay ningún `iniciar()` en curso, resuelve de inmediato con `{ agotado: false }`. Si lo hay,
   * espera hasta `timeoutMs`; si vence sin que resuelva, invalida su generación (punto 2 del
   * docblock de arriba) y devuelve `{ agotado: true }` para que el llamador pueda registrar el
   * caso (Sentry) antes de seguir. */
  esperarIniciarConTimeout(timeoutMs?: number): Promise<{ agotado: boolean }>;
}

export function crearCoordinadorIniciarDetener(): CoordinadorIniciarDetener {
  let enCurso: Promise<void> | null = null;
  // H1: separado de `ultimaGeneracion` — ver el docblock de `registrarPromesaEnCurso`. Necesario
  // para que, al vencer el timeout, se invalide EXACTAMENTE la generación de la promesa que
  // estaba en curso en ese momento, no "la última generación conocida" (que podría ya ser otra
  // si, por algún camino, `registrarPromesaEnCurso` se llamara más de una vez sin que la
  // anterior hubiera resuelto — no debería pasar en la práctica, pero esta separación lo hace
  // imposible de todos modos).
  let generacionEnCurso: number | null = null;
  let ultimaGeneracion = 0;
  // H1: generaciones invalidadas por un timeout de `detener()` — `estaVigente` las trata como
  // no vigentes SIN bajar `ultimaGeneracion` (que sigue siendo "la generación del intento de
  // `iniciar()` más reciente que existió", la pregunta que responde `hayIntentoMasNuevo`).
  const generacionesInvalidadas = new Set<number>();

  return {
    nuevaGeneracion(): number {
      ultimaGeneracion += 1;
      return ultimaGeneracion;
    },
    registrarPromesaEnCurso(promesa: Promise<void>, generacion: number): void {
      enCurso = promesa;
      generacionEnCurso = generacion;
      void promesa.finally(() => {
        if (enCurso === promesa) {
          enCurso = null;
          generacionEnCurso = null;
        }
      });
    },
    estaVigente(generacionAEvaluar: number): boolean {
      return (
        generacionAEvaluar === ultimaGeneracion && !generacionesInvalidadas.has(generacionAEvaluar)
      );
    },
    hayIntentoMasNuevo(generacionAEvaluar: number): boolean {
      return ultimaGeneracion > generacionAEvaluar;
    },
    async esperarIniciarConTimeout(
      timeoutMs: number = TIMEOUT_ESPERA_INICIAR_MS,
    ): Promise<{ agotado: boolean }> {
      if (!enCurso) return { agotado: false };
      const promesaEnCurso = enCurso;
      const generacionEnEspera = generacionEnCurso;
      let idTimer: ReturnType<typeof setTimeout> | undefined;
      const promesaTimeout = new Promise<'timeout'>((resolve) => {
        idTimer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      try {
        // `ejecutarIniciar` nunca rechaza en la práctica (todos sus fallos internos se atrapan
        // y se reportan a Sentry por su cuenta, ver su docblock en `use-gps-operativo.ts`), pero
        // este `.then(resuelve, resuelve)` no depende de esa garantía: cualquier resultado de
        // la promesa en vuelo (éxito o rechazo) cuenta igual como "terminó a tiempo".
        const resultado = await Promise.race([
          promesaEnCurso.then(
            () => 'resuelto' as const,
            () => 'resuelto' as const,
          ),
          promesaTimeout,
        ]);
        if (resultado === 'timeout') {
          if (generacionEnEspera !== null) generacionesInvalidadas.add(generacionEnEspera);
          // L1 (hallazgo de revisión, 2026-09-25): limpiar el registro ACÁ, no solo confiar en
          // que el `.finally()` de `registrarPromesaEnCurso` lo haga cuando la promesa colgada
          // por fin resuelva — sin esto, un SEGUNDO `detener()` disparado de inmediato (el
          // chofer reintentando el botón) encontraba `enCurso` todavía apuntando a la misma
          // promesa colgada y volvía a esperar el timeout completo por un intento que ya se dio
          // por perdido, en vez de proceder directo con el cierre.
          if (enCurso === promesaEnCurso) {
            enCurso = null;
            generacionEnCurso = null;
          }
          return { agotado: true };
        }
        if (enCurso === promesaEnCurso) {
          enCurso = null;
          generacionEnCurso = null;
        }
        return { agotado: false };
      } finally {
        if (idTimer !== undefined) clearTimeout(idTimer);
      }
    },
  };
}

/**
 * H1 (hallazgo de revisión CRÍTICO, 2026-09-25): la mitad "refs" del fix — la otra mitad es
 * `hayIntentoMasNuevo` de arriba, que decide si además corresponde `BackgroundGeolocation.stop()`.
 *
 * Extraída de `use-gps-operativo.ts` (`ejecutarIniciar`) para que sea testeable sin React: el
 * bug real era que un intento de `iniciar()` invalidado (por timeout de `detener()`, o por un
 * `iniciar()` más nuevo) limpiaba `subscription.current`/`heartbeatSubscription.current`/
 * `motionChangeSubscription.current` DIRECTAMENTE — si para cuando ese intento por fin
 * resolvía (tarde) esos refs ya pertenecían a un `iniciar()` más nuevo y activo, le removía las
 * suscripciones al recorrido que sí está corriendo.
 *
 * `instaladas` son los handles que el LLAMADOR (un intento de `iniciar()` en particular) instaló
 * él mismo (ver el valor de retorno de `suscribirUbicaciones`, `use-gps-operativo.ts`).
 * `compartidas` son los refs de React (`{current}}`) que TODOS los intentos comparten — la única
 * fuente de verdad de "qué suscripción está activa ahora mismo".
 *
 * Comportamiento: cada handle de `instaladas` se remueve incondicionalmente (idempotente — si
 * ya fue removido, p. ej. porque `detener()` ya cerró el recorrido, una segunda llamada a
 * `remove()` no tiene nada más que hacer). El ref compartido correspondiente solo se pone en
 * `null` si TODAVÍA apunta a ESE MISMO handle — si un `iniciar()` más nuevo ya lo reemplazó, se
 * deja completamente intacto (nunca se lee ni se escribe con datos de otro handle).
 */
export interface SuscripcionRemovible {
  remove: () => void;
}

export interface SuscripcionesInstaladas {
  subscription: SuscripcionRemovible;
  heartbeat: SuscripcionRemovible;
  motionChange: SuscripcionRemovible;
}

export interface RefsSuscripcionesCompartidas {
  subscription: { current: SuscripcionRemovible | null };
  heartbeat: { current: SuscripcionRemovible | null };
  motionChange: { current: SuscripcionRemovible | null };
}

export function limpiarSuscripcionesPropias(
  instaladas: SuscripcionesInstaladas,
  compartidas: RefsSuscripcionesCompartidas,
): void {
  instaladas.subscription.remove();
  if (compartidas.subscription.current === instaladas.subscription) {
    compartidas.subscription.current = null;
  }
  instaladas.heartbeat.remove();
  if (compartidas.heartbeat.current === instaladas.heartbeat) {
    compartidas.heartbeat.current = null;
  }
  instaladas.motionChange.remove();
  if (compartidas.motionChange.current === instaladas.motionChange) {
    compartidas.motionChange.current = null;
  }
}
