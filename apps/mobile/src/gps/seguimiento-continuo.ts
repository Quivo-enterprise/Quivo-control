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
 */
export function crearManejadorForegroundActivo(
  sdk: { getCurrentPosition: (opts: { samples: number; persist: boolean }) => Promise<unknown> },
  estaEnRecorrido: () => boolean,
): (estadoApp: string) => void {
  return (estadoApp: string) => {
    if (estadoApp === 'active' && estaEnRecorrido()) {
      void sdk.getCurrentPosition({ samples: 1, persist: true }).catch((error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'gps-foreground', paso: 'foreground-activo-getCurrentPosition' },
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
