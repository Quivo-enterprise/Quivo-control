import BackgroundGeolocation, { type Config } from 'react-native-background-geolocation';

/**
 * Nivel de log del SDK. Los dos lados del trade-off son reales:
 * - VERBOSE escribe a la SQLite nativa del propio plugin en cada tick — I/O y batería que el
 *   criterio A del GO mide (< 5% batería/jornada). El costo exacto, hoy, NO está medido: es
 *   justamente una de las cosas que la corrida de 8h del spike va a medir.
 * - Pero `BackgroundGeolocation.logger.getLog()` es el ÚNICO instrumento que existe para
 *   explicar un hueco del criterio B ("ninguno > 2 min"): sin él no se puede distinguir Doze
 *   de un battery-killer del fabricante o de un error de la propia config.
 *
 * Decisión (QUI-216): VERBOSE mientras se instrumenta, ERROR en producción — y derivado, no
 * escrito a mano, para que nadie tenga que editar este archivo antes de cada corrida:
 * - `__DEV__`: cualquier build de desarrollo queda instrumentada sola.
 * - `EXPO_PUBLIC_GPS_LOG_VERBOSE=1`: interruptor para una corrida del spike sobre un build de
 *   release (variable del perfil de EAS o del entorno de Expo, mismo patrón que
 *   `EXPO_PUBLIC_API_URL`). Sin la variable, un build de producción queda en ERROR.
 */
// Exportado (hallazgo de revisión A8c) para que `useGpsOperativo` anote con qué nivel de log
// corrió cada medición: VERBOSE escribe I/O extra a la SQLite nativa del plugin, así que una
// corrida contaminada con VERBOSE y una limpia con ERROR no son comparables para el criterio
// A del GO (< 5% batería/jornada), aunque hoy produzcan el mismo string de veredicto.
export const logVerboseHabilitado = __DEV__ || process.env.EXPO_PUBLIC_GPS_LOG_VERBOSE === '1';

/**
 * Config de tracking GPS del recorrido (nació como spike QUI-216, doc técnico §6, y hoy es
 * la config real usada en producción por QUI-243): punto cada 10s o 50m en movimiento,
 * motion-detection nativa activa, buffering/escritura por lotes a SQLite (no punto a
 * punto). `autoSyncThreshold: 0` a propósito — el envío al backend lo maneja el outbox
 * propio (QUI-238/240), no el autoSync nativo del plugin.
 *
 * La licencia de Transistorsoft se agrega en `app.json` → plugins →
 * `react-native-background-geolocation` → `license` antes de un build real.
 *
 * Forma del objeto — "Compound Config" (Transistorsoft v5, MIGRATION-GUIDE-5.0.0.md): v4 usaba
 * un `Config` plano (todas las claves al mismo nivel); v5 lo reagrupa en sub-objetos
 * (`geolocation`, `app`, `http`, `activity`, `logger`, ...) y así lo tipa
 * `@transistorsoft/background-geolocation-types` — el `Config` plano YA NO tipa (aunque el SDK
 * nativo lo sigue aceptando en runtime por compat, con warning). Cada clave de abajo quedó en
 * el mismo grupo que indica la tabla de mapeo de esa guía; los comentarios de decisión de
 * QUI-216 no cambiaron de contenido, solo de ubicación.
 */
