import BackgroundGeolocation, { Config } from 'react-native-background-geolocation';

/**
 * Config de tracking GPS del recorrido (nació como spike QUI-216, doc técnico §6, y hoy es
 * la config real usada en producción por QUI-243): punto cada 10s o 50m en movimiento,
 * motion-detection nativa activa, buffering/escritura por lotes a SQLite (no punto a
 * punto). `autoSyncThreshold: 0` a propósito — el envío al backend lo maneja el outbox
 * propio (QUI-238/240), no el autoSync nativo del plugin.
 *
 * La licencia de Transistorsoft se agrega en `app.json` → plugins →
 * `react-native-background-geolocation` → `license` antes de un build real.
 */
export const gpsSpikeConfig: Config = {
  desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
  distanceFilter: 50,
  locationUpdateInterval: 10_000,
  fastestLocationUpdateInterval: 10_000,
  stopTimeout: 5,
  stopOnStationary: false,
  disableMotionActivityUpdates: false,
  autoSync: false,
  autoSyncThreshold: 0,
  foregroundService: true,
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
  // Verbose escribe a la SQLite nativa del propio SDK en cada tick — I/O y batería
  // regalados durante las 8h que el criterio A del GO mide (< 5% batería/jornada). Esta
  // config es la que corre en producción (ver comentario de arriba): el nivel de log
  // correcto para producción es ERROR, no VERBOSE.
  logLevel: BackgroundGeolocation.LOG_LEVEL_ERROR,
  notification: {
    title: 'QUIVO Conductor — recorrido activo',
    text: 'Registrando tu ubicación mientras dure la jornada',
  },
  locationAuthorizationRequest: 'Always',
  backgroundPermissionRationale: {
    title: 'Permitir que QUIVO Conductor acceda a la ubicación en segundo plano',
    message:
      'QUIVO necesita registrar tu ubicación durante todo el recorrido, incluso con la ' +
      'pantalla apagada, para detectar automáticamente el paso por los puntos de control ' +
      'de tu línea.',
    positiveAction: 'Cambiar a "Permitir todo el tiempo"',
    negativeAction: 'Cancelar',
  },
};
