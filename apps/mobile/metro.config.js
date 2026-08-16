// @ts-check
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/**
 * QUI-365 — sin este archivo, el bundle JS no lleva Debug ID y los source maps que sube
 * `sentry.gradle` (registrado por el plugin `@sentry/react-native/expo` en `app.config.ts`) no
 * matchean el bundle instalado en el teléfono: los stack traces en Sentry siguen ilegibles
 * aunque `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` estén bien cargados.
 *
 * `getSentryExpoConfig(projectRoot)` (`@sentry/react-native/metro`, ver
 * `node_modules/@sentry/react-native/dist/js/tools/metroconfig.js`) es un reemplazo drop-in de
 * `getDefaultConfig` de `expo/metro-config`: internamente llama a ese mismo `getDefaultConfig`
 * — así que sigue heredando la detección automática del monorepo pnpm/Turbo (agrega el
 * `node_modules` de este paquete y el de la raíz del workspace vía `getModulesPaths`, sin que
 * haga falta declarar `watchFolders`/`nodeModulesPaths` a mano acá) — y encima cablea el
 * serializer que agrega el Debug ID al bundle y a los source maps
 * (`unstableBeforeAssetSerializationDebugIdPlugin`). El proyecto no usa NativeWind ni ningún
 * otro wrapper de Metro, así que no hace falta anidar nada más.
 */
const config = getSentryExpoConfig(__dirname);

module.exports = config;
