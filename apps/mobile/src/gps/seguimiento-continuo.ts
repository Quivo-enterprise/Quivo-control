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
  /** Registra una promesa "en vuelo" — a diferencia de la versión anterior, YA NO reemplaza a
   * la que estuviera registrada: la encadena. El nuevo slot es `Promise.all([anterior,
   * nueva])`, así que `esperarPendiente()` termina esperando a las DOS, sin importar cuál
   * resuelva primero. Necesario porque un `detener()` puede registrar un `stop()` vencido justo
   * antes de que otro camino (p. ej. un `iniciar()` invalidado que se apaga solo, ver
   * `detenerNativoYRestaurar` en `use-gps-operativo.ts`) registre su propia restauración — con
   * "la más nueva gana" (diseño anterior), la primera quedaba sin nadie que la esperara. Ambas
   * ramas del `Promise.all` están normalizadas para no rechazar nunca (`.catch()`) — un fallo
   * de cualquiera de las dos no debe tirar abajo la cadena ni la próxima `esperarPendiente()`.
   * Al resolver, se limpia sola SOLO si nadie la reemplazó ni la consumió mientras tanto — evita
   * que una limpieza tardía borre el registro de una promesa más nueva que la reemplazó. */
  registrar(promesa: Promise<void>): void;
  /** Espera TODO lo que esté registrado — incluido lo que se registre mientras esta llamada
   * sigue esperando (un `registrar()` que llega en el medio no queda afuera). Si no hay nada
   * registrado, resuelve de inmediato. Después de esta llamada, el slot queda vacío salvo que
   * algo nuevo se haya registrado en el ínterin. */
  esperarPendiente(): Promise<void>;
}

