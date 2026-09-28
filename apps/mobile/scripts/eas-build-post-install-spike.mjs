#!/usr/bin/env node
/**
 * Spike `ubicación fluida` (Fase C, investigación (b) del brief de fix del launcher):
 * SOLO para el perfil `spike` de `eas.json` (`EAS_BUILD_PROFILE=spike`). Este script
 * corre como parte del hook `eas-build-post-install` (`package.json`, ver doc oficial
 * https://docs.expo.dev/build-reference/npm-hooks/ — para Android ese hook corre
 * "once after ... npm install and npx expo prebuild (if needed)", es decir DESPUÉS de
 * `expo prebuild` pero ANTES de que Gradle corra `:app:assembleDebug`).
 *
 * Por qué hace falta: verificado en dispositivo que el perfil `spike`
 * (`gradleCommand: ":app:assembleDebug"`, `developmentClient: false`) igual muestra el
 * launcher de expo-dev-client ("development build, conectate a Metro") en vez de abrir
 * la app directo con el bundle embebido. `developmentClient: false` solo controla si
 * `expo-dev-client` corre en modo "dev client" (splash de conexión, etc.) — pero
 * `expo-dev-client`/`expo-dev-launcher`/`expo-dev-menu` son MÓDULOS NATIVOS que Expo
 * Autolinking (https://docs.expo.dev/modules/autolinking/) sigue linkeando en
 * CUALQUIER build mientras la dependencia esté en package.json y no esté excluida —
 * developmentClient:false no los excluye del autolinking, solo cambia config JS del
 * propio expo-dev-client. El autolinking de Android se resuelve en tiempo de Gradle
 * (`useExpoModules()` en settings.gradle invoca `expo-modules-autolinking resolve` en
 * cada build, leyendo `package.json` en ese momento — NO es algo que `expo prebuild`
 * hornee de una vez), así que basta con que este archivo quede escrito ANTES de que
 * Gradle corra, y el hook `eas-build-post-install` (que EAS corre antes de invocar
 * Gradle) es exactamente ese punto.
 *
 * Qué hace: si (y SOLO si) `EAS_BUILD_PROFILE === 'spike'`, agrega
 * `expo.autolinking.android.exclude` a este `package.json` con los 4 módulos de dev
 * client (confirmado con `npx expo-modules-autolinking resolve --platform android`:
 * expo-dev-client, expo-dev-launcher, expo-dev-menu, expo-dev-menu-interface — el
 * cuarto es una dependencia transitiva de los otros tres, sin entrada propia en
 * package.json). Clave verificada contra la doc oficial de autolinking (SDK 54):
 * `expo.autolinking.android.exclude` (override de plataforma, mayor precedencia que
 * `expo.autolinking.exclude` a secas).
 *
 * Sin `EAS_BUILD_PROFILE=spike` (perfiles `development`/`production`, o cualquier
 * corrida local sin esa env var) este script no toca nada — exit temprano, cero
 * cambio de comportamiento fuera del spike (invariante ya establecido en
 * `app.config.ts`/`withAndroidSpikeDebugEmbed.js`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RUTA_PACKAGE_JSON = path.resolve(AQUI, '..', 'package.json');

const MODULOS_DEV_LAUNCHER = [
  'expo-dev-client',
  'expo-dev-launcher',
  'expo-dev-menu',
  'expo-dev-menu-interface',
];

function main() {
  if (process.env.EAS_BUILD_PROFILE !== 'spike') {
    console.log(
      '[QUIVO][eas-build-post-install-spike] EAS_BUILD_PROFILE != "spike" — no se toca package.json.',
    );
    return;
  }

  const crudo = readFileSync(RUTA_PACKAGE_JSON, 'utf8');
  const json = JSON.parse(crudo);

  json.expo = json.expo ?? {};
  json.expo.autolinking = json.expo.autolinking ?? {};
  json.expo.autolinking.android = json.expo.autolinking.android ?? {};

  const excludeExistente = Array.isArray(json.expo.autolinking.android.exclude)
    ? json.expo.autolinking.android.exclude
    : [];
  const excludeFinal = Array.from(new Set([...excludeExistente, ...MODULOS_DEV_LAUNCHER]));
  json.expo.autolinking.android.exclude = excludeFinal;

  writeFileSync(RUTA_PACKAGE_JSON, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(
    `[QUIVO][eas-build-post-install-spike] EAS_BUILD_PROFILE=spike — excluidos del autolinking de Android: ${excludeFinal.join(', ')}`,
  );
}

main();