export const gpsSpikeConfig: Config = {
  geolocation: {
    desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
    // Corrida de producción (mediana 153-166 s, p95 684-814 s de latencia captura→servidor,
    // ver docs/plan de drenado en background): el `distanceFilter` NOMINAL de 50 m medía
    // 81-103 m reales en el piloto, porque el SDK escala el filtro con la velocidad
    // (`disableElasticity: false` por default — ver abajo). 15 m ≈ 1,8 s a 30 km/h una vez
    // desactivada esa elasticidad: puntos mucho más seguidos sin depender de ningún timer JS
    // (el fix llega por evento nativo → `onLocation`, no por polling).
    distanceFilter: 15,
    // Sin esto, el SDK escala `distanceFilter` automáticamente con la velocidad (a más
    // velocidad, filtro más laxo — "highway speeds, locations are returned at ~ 1 / km"): es
    // la causa confirmada de que 50 m nominales dieran 81-103 m medidos en el piloto.
    // Desactivada, `distanceFilter` queda CONSTANTE en el valor configurado.
    disableElasticity: true,
    // Uno de los tres factores detrás de los huecos medidos de 11/17/22/56 minutos con el
    // vehículo DETENIDO (junto con `stopTimeout` y la geocerca de 200 m del propio SDK): por
    // default Android descarta un fix idéntico al anterior, así que un vehículo parado deja
    // de emitir por completo hasta que algo lo mueva. `true` fuerza a registrar igual —
    // constante que sostiene la evidencia (RF-67..73) durante un layover, no solo en
    // movimiento.
    allowIdenticalLocations: true,
    // Otro de los tres factores de los huecos con el vehículo detenido (ver el comentario de
    // `allowIdenticalLocations` arriba): minutos que la ARS (Activity Recognition System)
    // espera tras detectar `STILL` antes de bajar la frecuencia de fixes. Subido de 5 a 10 —
    // el tercer factor (la geocerca de 200 m del SDK) sigue siendo del SDK, no configurable
    // acá; el hueco residual esperado con los tres ajustes de esta config baja a ~60-90 s
    // (ver `heartbeatInterval` en `app`, abajo), lejos de los 11-56 min medidos.
    stopTimeout: 10,
    locationAuthorizationRequest: 'Always',
    // `locationUpdateInterval`/`fastestLocationUpdateInterval` (Android) SOLO aplican con
    // `distanceFilter: 0` — con `distanceFilter > 0` (nuestro caso, 15 m) el SDK los ignora
    // por completo. Estaban seteados en 10 s cada uno, lo cual no tenía ningún efecto real y
    // solo desinformaba a quien leyera este archivo pensando que gobernaban el intervalo de
    // fixes — se borran en vez de dejarlos como documentación falsa.
  },
  activity: {
    stopOnStationary: false,
    disableMotionActivityUpdates: false,
    // Complementa `stopTimeout` (arriba, en `geolocation`): minutos que el sistema de
    // stop-detection espera DESPUÉS de que el vehículo arranca antes de empezar a evaluar de
    // nuevo si volvió a quedar quieto. Sin este margen (default 0), una parada corta en
    // semáforo/control alcanza para reactivar el conteo de `stopTimeout` de inmediato,
    // adelantando el paso a modo estacionario y agravando los huecos ya descriptos arriba.
    // 2 minutos le da margen a una parada breve sin sacrificar la detección de un layover
    // real (que dura bastante más que eso).
    stopDetectionDelay: 2,
  },
  persistence: {
    // H7 (hallazgo de revisión, medio): sin setear esto, `maxDaysToPersist` queda en su
    // default de 1 día. La SQLite INTERNA del propio SDK (`rescate-dia1.ts`) fue la ÚNICA
    // copia sobreviviente de todo el día 1 del piloto, cuando el outbox de la app (QUI-238)
    // no grabó nada por la regresión de `expo-sqlite@16.0.10` — con 1 día de retención, un
    // fallo del outbox de más de 24h vuelve a podar esa evidencia sin dejar rastro, ANTES de
    // que alguien llegue a correr el rescate.
    //
    // OJO — 14 días de RETENCIÓN no son 14 días de ventana de RESCATE, y la diferencia importa:
    // el rescate automático (`rescate-dia1.ts`) solo encola puntos de hasta
    // `TOLERANCIA_TS_FIX_PASADO_MS` (7 días, `@quivo/shared`) hacia atrás, porque más allá de
    // eso `resolverTsFix` server-side descarta el `tsFix` y cae en silencio al `ts` de encolado
    // — o sea, el momento del rescate: el recorrido quedaría con todos los puntos apilados en
    // el día equivocado. Los 7 días que van de la ventana de rescate a la de retención siguen
    // valiendo igual: el dato sigue vivo en la SQLite del SDK y se puede extraer a mano, solo
    // que no por el botón de rescate. Si algún día hay que ampliar esa ventana, hay que subir
    // `TOLERANCIA_TS_FIX_PASADO_MS` Y crear particiones de `gps_points` hacia atrás (hoy el
    // worker solo crea `hoy..hoy+5`), o los puntos rebotan con `23514 no partition ... for row`.
    maxDaysToPersist: 14,
  },
  http: {
    autoSync: false,
    autoSyncThreshold: 0,
  },
  app: {
    // `foregroundService` (v4) se quitó de la config: el propio SDK nativo lo fuerza a `true`
    // desde Android 8 (Background Execution Limits) y ya no acepta desactivarlo — la guía de
    // migración de v5 ya no lo lista como propiedad configurable.
    //
    // Criterio C del GO ("los puntos persistidos sobreviven kill de la app / reboot"): el
    // default del SDK es `true` (detiene el tracking al matar la app) — con eso el spike es
    // NO-GO por diseño, sin importar qué tan bueno sea el resto de la config (QUI-216).
    stopOnTerminate: false,
    // Complemento del criterio C: sin esto, un reboot del dispositivo (batería agotada,
    // apagado manual, actualización de Android) deja al chofer sin tracking hasta que alguien
    // abra la app a mano — inaceptable para evidencia legal de una jornada completa.
    startOnBoot: true,
    // Habilita el headless task nativo (registrado en `index.js`, único lugar donde el SDK lo
    // permite): sin esto, `stopOnTerminate: false` mantiene el SDK grabando en su SQLite
    // nativa tras el kill, pero nada copia esos puntos al outbox de la app
    // (`quivo-outbox.db`) — la fuente de verdad de la evidencia (RF-67..73) se queda vacía.
    enableHeadless: true,
    // Complementa los tres ajustes de `geolocation`/`activity` de arriba contra los huecos de
    // 11/17/22/56 min con el vehículo detenido: `onHeartbeat` es el único evento que sigue
    // llegando durante un layover largo, incluso dentro de la geocerca de 200 m del SDK que
    // ninguno de esos tres ajustes puede tocar. 60 s es además el PISO en Android — "It is
    // impossible to have a heartbeatInterval faster than this on Android" (doc del SDK) — y
    // coincide con el default ya vigente hoy sin declararlo, así que este cambio no altera la
    // tasa de heartbeats respecto de la configuración actual.
    //
    // Entrega 2 (`docs/plan-correccion-post-piloto-2026-09-09.md`): el handler de
    // `BackgroundGeolocation.onHeartbeat(...)` que faltaba acá ya está suscrito — vive en
    // `use-gps-operativo.ts` (`suscribirUbicaciones`), junto a la suscripción de `onLocation`,
    // no en este archivo de config puro. Hace `getCurrentPosition({samples:1, persist:true})`
    // + `intentarDrenarOportunista(...)` en cada heartbeat, cerrando el hueco de verdad:
    // segundo punto de enganche del drenado del outbox además de `onLocation`/headless,
    // garantizado cada 60 s aunque el vehículo esté quieto y no dispare ningún evento
    // `location`. Confirmado contra el `.d.ts` de
    // `@transistorsoft/background-geolocation-types@5.2.2` (`AppConfig.heartbeatInterval`,
    // default `60`); el binario nativo (`.aar`) no se pudo inspeccionar por no traer fuente,
    // así que esta lectura de inocuidad se apoya en la doc oficial del SDK, no en el código
    // nativo compilado.
    heartbeatInterval: 60,
    notification: {
      title: 'QUIVO Conductor — recorrido activo',
      text: 'Registrando tu ubicación mientras dure la jornada',
    },
    backgroundPermissionRationale: {
      title: 'Permitir que QUIVO Conductor acceda a la ubicación en segundo plano',
      message:
        'QUIVO necesita registrar tu ubicación durante todo el recorrido, incluso con la ' +
        'pantalla apagada, para detectar automáticamente el paso por los puntos de control ' +
        'de tu línea.',
      positiveAction: 'Cambiar a "Permitir todo el tiempo"',
      negativeAction: 'Cancelar',
    },
  },
  logger: {
    // Ver `logVerboseHabilitado` arriba para la decisión y cómo activarlo sin tocar el código.
    logLevel: logVerboseHabilitado
      ? BackgroundGeolocation.LogLevel.Verbose
      : BackgroundGeolocation.LogLevel.Error,
  },
};
