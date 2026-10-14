import type { ExpoConfig } from 'expo/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { evaluarClaveMapas } =
  require('./plugins/clave-mapas.cjs') as typeof import('./plugins/clave-mapas.cjs');

const resultadoClaveMapas = evaluarClaveMapas(process.env);
if (resultadoClaveMapas === 'fallar') {
  throw new Error(
    'Falta GOOGLE_MAPS_ANDROID_API_KEY en el entorno de este build de EAS: sin ella la app ' +
      'se cierra al abrir el mapa (el SDK de Google Maps lanza IllegalStateException). ' +
      'Definila como variable SENSIBLE del perfil en EAS.',
  );
}
if (resultadoClaveMapas === 'advertir') {
  console.warn(
    '[app.config] GOOGLE_MAPS_ANDROID_API_KEY no está definida: la app se CERRARÁ al abrir ' +
      'el mapa (el SDK de Google Maps lanza IllegalStateException sin API key).',
  );
}

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
  // Cuenta dueña del proyecto de EAS (confirmado con `eas project:info`: fullName
  // `@shadow00/quivo-conductor`, mismo ID que `extra.eas.projectId` de abajo). Sin esto, si
  // alguien más del equipo (u otra sesión de CI) corre `eas build` logueado con otra cuenta de
  // Expo, el error sale disfrazado de problema de credenciales en vez de decir claramente que
  // el proyecto pertenece a otra cuenta.
  owner: 'shadow00',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: false,
  platforms: ['android'],
  // OTA (EAS Update). Principio: la app NUNCA cambia de bundle ni se reinicia con un recorrido
  // activo (el GPS nativo sigue vivo aunque la JS muera: `stopOnTerminate: false`).
  //
  // `checkAutomatically: 'NEVER'`: el chequeo de arranque de expo-updates (ON_LOAD) corre en
  // CUALQUIER arranque en frío, incluido el del headless task tras un kill, y no sabe nada del
  // recorrido. En su lugar, `src/features/actualizaciones/` chequea/descarga SOLO en la UI en
  // primer plano, SOLO sin recorrido activo, y aplica con `reloadAsync()` solo en una pantalla
  // pre-operación (login/selección de asignación).
  //
  // Matiz (expo-updates SDK 54): `NEVER` solo apaga el chequeo de arranque. Una actualización YA
  // descargada (fetchUpdateAsync) se lanza igual en el próximo arranque en frío. Es aceptable
  // porque (1) solo descargamos con el recorrido inactivo y reiniciamos de inmediato si estamos
  // en pantalla pre-operación, así que la ventana "descargada y sin aplicar" es corta; y (2) el
  // bundle descargado es compatible con el binario (mismo runtimeVersion) y la reconexión a un
  // recorrido activo tras un arranque en frío ya es el camino normal de la app.
  // `fallbackToCacheTimeout: 0` evita bloquear el arranque esperando red.
  //
  // `runtimeVersion` = fingerprint con `fingerprint.config.js`, que neutraliza los valores que
  // vienen del entorno de EAS (clave de Google Maps, licencia de Transistorsoft, perfil de
  // build, slugs de Sentry) para que un `eas update` corrido en otra máquina calce con el APK.
  // Un cambio nativo real (dependencia, plugin, permisos) cambia el hash solo.
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    url: 'https://u.expo.dev/09e5dff3-e3dc-408f-a930-bc067a8ff69a',
    checkAutomatically: 'NEVER',
    fallbackToCacheTimeout: 0,
  },
  icon: './assets/images/icon.png',
  android: {
    // QUI-… (decisión del CTO, ronda de verify-fix del logout/sesión): el trial de
    // Transistorsoft del `applicationId` viejo (`com.quivotech.conductor`) venció, así que este
    // build usa uno nuevo (`.app`). SecureStore es por `applicationId`: por eso NO hay
    // migración de la clave legacy `quivo.mobile.session.v2` (ver el comentario de
    // `sesion-movil-store.ts`) — el cambio de paquete ya implica instalación limpia.
    package: 'com.quivotech.conductor.app',
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
      // QUI-338: con targetSdk 36 (Android 13+), sin `POST_NOTIFICATIONS` la notificación del
      // foreground service (`app.notification` en `background-geolocation.config.ts`) no se
      // muestra — y esa notificación es la única señal que tiene el conductor de que el
      // recorrido se está grabando mientras la pantalla está apagada.
      //
      // HALLAZGO DE CAMPO confirmado (Entrega 7, Sentry build 10, Galaxy A71 Android 13):
      // declararlo ACÁ solo habilita que el sistema pueda llegar a pedirlo — en Android 13+
      // (API 33) es un permiso de RUNTIME real, igual que la ubicación. Sin el pedido
      // explícito, `POST_NOTIFICATIONS` queda `not_granted` aunque esté en este array, y NI
      // la notificación del foreground service de arriba NI la de confirmación de puntos de
      // control (`anuncio-punto-control.ts`) se muestran — silenciosamente, sin error. El
      // pedido en runtime vive en `use-gps-operativo.ts` (`asegurarPermisoNotificaciones`,
      // llamado desde `iniciar()`, con la app en foreground, antes de arrancar el SDK de
      // geolocalización): un solo pedido de `expo-notifications` cubre el permiso de Android
      // para AMBAS notificaciones, la del SDK y la de QUIVO, porque `POST_NOTIFICATIONS` es un
      // permiso a nivel de APP, no por notificación ni por librería.
      'POST_NOTIFICATIONS',
      // Declarados explícitamente por trazabilidad del manifest (antes probablemente los
      // inyectaba el AAR nativo de `react-native-background-geolocation` por manifest-merge,
      // sin confirmar): `WAKE_LOCK` lo necesita el foreground service para seguir grabando con
      // la pantalla apagada; `RECEIVE_BOOT_COMPLETED` es el que dispara `startOnBoot: true`
      // (`background-geolocation.config.ts`) tras un reinicio del teléfono.
      'WAKE_LOCK',
      'RECEIVE_BOOT_COMPLETED',
      // QUI-P0 (la flecha del conductor no se mueve en el mapa): permiso "dangerous" que
      // Android 10+ (API 29+) exige en runtime para el Activity Recognition System
      // (acelerómetro) que el SDK usa para detectar el paso de estacionario a en-movimiento.
      // Sin declararlo acá NUNCA podía concederse (confirmado en Sentry: Samsung Galaxy A71,
      // Android 13, `ACTIVITY_RECOGNITION: not_granted`) — el pedido en runtime vive en
      // `use-gps-operativo.ts` (`iniciar()`), fail-open: ver `gps/permiso-actividad.ts` para
      // el detalle completo de por qué esto NUNCA bloquea "Iniciar recorrido".
      'ACTIVITY_RECOGNITION',
    ],
    // `expo-image-picker` declara READ/WRITE_EXTERNAL_STORAGE en su manifest de librería. La app
    // solo usa la cámara (`launchCameraAsync`), nunca la galería, pero en Android < 10
    // `ensureCameraPermissionsAreGranted` exige WRITE_EXTERNAL_STORAGE JUNTO CON CAMERA (si no
    // está concedido, la cámara rechaza con UserRejectedPermissionsException), así que NO se puede
    // bloquear. READ_EXTERNAL_STORAGE no lo pide ninguna ruta de cámara (solo la de galería), por
    // eso es lo único que se bloquea.
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE'],
    // Mapa de la ruta activa: motor Google nativo (`react-native-maps` + `PROVIDER_GOOGLE`, ver
    // `docs/adr/0004-motor-mapa-google.md`). La API key de Google Maps SDK for Android vive en
    // el entorno de EAS (`GOOGLE_MAPS_ANDROID_API_KEY`, variable SENSIBLE) — NUNCA se hardcodea
    // ni se loguea acá. SIN ella el SDK lanza
    // IllegalStateException ("API key not found") al crear el primer mapa y la app se CIERRA:
    // por eso arriba el config falla en build time en cualquier build de EAS que no sea
    // `development`. La key debe estar restringida en Google Cloud al paquete de la app + el
    // SHA-1 del keystore de producción. Con la variable ausente en una corrida local/`development`
    // la clave se omite del manifest en vez de mandar un string vacío (y se advierte por consola).
    ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
      ? { config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } } }
      : {}),
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
      'expo-image-picker',
      {
        // Solo cámara (foto del vehículo, PR D). `photosPermission: false` omite el texto de
        // galería (iOS; en Android el plugin no declara permisos de fotos). `microphonePermission:
        // false` evita que el plugin agregue RECORD_AUDIO (no se graba video ni audio).
        cameraPermission: 'QUIVO Conductor usa la cámara para tomar la foto del vehículo.',
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'expo-notifications',
      {
        // ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): copia dedicada del
        // timbre de `confirmacion-sonido.ts`, con nombre SIN GUIONES a propósito — el plugin
        // copia este archivo a `android/app/src/main/res/raw/`, y los nombres de recurso `raw`
        // de Android solo aceptan `[a-z0-9_.]` (un guion rompe `aapt2` en el build nativo). El
        // canal Android que lo referencia vive en
        // `features/operacion/anuncio-punto-control.ts` (`SONIDO_NOTIFICACION_ANDROID`) — el
        // nombre tiene que coincidir EXACTO entre los dos lugares.
        sounds: ['./assets/sounds/confirmacion_chime_notificacion_v2.wav'],
      },
    ],
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
      // la mitad que faltaba: aplica el Sentry Gradle plugin (`sentry.gradle`, de
      // `@sentry/react-native`, no el "Sentry Android Gradle Plugin" oficial) sobre el
      // `android/` que EAS Build regenera en cada corrida (`android/` está en `.gitignore` —
      // prebuild limpio siempre). Con los `props` actuales (sin `experimental_android.
      // enableAndroidGradlePlugin`) esto sube el bundle JS + source maps (junto con el Sentry
      // Metro plugin, ver `metro.config.js`) — NO sube proguard mapping ni símbolos nativos
      // (NDK): eso solo lo hace `withSentryAndroidGradlePlugin`, que `withSentry.js`
      // (`node_modules/@sentry/react-native/plugin/build/withSentry.js`) solo aplica si se pasa
      // `experimental_android.enableAndroidGradlePlugin`, y acá no se pasa. En la práctica hoy
      // no importa: R8/minify está apagado en la variante de release
      // (`android/app/build.gradle` → `enableMinifyInReleaseBuilds` no está seteado, default
      // `false`), así que no hay nada que ofuscar. Si algún día se activa la minificación, para
      // tener los mappings habrá que agregar `experimental_android.enableAndroidGradlePlugin`
      // acá (no lo actives ahora, cambiaría el comportamiento del build para el piloto). Sin
      // este plugin en general, `Sentry.init()` en `sentry.ts` sigue funcionando (captura
      // eventos), pero cualquier stack trace de un build de release llega minificado/ofuscado a
      // Sentry — la mitad del valor de tenerlo.
      //
      // Nota de versión: acá corre `@sentry/react-native` 7.2.0. `PluginProps` en esa versión
      // (`node_modules/@sentry/react-native/plugin/build/withSentry.d.ts`) solo reconoce
      // `organization`, `project`, `authToken`, `url` y `experimental_android` — NO existe una
      // opción `disableAutoUpload` (quedó acá de una versión distinta del SDK): el plugin la
      // ignoraba en silencio, y la tarea de subida se registraba igual en `sentry.gradle`, cuyo
      // gate real (`onlyIf { shouldSentryAutoUploadGeneral() }`) depende del env var
      // `SENTRY_DISABLE_AUTO_UPLOAD`, no de un prop del plugin. Sin `organization`/`project`
      // configurados, `sentry-cli` salía con exit code 1 ("An organization ID or slug is
      // required") dentro de un `exec {}` de Gradle sin `ignoreExitValue` — eso rompía el build
      // entero, no solo la subida de source maps.
      //
      // `organization`/`project` se leen de env en vez de hardcodearse acá: son los slugs reales
      // (org `quivo-de`, proyecto `quivo-control-conductor`, confirmados con el CTO), pero
      // viven como `SENTRY_ORG`/`SENTRY_PROJECT` en `eas.json` -> build.production.env (no son
      // secretos — sin prefijo `EXPO_PUBLIC_` porque solo hacen falta durante el build nativo,
      // igual que `TRANSISTORSOFT_LICENSE_KEY`, nunca en el bundle JS). NO se pasa `authToken`
      // acá: quedaría en texto plano en la config resuelta de Expo. `sentry-cli` lo toma solo de
      // la env var `SENTRY_AUTH_TOKEN`, cargada como env var SECRETA de EAS para el entorno
      // `production` (confirmado con `eas env:list --environment production`) — nunca
      // commiteada.
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
      },
    ],
  ],
});
