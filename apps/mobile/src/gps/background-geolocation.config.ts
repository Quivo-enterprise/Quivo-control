import BackgroundGeolocation, { Config } from 'react-native-background-geolocation';

/**
 * Config MVP del spike (QUI-216, doc técnico §6): punto cada 10s o 50m en movimiento,
 * motion-detection nativa activa, buffering/escritura por lotes a SQLite (no punto a
 * punto). `autoSyncThreshold: 0` a propósito — este spike solo mide batería y huecos,
 * no sincroniza contra la API (eso es QUI-240/241, M3).
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
    title: 'QUIVO — spike GPS',
    text: 'Midiendo batería y continuidad de tracking (QUI-216)',
  },
};
