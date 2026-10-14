import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

/**
 * QUI-365 — Sentry para `apps/mobile`. Mismo patrón condicional que `apps/api`
 * (`main.ts`/`worker.ts`: `if (process.env.SENTRY_DSN) Sentry.init(...)`): sin
 * `EXPO_PUBLIC_SENTRY_DSN` configurado, `initSentry()` no hace nada — un dev sin DSN no ve
 * ningún efecto, y todas las llamadas a `Sentry.captureException` en el resto del código
 * (ver `src/gps/headless-task.ts`) quedan como no-op seguro, no como error.
 *
 * DÓNDE SE LLAMA (importa, no es arbitrario): tiene que ser desde `index.js`, ANTES de
 * cualquier otro import — es el único archivo que Android evalúa TANTO para el JS normal
 * (hilo de UI, `registerRootComponent`) COMO para el headless task de Transistorsoft
 * (`BackgroundGeolocation.registerHeadlessTask`, ver doc en `headless-task.ts`). El SDK nativo
 * arranca un contexto JS *separado* para correr el headless task tras el kill de la app, pero
 * ambos contextos ejecutan `index.js` desde cero — inicializar Sentry ahí (y no adentro de un
 * componente de React, que nunca se monta en el contexto headless) es lo único que garantiza
 * que un crash en el headless task también quede reportado. Ese es justo el escenario que
 * QUI-365 marca como el peor y el que menos se ve: no hay UI, no hay logs visibles, y sin esto
 * el `catch` de `tareaHeadlessUbicacion` solo deja rastro en `console.error` (que nadie lee en
 * el teléfono de un conductor en ruta).
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: resolveEnvironment(),
    release: resolveRelease(),
    dist: Application.nativeBuildVersion ?? undefined,
    enableNative: true,
    enableNativeCrashHandling: true,
  });

  // OTA: no se etiqueta a mano. `@sentry/react-native` 7.2 trae `expoContextIntegration` por
  // defecto, que adjunta el contexto `ota_updates` (update_id, channel, runtime_version,
  // is_embedded_launch) a cada evento, JS y nativo.
}

/**
 * `EAS_BUILD_PROFILE` (development/production) solo existe en el entorno de build de EAS, no
 * en el bundle JS — `app.config.ts` lo copia a `extra.easBuildProfile` para que
 * `expo-constants` lo pueda leer acá en runtime, sin duplicarlo como una variable
 * `EXPO_PUBLIC_*` separada. Fuera de un build de EAS (p. ej. `expo run:android` local) cae a
 * `development`/`production` según `__DEV__`.
 */
function resolveEnvironment(): string {
  const easBuildProfile = Constants.expoConfig?.extra?.easBuildProfile;
  if (typeof easBuildProfile === 'string' && easBuildProfile !== 'local') {
    return easBuildProfile;
  }
  return __DEV__ ? 'development' : 'production';
}

/**
 * Release tagging (criterio de aceptación QUI-365: "cada evento reportado incluye el tag de
 * release/versión del build"). `Application.nativeApplicationVersion` /
 * `nativeBuildVersion` leen el AndroidManifest REAL empaquetado en el APK instalado — a
 * diferencia de `Constants.expoConfig.version` (el valor de `app.config.ts`, fijo entre
 * builds). Con `autoIncrement: true` en `eas.json` (perfiles `development` y `production`),
 * cada build nuevo sube el `versionCode` nativo y por lo tanto cambia este tag: así se puede
 * atribuir un crash a un APK concreto, no solo a "0.1.0" en general.
 *
 * Formato `<applicationId>@<version>+<build>`, el que recomienda Sentry para que el
 * agrupamiento de releases funcione bien.
 */
function resolveRelease(): string {
  const applicationId = Application.applicationId ?? 'com.quivotech.conductor.app';
  const version = Application.nativeApplicationVersion ?? '0.0.0';
  const build = Application.nativeBuildVersion ?? '0';
  return `${applicationId}@${version}+${build}`;
}