export function crearSerializadorRestauracion(): SerializadorRestauracion {
  let enCurso: Promise<void> | null = null;

  return {
    registrar(promesa: Promise<void>): void {
      const anterior = enCurso;
      const promesaNormalizada = promesa.catch(() => undefined);
      const nuevoSlot: Promise<void> = anterior
        ? Promise.all([anterior, promesaNormalizada]).then(() => undefined)
        : promesaNormalizada;
      enCurso = nuevoSlot;
      void nuevoSlot.finally(() => {
        if (enCurso === nuevoSlot) enCurso = null;
      });
    },
    async esperarPendiente(): Promise<void> {
      // Loop en vez de un solo `await`: si algo se registra MIENTRAS este `await` está en
      // vuelo, ese `registrar()` reemplaza `enCurso` por un slot nuevo (encadenado sobre el que
      // se está esperando ahora) — hay que volver a leerlo y esperar también ese slot nuevo,
      // hasta que quede estable/vacío.
      while (enCurso) {
        const slot = enCurso;
        await slot;
        if (enCurso === slot) enCurso = null;
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
   * resolver (éxito o rechazo). */
  registrarPromesaIniciar(promesa: Promise<void>): void;
  /** `true` si `generacion` sigue siendo la del intento de `iniciar()` en curso Y no fue
   * invalidada por un `detener()`. `ejecutarIniciar` la chequea DESPUÉS de cada `await` —
   * incluidos permisos, `generarEventId`, `ready`, `start`, outbox — antes de cualquier paso
   * con efecto. */
  estaVigente(generacion: number): boolean;
  /** `detener()` llama esto ANTES de tocar nada más (nativo, suscripciones, outbox, estado) —
   * SIN esperar ni un microtask. Invalida el `iniciar()` en curso, si lo hay; no-op si no hay
   * ninguno. A diferencia del diseño anterior, no hay timeout que esperar: la invalidación es
   * inmediata porque `detener()` nunca espera al `iniciar()` en curso.
   *
   * Punto 4 (hallazgo de revisión, 2026-09-25): `causa` distingue POR QUÉ se invalida — el
   * desmontaje del hook (el chofer navega fuera de la pantalla mientras `iniciar()` sigue en
   * curso) y un `detener()` real (el chofer tocó "Finalizar") necesitan tratamiento DISTINTO en
   * `ejecutarIniciar` cuando el intento invalidado, al resolver tarde, descubre que ya no es
   * vigente: un `detener()` SÍ tiene que apagar el nativo que este intento prendió (el chofer
   * pidió cerrar el recorrido); un desmontaje NO — el nativo debe seguir grabando (mismo
   * `stopOnTerminate: false` que sostiene el re-enganche cuando el chofer mata la app a mitad de
   * turno), porque un remount de la pantalla se re-engancha solo vía `getState().enabled` (ver el
   * `useEffect` de re-enganche, `use-gps-operativo.ts`) — llamar `stop()` acá cortaría un
   * recorrido que el chofer nunca pidió cerrar. Default `'detener'`: es la causa más segura —
   * un llamador que no pasa `causa` nunca deja el nativo corriendo por accidente. */
  invalidarEnCurso(causa?: 'detener' | 'desmontaje'): void;
  /** Causa de la invalidación vigente, o `null` si el intento en curso no fue invalidado. Si
   * `invalidarEnCurso()` se llama más de una vez para el mismo intento (p. ej. `detener()` y
   * luego un desmontaje, o viceversa), `'detener'` es STICKY — nunca lo pisa una invalidación por
   * `'desmontaje'` posterior, porque apagar el nativo sigue siendo lo correcto una vez que el
   * chofer ya pidió cerrar el recorrido. Se resetea a `null` en `nuevaGeneracion()`. */
  causaInvalidacion(): 'detener' | 'desmontaje' | null;
  /** `true` si hay un `iniciar()` en curso cuya generación YA fue invalidada por un
   * `detener()` — hoy es uso INTERNO de `iniciarConSingleFlight` (más abajo), no de la UI: la
   * distinción "Iniciando…" / "Guardando recorrido anterior…" que motivó este método se eliminó
   * junto con el estado `guardandoRecorridoAnterior` (ver `use-gps-operativo.ts`) cuando la fase
   * 2 del outbox se desacopló del single-flight — un intento invalidado ya no bloquea nada visible
   * para el chofer. Lo que sigue necesitando este método: `iniciarConSingleFlight` lo usa para
   * decidir si esperar a que ESE intento termine de asentarse antes de arrancar uno fresco, en
   * vez de reusarlo tal cual (un intento invalidado nunca deja `tracking=true`). */
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
  let causaInvalidacionActual: 'detener' | 'desmontaje' | null = null;
  let promesaIniciar: Promise<void> | null = null;
  let promesaDetener: Promise<void> | null = null;

  return {
    promesaIniciarEnCurso(): Promise<void> | null {
      return promesaIniciar;
    },
    nuevaGeneracion(): number {
      ultimaGeneracion += 1;
      invalidada = false;
      causaInvalidacionActual = null;
      return ultimaGeneracion;
    },
    registrarPromesaIniciar(promesa: Promise<void>): void {
      // F (hallazgos 9/10, limpieza): antes se guardaba también `generacionPromesaIniciar` para
      // compararla contra `ultimaGeneracion` en `iniciarEnCursoInvalidado()` — con el
      // single-flight garantizado (nunca hay un `nuevaGeneracion()` nuevo mientras
      // `promesaIniciar` siga sin resolver, ver el wrapper `iniciar()` en `use-gps-operativo.ts`)
      // esa comparación nunca podía dar `true` en la práctica: doble generación redundante. Lo
      // único que `iniciarEnCursoInvalidado()` necesita es identidad de promesa (¿hay una
      // registrada?) + el flag `invalidada`.
      //
      // Punto 5.c (hallazgo de revisión, 2026-09-25): antes este método recibía `generacion` sin
      // usarlo (parámetro muerto) — se quitó de la firma. `ejecutarIniciar` sigue necesitando SU
      // propia generación para `estaVigente(generacion)`, pero la obtiene directo de
      // `nuevaGeneracion()`, nunca de este método.
      promesaIniciar = promesa;
      // Punto 5.c: `.catch(()=>{})` — sin esto, un intento que TERMINA en rechazo (p. ej.
      // `ejecutarIniciar` propagando un fallo real de `start()`) disparaba un unhandled rejection
      // acá: `promesa.finally(...)` no consume el rechazo, solo reacciona a él. El rechazo real
      // sigue llegando a quien de verdad lo espera (`iniciarConSingleFlight`/el wrapper
      // `iniciar()`) — este `.catch()` es solo para que ESTA suscripción interna no cuente
      // aparte como una segunda promesa sin manejar.
      void promesa.finally(() => {
        if (promesaIniciar === promesa) {
          promesaIniciar = null;
        }
      }).catch(() => {});
    },
    estaVigente(generacionAEvaluar: number): boolean {
      return generacionAEvaluar === ultimaGeneracion && !invalidada;
    },
    invalidarEnCurso(causa: 'detener' | 'desmontaje' = 'detener'): void {
      invalidada = true;
      // Punto 4: `'detener'` es sticky — nunca lo pisa una invalidación por `'desmontaje'`
      // posterior (ver el docblock de la interfaz para el porqué).
      if (causaInvalidacionActual !== 'detener') {
        causaInvalidacionActual = causa;
      }
    },
    causaInvalidacion(): 'detener' | 'desmontaje' | null {
      return causaInvalidacionActual;
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
 * (vía `esperarPendiente()`) DESPUÉS de `ready()` y ANTES de `iniciarSeguimientoContinuo()`
 * (que es quien llama `start()`) — no "antes de los dos" como decía una versión anterior de
 * este comentario: `ejecutarIniciar` (`use-gps-operativo.ts`) llama `ready()` primero, y recién
 * después `esperarPendiente()` seguido de `iniciarSeguimientoContinuo()`/`start()`.
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
  // `Promise.resolve().then(() => sdk.stop())` en vez de `sdk.stop().then(...)` directo: un
  // `stop()` que TIRA sincrónicamente (en vez de devolver una promesa rechazada) escapaba de
  // este `.then()` — la llamada a `sdk.stop()` en sí ya lanzaba, antes de que hubiera ningún
  // `.then()`/`.catch()` escuchando, y el `try/finally` de más abajo ni llegaba a correr (el
  // throw pasaba por encima, dejando el timer sin `clearTimeout` y sin devolver el
  // `{ok:false, promesaAsentada}` documentado). Diferir la llamada a un microtask dentro de una
  // promesa ya resuelta convierte cualquier throw sincrónico en un rechazo normal de promesa,
  // capturado igual que un rechazo asíncrono por el `.then(...)` de abajo.
  const promesaStopNormalizada = Promise.resolve()
    .then(() => sdk.stop())
    .then(
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
 * Reconciliación de un `stop()` que RESUELVE TARDE (bug en producción, 2026-09-25): cierra el
 * hueco que deja `detenerNativoConTimeout` cuando su timeout de 5 s vence pero el `stop()` nativo
 * real, más tarde, SÍ termina apagando el plugin. Sin esto, `ejecutarDetener`
 * (`use-gps-operativo.ts`) ya devolvió `ok:false` y dejó `tracking=true` + suscripciones puestas +
 * "No se pudo detener correctamente el GPS. Intenta nuevamente." en pantalla — si el chofer no
 * reintenta, el recorrido queda "activo" en la UI mientras el SDK nativo ya dejó de grabar: ni
 * puntos nuevos ni `fin_recorrido` durante horas, hasta que alguien note la discrepancia.
 *
 * Pura, mismo espíritu que el resto del módulo: recibe sus cuatro dependencias por parámetro, sin
 * tocar `BackgroundGeolocation` ni React — testeable con promesas de control manual.
 *
 * SECUENCIA:
 * 1. Espera a que el `stop()` original termine de asentarse (`promesaAsentada` — nunca rechaza,
 *    ver el docblock de `detenerNativoConTimeout` de arriba).
 * 2. Si ya no corresponde reconciliar (`debeReconciliar()` — el llamador decide qué cuenta como
 *    "sigue siendo el mismo recorrido activo, sin haber sido cerrado ya por otra vía"), no hace
 *    nada.
 * 3. Lee el estado REAL del plugin (`nativoHabilitado()`): si sigue `enabled`, el `stop()` tardío
 *    no apagó nada (el timeout venció sin más, nada que reconciliar).
 * 4. Vuelve a chequear `debeReconciliar()` DESPUÉS de ese `await` — el estado pudo cambiar
 *    mientras se esperaba (el chofer reintentó "Finalizar" con éxito, o inició un recorrido
 *    distinto) — recién entonces cierra el recorrido llamando a `detener()`.
 *
 * `detener()` es el `detener()` COMPLETO del hook (single-flight incluido), no un atajo — así el
 * cierre real (outbox, `fin_recorrido`, veredicto) corre igual que en un "Finalizar" normal. No
 * atrapa errores de `nativoHabilitado`/`detener()`: el llamador (`ejecutarDetener`) los reporta a
 * Sentry.
 */
export interface DependenciasReconciliarStopTardio {
  /** La `promesaAsentada` del `detenerNativoConTimeout` que venció. */
  promesaAsentada: Promise<void>;
  /** `true` si sigue teniendo sentido reconciliar (mismo recorrido, todavía activo, montado). Se
   * evalúa DOS veces (antes y después de `nativoHabilitado()`) — ver SECUENCIA arriba. */
  debeReconciliar: () => boolean;
  /** Lee `BackgroundGeolocation.getState().enabled` — la única forma de saber si el `stop()`
   * tardío de verdad apagó el plugin. */
  nativoHabilitado: () => Promise<boolean>;
  /** El `detener()` completo del hook (con single-flight). */
  detener: () => Promise<void>;
}

export async function reconciliarStopTardio(
  deps: DependenciasReconciliarStopTardio,
): Promise<'reconciliado' | 'sin-accion'> {
  await deps.promesaAsentada;
  if (!deps.debeReconciliar()) return 'sin-accion';
  const habilitado = await deps.nativoHabilitado();
  if (habilitado) return 'sin-accion';
  if (!deps.debeReconciliar()) return 'sin-accion';
  await deps.detener();
  return 'reconciliado';
}

/** Punto 5.b (hallazgo de revisión, 2026-09-25): tope de espera a que un `iniciar()` invalidado
 * por un `detener()` termine de asentarse antes de arrancar uno fresco (ver
 * `iniciarConSingleFlight`, abajo). Ese intento invalidado puede colgarse de verdad — la fase que
 * puede colgarse (`sembrarCumplimientos`/`abrirOutbox`/`asegurarInicioRecorrido` contra SQLite
 * trabada) es justo la razón de ser de todo este rediseño (ver el docblock del módulo) — así que
 * sin este tope, un "Comenzar" tras un "Finalizar" con el intento anterior colgado podía dejar al
 * chofer esperando para siempre, sin ningún mensaje ni forma de reintentar. Exportada (no una
 * constante interna) para que los tests puedan inyectar un valor chico con fake timers en vez de
 * esperar 15 s reales. */
export const TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS = 15_000;

/** Punto 5.b: lanzada por `iniciarConSingleFlight` cuando el intento invalidado que está
 * esperando no se asienta dentro de `TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS`. `iniciar()`
 * (`use-gps-operativo.ts`) la distingue de cualquier otro error para mostrar un mensaje
 * específico ("No se pudo iniciar el GPS. Cierra y vuelve a abrir la app.") en vez del genérico —
 * a esta altura ya no hay nada más que un reinicio completo de la app pueda destrabar (el intento
 * colgado sigue vivo, bloqueando el single-flight, hasta que su propio outbox por fin resuelva o
 * el proceso se reinicie). */
export class EsperaIniciarInvalidadoAgotadaError extends Error {
  constructor() {
    super('Timeout esperando a que un iniciar() invalidado termine de asentarse');
    this.name = 'EsperaIniciarInvalidadoAgotadaError';
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
 *
 * `timeoutEsperaInvalidadoMs` (punto 5.b): tope de la espera al intento invalidado — parámetro,
 * no la constante de módulo directa, para que los tests lo acoten con fake timers sin depender de
 * `TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS` real.
 */
export async function iniciarConSingleFlight(
  coordinador: CoordinadorIniciarDetener,
  ejecutarIntento: (generacion: number) => Promise<void>,
  timeoutEsperaInvalidadoMs: number = TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS,
): Promise<void> {
  for (;;) {
    let promesa = coordinador.promesaIniciarEnCurso();
    if (promesa && coordinador.iniciarEnCursoInvalidado()) {
      // Punto 5.a: `.catch(()=>{})` — un intento invalidado que TERMINA en rechazo (p. ej.
      // `ejecutarIniciar` propagando un fallo real de `start()`) no debe abortar este toque
      // fresco del chofer con ESE error viejo; solo importa que ya se asentó, sin importar cómo.
      // Punto 5.b: acotado con un timeout — si el intento invalidado nunca se asienta, se lanza
      // `EsperaIniciarInvalidadoAgotadaError` en vez de esperar para siempre.
      let venceTimeout = false;
      const idTimer = { current: undefined as ReturnType<typeof setTimeout> | undefined };
      const promesaTimeout = new Promise<void>((resolve) => {
        idTimer.current = setTimeout(() => {
          venceTimeout = true;
          resolve();
        }, timeoutEsperaInvalidadoMs);
      });
      await Promise.race([promesa.catch(() => undefined), promesaTimeout]);
      if (idTimer.current !== undefined) clearTimeout(idTimer.current);
      if (venceTimeout) {
        throw new EsperaIniciarInvalidadoAgotadaError();
      }
      continue; // el intento invalidado ya se asentó — arrancar uno nuevo, no reusarlo.
    }
    if (!promesa) {
      const generacion = coordinador.nuevaGeneracion();
      promesa = ejecutarIntento(generacion);
      coordinador.registrarPromesaIniciar(promesa);
    }
    await promesa;
    return;
  }
}
