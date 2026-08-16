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
    // ID del proyecto de EAS (creado para el piloto del 17/08). Va hardcodeado porque
    // `eas init` no puede escribir en un config dinámico como este (`app.config.ts` es TS,
    // no JSON) — falla con "Cannot automatically write to dynamic config at: app.config.ts".
    // Sin este ID en `extra.eas.projectId`, todos los comandos de EAS (`eas secret:create`,
    // `eas build`) no saben a qué proyecto apuntar y fallan.
    eas: {
      projectId: '09e5dff3-e3dc-408f-a930-bc067a8ff69a',
    },
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
    [
      '@sentry/react-native/expo',
      // DSN de Sentry ya cargado (perfil `production` de `eas.json`, QUI-365). Este plugin es
      // la mitad que faltaba: aplica el Sentry Gradle plugin sobre el `android/` que EAS Build
      // regenera en cada corrida (`android/` está en `.gitignore` — prebuild limpio siempre),
      // que es lo que sube proguard mapping/símbolos nativos y (junto con el Sentry Metro
      // plugin) los source maps del bundle JS. Sin esto, `Sentry.init()` en `sentry.ts` sigue
      // funcionando (captura eventos), pero cualquier stack trace de un build de release llega
      // minificado/ofuscado a Sentry — la mitad del valor de tenerlo.
      //
      // `disableAutoUpload: true` es TEMPORAL y a propósito: la subida real requiere un
      // `SENTRY_AUTH_TOKEN` que todavía no existe. Ese token es un secreto de build (a
      // diferencia del DSN, que es público) — igual que `TRANSISTORSOFT_LICENSE_KEY` más
      // arriba, NUNCA va en texto plano acá ni en `eas.json`. Pendiente para activar la subida
      // real antes de depender de esto en producción:
      //   1. En Sentry: Settings → Auth Tokens → crear uno con scope `project:write`, para el
      //      proyecto del DSN ya cargado (org id 4511920211165184 / project id
      //      4511920290922496 — son ids numéricos, no el slug legible que pide `organization`/
      //      `project` abajo).
      //   2. `eas secret:create --name SENTRY_AUTH_TOKEN --value <token> --type string` (o vía
      //      el dashboard de EAS) — nunca commiteado.
      //   3. Completar `organization`/`project` (los slugs, ej. "quivo") acá abajo y pasar
      //      `disableAutoUpload` a `false`.
      // Nota separada: además de esto, falta un `metro.config.js` con `getSentryExpoConfig`
      // (`@sentry/react-native/metro`) para que la subida automática de source maps quede
      // completa — ese archivo no está en el alcance de este cambio.
      {
        disableAutoUpload: true,
      },
    ],
  ],
});
