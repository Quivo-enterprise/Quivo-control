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
  logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
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
