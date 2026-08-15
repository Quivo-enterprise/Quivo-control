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
    distanceFilter: 50,
    locationUpdateInterval: 10_000,
    fastestLocationUpdateInterval: 10_000,
    stopTimeout: 5,
    locationAuthorizationRequest: 'Always',
  },
  activity: {
    stopOnStationary: false,
    disableMotionActivityUpdates: false,
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
