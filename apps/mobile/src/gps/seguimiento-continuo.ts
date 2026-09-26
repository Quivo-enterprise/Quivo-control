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
 * REDISEÑO iniciar()/detener() (bug en producción, 2026-09-25 — reemplaza por completo al
 * `crearCoordinadorIniciarDetener` anterior, que serializaba `detener()` contra un `iniciar()`
 * en curso con un timeout acotado: `esperarIniciarConTimeout` evitaba que "Finalizar" quedara
 * colgado para siempre, pero `detener()` seguía colgándose ÉL MISMO en su propio outbox
 * — `sembrarCumplimientos`/`abrirOutbox`/`asegurarInicioRecorrido` — antes de escribir
 * `fin_recorrido`, así que el síntoma reaparecía apenas el propio cierre de `detener()` tocaba
 * SQLite trabada. Atacaba el caso equivocado.
 *
 * Premisa verificada (revisión que motiva este rediseño): "Finalizar" solo se muestra con
 * `tracking=true`, que se marca apenas `iniciarSeguimientoContinuo`/`start()` resuelve — ANTES
 * del outbox. El único cuelgue alcanzable por `detener()` es siempre la fase de outbox de un
 * `iniciar()` en curso (nunca `ready()`/`start()`, que ya tiene que haber resuelto para que el
 * botón "Finalizar" exista). El fix real: sacar el outbox del camino crítico de la UI —
 * `detener()` (`use-gps-operativo.ts`) nunca espera nada relacionado con SQLite antes de
 * devolver el control al chofer; el cierre real del recorrido (`cerrarRecorridoEnOutbox`,
 * `cierre-recorrido.ts`) corre después, en una tarea de fondo, sin bloquear nada.
 *
 * Este módulo pasa a cubrir TRES mecanismos puros, sin React ni el SDK (testeables con promesas
 * de control manual y fake timers, ver `seguimiento-continuo.test.ts`):
 *
 * 1. **Single-flight de `iniciar()`**: mientras haya un intento en curso, una llamada nueva
 *    reusa la MISMA promesa en vez de arrancar un `ejecutarIniciar` en paralelo — elimina de
 *    raíz la carrera A/B (dos intentos de `iniciar()` corriendo a la vez) que motivaba las
 *    generaciones "más nueva que…" del diseño anterior.
 * 2. **Single-flight de `detener()`**: mismo mecanismo, para el propio `detener()`.
 * 3. **Invalidación de un `iniciar()` en curso**: `detener()` llama `invalidarEnCurso()`
 *    SIN esperar nada — es sync, nunca bloquea — para que, si hay un `iniciar()` todavía en
 *    vuelo (colgado en su propio outbox), sepa que ya no debe tocar `tracking`/estado React al
 *    resolver (tarde o no). Con el single-flight de (1) garantizado, esta invalidación NUNCA
 *    necesita distinguir "generación más nueva" de "vigente": solo puede existir UN intento de
 *    `iniciar()` en curso a la vez, así que "vigente" es simplemente "no invalidado todavía".
 */
export interface CoordinadorIniciarDetener {
  /** Devuelve la promesa del `iniciar()` en curso, o `null` si no hay ninguno — el wrapper
   * `iniciar()` (`use-gps-operativo.ts`) llama esto PRIMERO: si no es `null`, reusa esa promesa
   * (single-flight) en vez de arrancar `ejecutarIniciar` de nuevo. */
  promesaIniciarEnCurso(): Promise<void> | null;
  /** Sync — llamar SOLO cuando `promesaIniciarEnCurso()` es `null`, al arrancar un intento
   * REAL de `iniciar()`, para obtener la generación de ESE intento. */
  nuevaGeneracion(): number;
  /** Registra la promesa de ESE intento como "en curso" (single-flight) — se limpia sola al
   * resolver (éxito o rechazo). `generacion` es la que devolvió `nuevaGeneracion()` para ESE
   * mismo intento. */
  registrarPromesaIniciar(promesa: Promise<void>, generacion: number): void;
  /** `true` si `generacion` sigue siendo la del intento de `iniciar()` en curso Y no fue
   * invalidada por un `detener()`. `ejecutarIniciar` la chequea DESPUÉS de cada `await` —
   * incluidos permisos, `generarEventId`, `ready`, `start`, outbox — antes de cualquier paso
   * con efecto. */
  estaVigente(generacion: number): boolean;
  /** `detener()` llama esto ANTES de tocar nada más (nativo, suscripciones, outbox, estado) —
   * SIN esperar ni un microtask. Invalida el `iniciar()` en curso, si lo hay; no-op si no hay
   * ninguno. A diferencia del diseño anterior, no hay timeout que esperar: la invalidación es
   * inmediata porque `detener()` nunca espera al `iniciar()` en curso. */
  invalidarEnCurso(): void;
  /** `true` si hay un `iniciar()` en curso cuya generación YA fue invalidada por un
   * `detener()` — la UI (`use-gps-operativo.ts`/`operation-screen.tsx`) lo usa para distinguir
   * "Iniciando…" (intento fresco, todavía vigente) de "Guardando recorrido anterior…" (intento
   * invalidado que sigue colgado en su propio outbox, bloqueando el single-flight de (1) hasta
   * que por fin resuelva). */
  iniciarEnCursoInvalidado(): boolean;
  /** Devuelve la promesa del `detener()` en curso, o `null` — mismo mecanismo single-flight
   * que `promesaIniciarEnCurso()`, para el wrapper `detener()`. */
  promesaDetenerEnCurso(): Promise<void> | null;
  /** Registra la promesa de `detener()` como "en curso" (single-flight) — se limpia sola al
   * resolver. */
  registrarPromesaDetener(promesa: Promise<void>): void;
}

export function crearCoordinadorIniciarDetener(): CoordinadorIniciarDetener {
  let ultimaGeneracion = 0;
  let invalidada = false;
  let promesaIniciar: Promise<void> | null = null;
  let promesaDetener: Promise<void> | null = null;

  return {
    promesaIniciarEnCurso(): Promise<void> | null {
      return promesaIniciar;
    },
    nuevaGeneracion(): number {
      ultimaGeneracion += 1;
      invalidada = false;
      return ultimaGeneracion;
    },
    registrarPromesaIniciar(promesa: Promise<void>, _generacion: number): void {
      // F (hallazgos 9/10, limpieza): antes se guardaba también `generacionPromesaIniciar` para
      // compararla contra `ultimaGeneracion` en `iniciarEnCursoInvalidado()` — con el
      // single-flight garantizado (nunca hay un `nuevaGeneracion()` nuevo mientras
      // `promesaIniciar` siga sin resolver, ver el wrapper `iniciar()` en `use-gps-operativo.ts`)
      // esa comparación nunca podía dar `true` en la práctica: doble generación redundante. Lo
      // único que `iniciarEnCursoInvalidado()` necesita es identidad de promesa (¿hay una
      // registrada?) + el flag `invalidada`. Se conserva `generacion` en la firma pública
      // (`CoordinadorIniciarDetener`) porque `ejecutarIniciar` sigue necesitándola para su
      // propio `sigueVigente()` vía `estaVigente(generacion)`.
      promesaIniciar = promesa;
      void promesa.finally(() => {
        if (promesaIniciar === promesa) {
          promesaIniciar = null;
        }
      });
    },
    estaVigente(generacionAEvaluar: number): boolean {
      return generacionAEvaluar === ultimaGeneracion && !invalidada;
    },
    invalidarEnCurso(): void {
      invalidada = true;
    },
    iniciarEnCursoInvalidado(): boolean {
      return promesaIniciar !== null && invalidada;
    },
    promesaDetenerEnCurso(): Promise<void> | null {
      return promesaDetener;
    },
    registrarPromesaDetener(promesa: Promise<void>): void {
      promesaDetener = promesa;
      void promesa.finally(() => {
        if (promesaDetener === promesa) promesaDetener = null;
      });
    },
  };
}

/**
 * Punto 3 del rediseño (`use-gps-operativo.ts`, `detener()`): `BackgroundGeolocation.stop()`
 * acotado con un timeout.
 *
 * C (hallazgos de revisión 4/5, 2026-09-25 — corrige el rediseño anterior): un `stop()` que
 * rechaza o vence NO significa "GPS detenido" — el nativo puede seguir grabando de verdad. La
 * versión anterior de este módulo dejaba que el llamador tratara `ok:false` como un simple
 * diagnóstico y de todos modos marcara `tracking=false`/removiera suscripciones/escribiera
 * `fin_recorrido` — un recorrido que el chofer ve "Finalizado" en pantalla mientras el SDK nativo
 * sigue grabando en su propia base, sin ninguna suscripción JS copiando esos puntos al outbox.
 * Ahora `detener()` (`use-gps-operativo.ts`) trata `ok:false` como lo que es: el stop NO se pudo
 * confirmar, así que no toca nada de lo anterior y deja "Finalizar" disponible para reintentar.
 *
 * `promesaAsentada`: la promesa CRUDA de `sdk.stop()`, normalizada para nunca rechazar —
 * expuesta aparte del resultado con timeout para que el llamador la registre en
 * `SerializadorRestauracion` (mismo slot que usa `restaurarComportamientoNormal`). Un `stop()`
 * que venció el timeout puede seguir resolviendo tarde contra el nativo; si el chofer reintenta
 * "Finalizar" con éxito y después toca "Iniciar" de nuevo, ese `stop()` tardío no puede tener
 * permitido apagar el recorrido NUEVO al resolver — el próximo `iniciar()` espera esta promesa
 * (vía `esperarPendiente()`) antes de `ready()/start()`.
 */
export const TIMEOUT_STOP_NATIVO_MS = 5_000;

export interface SdkDetenerNativo {
  stop: () => Promise<unknown>;
}

export interface ResultadoStopNativo {
  ok: boolean;
  error?: unknown;
  /** Ver docblock de arriba — nunca rechaza. */
  promesaAsentada: Promise<void>;
}

export async function detenerNativoConTimeout(
  sdk: SdkDetenerNativo,
  timeoutMs: number = TIMEOUT_STOP_NATIVO_MS,
): Promise<ResultadoStopNativo> {
  let idTimer: ReturnType<typeof setTimeout> | undefined;
  const promesaTimeout = new Promise<'timeout'>((resolve) => {
    idTimer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const promesaStopNormalizada = sdk.stop().then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  );
  // Nunca rechaza — es solo la señal de "el stop nativo, tarde o temprano, se asentó", sin
  // importar si terminó en éxito o error. El llamador la usa para serializar el PRÓXIMO
  // `iniciar()` detrás de ella, no para saber cómo terminó.
  const promesaAsentada: Promise<void> = promesaStopNormalizada.then(() => undefined);
  try {
    const resultado = await Promise.race([promesaStopNormalizada, promesaTimeout]);
    if (resultado === 'timeout') {
      return {
        ok: false,
        error: new Error('Timeout deteniendo BackgroundGeolocation'),
        promesaAsentada,
      };
    }
    if (resultado.ok) return { ok: true, promesaAsentada };
    return { ok: false, error: resultado.error, promesaAsentada };
  } finally {
    if (idTimer !== undefined) clearTimeout(idTimer);
  }
}

/**
 * A (hallazgos de revisión 1, 2, 7, 2026-09-25): cuerpo PURO del wrapper público `iniciar()`
 * (`use-gps-operativo.ts`) — extraído para poder testear con fake timers/promesas de control
 * manual, sin React. Encapsula la regla que corrige el bug: si el `iniciar()` en curso YA fue
 * invalidado por un `detener()` (`coordinador.iniciarEnCursoInvalidado()`) pero sigue sin
 * resolver, no se reusa tal cual como el intento "actual" — eso lo perdía (un intento invalidado
 * nunca deja `tracking=true`, ver `sigueVigente()` en `ejecutarIniciar`). En vez de eso se espera
 * a que ESE intento termine de asentarse y se arranca uno fresco.
 *
 * `ejecutarIntento(generacion)` es `ejecutarIniciar` en producción (o un fake en los tests) — su
 * promesa se considera "completa" apenas resuelve, sin importar qué siga corriendo desacoplado
 * dentro de ella (la fase 2 del outbox, ver el docblock de `ejecutarIniciar`).
 */
export async function iniciarConSingleFlight(
  coordinador: CoordinadorIniciarDetener,
  ejecutarIntento: (generacion: number) => Promise<void>,
): Promise<void> {
  for (;;) {
    let promesa = coordinador.promesaIniciarEnCurso();
    if (promesa && coordinador.iniciarEnCursoInvalidado()) {
      await promesa;
      continue; // el intento invalidado ya se asentó — arrancar uno nuevo, no reusarlo.
    }
    if (!promesa) {
      const generacion = coordinador.nuevaGeneracion();
      promesa = ejecutarIntento(generacion);
      coordinador.registrarPromesaIniciar(promesa, generacion);
    }
    await promesa;
    return;
  }
}
