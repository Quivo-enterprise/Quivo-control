import type { ExpoConfig } from 'expo/config';

/**
 * Convertido de `app.json` (estático) a `app.config.ts` (dinámico) por QUI-357/QUI-365/URL de
 * API — las tres tareas necesitan inyectar valores de `process.env` en tiempo de prebuild:
 * - `TRANSISTORSOFT_LICENSE_KEY`: la key JWT del trial va acá, no en el JSON (ver comentario
 *   del plugin `react-native-background-geolocation` más abajo).
 * - `EAS_BUILD_PROFILE`: se propaga a `extra.easBuildProfile` para que Sentry (en runtime, vía
 *   `expo-constants`) sepa si el build es `development`/`production`/local sin duplicar esa
 *   info como variable `EXPO_PUBLIC_*` separada.
 *
 * `usesCleartextTraffic: false` es estático (no depende de env ni de perfil) — la excepción
 * de red para desarrollo NO vive acá, vive en el plugin nativo
 * `./plugins/withAndroidNetworkSecurityConfig` (ver ese archivo para el porqué: Android decide
 * solo, por `debuggable`, sin que este config tenga que ramificar por perfil).
 */
export default (): ExpoConfig => ({
  name: 'QUIVO Conductor',
  slug: 'quivo-conductor',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: false,
  platforms: ['android'],
  icon: './assets/images/icon.png',
  android: {
    package: 'com.quivotech.conductor',
    // QUI-357: con el backend en Cloud Run (HTTPS nativo) no hay excusa para permitir
    // cleartext en release — los PINs de conductor y la evidencia GPS legal viajarían en
    // claro sobre WiFi público. La excepción para desarrollo local (`http://` en la LAN) va
    // por `./plugins/withAndroidNetworkSecurityConfig`, no acá.
    usesCleartextTraffic: false,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
    ],
  },
  extra: {
    // Leído en runtime por `src/shared/observability/sentry.ts` vía `expo-constants` para
    // taggear el `environment` de cada evento de Sentry. `EAS_BUILD_PROFILE` solo existe en
    // el entorno de build de EAS (no en el bundle JS) — este es el puente.
    easBuildProfile: process.env.EAS_BUILD_PROFILE ?? 'local',
  },
  plugins: [
    [
      'react-native-background-geolocation',
      {
        // QUI-350/N4 del plan: la key JWT del trial de 30 días vive como secret de EAS
        // (`TRANSISTORSOFT_LICENSE_KEY`, ver eas.json y el reporte de QUI-357/365/URL-API) —
        // NUNCA committeada en texto plano acá. Sin la variable (dev local sin secret
        // exportado), el SDK sigue funcional en builds debug sin licencia (confirmado en
        // docs/handoff.md); solo un build de RELEASE sin esta key queda bloqueado por
        // Transistorsoft.
        license: process.env.TRANSISTORSOFT_LICENSE_KEY ?? '',
      },
    ],
    'expo-sqlite',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    'expo-font',
    './plugins/withAndroidNetworkSecurityConfig',
  ],
});
