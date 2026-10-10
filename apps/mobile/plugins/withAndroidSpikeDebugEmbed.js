const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Spike `ubicación fluida` (`docs/plan-ubicacion-fluida.md`, Fase B/C — parte de investigación
 * (b)): config plugin SOLO para el perfil `spike` de `eas.json` (`android.gradleCommand:
 * ":app:assembleDebug"`), nunca agregado al array de `plugins` de `app.config.ts` salvo con
 * `EXPO_PUBLIC_SPIKE === '1'` — ver el `if` alrededor del `push` en `app.config.ts`. Con eso, este
 * archivo ni siquiera se ejecuta en un build normal (`production`/`development`): cero riesgo de
 * tocar ese build.gradle.
 *
 * Qué resuelve: el SDK de Transistorsoft (`react-native-background-geolocation`) es gratis SOLO en
 * builds `DEBUG` de Android (ver el README del paquete, sección "Licensing": "The SDK is fully
 * functional in DEBUG builds — no license required. A license is required only for RELEASE
 * builds."). El release paga (build 12, versionCode 13) sí exige la licencia — el trial vence
 * 2026-10-25 — así que el spike, que necesita instalarse SIN esa compra, tiene que salir de
 * `:app:assembleDebug` (variante `debug`, `android:debuggable="true"`/`BuildConfig.DEBUG=true`).
 *
 * El problema es que el template de Expo/RN (`react { ... }` en `android/app/build.gradle`)
 * define, por default, `debuggableVariants = ["debug"]` (implícito, sin la línea explícita —
 * confirmado contra el template `expo-template-bare-minimum` de SDK 54): para CUALQUIER variante
 * en esa lista, el plugin de Gradle de React Native SALTEA el empaquetado del bundle JS/assets,
 * porque asume que esa variante va a cargar el bundle desde Metro (`adb reverse` + dev server).
 * Un APK standalone del spike no tiene Metro corriendo — necesita el JS embebido igual que un
 * release. `debuggableVariants = []` fuerza que TODAS las variantes (incluida `debug`) empaqueten
 * el bundle, exactamente el mismo paso que usa `:app:assembleRelease` hoy (perfil `production`).
 *
 * Alternativas evaluadas y descartadas (ver el reporte de la Parte 1(b) del spike):
 * - Variante de build custom (p. ej. "spikeRelease" con `debuggable true`): agrega una fuente de
 *   verdad nueva en `android/app/build.gradle` que `expo prebuild` no genera — más superficie que
 *   mantener para algo descartable.
 * - Dejar `expo-dev-client` autolinkeado: insuficiente. `developmentClient: false` no alcanza en un
 *   build `debug` — el launcher de dev-client aparecía igual en el APK del spike. Desde `4010c75`
 *   el hook `scripts/eas-build-post-install-spike.mjs` excluye 4 módulos de dev del autolinking
 *   cuando `EAS_BUILD_PROFILE=spike`; este plugin solo se ocupa de embeber el bundle JS.
 */
module.exports = function withAndroidSpikeDebugEmbed(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error(
        '[QUIVO][withAndroidSpikeDebugEmbed] android/app/build.gradle no es Groovy — no se puede inyectar debuggableVariants',
      );
    }
    const contenido = modConfig.modResults.contents;
    // OJO: el template default de Expo/RN ya trae `debuggableVariants` mencionado en un
    // COMENTARIO dentro de `react { ... }` (`// debuggableVariants = ["liteDebug", "prodDebug"]`,
    // ver `expo-template-bare-minimum`) — un `includes('debuggableVariants')` a secas matchea ESE
    // comentario y nunca inyecta nada (bug real, encontrado al verificar `expo prebuild`
    // localmente). El regex de abajo exige la línea ACTIVA (sin `//` antes del identificador, al
    // inicio de línea salvo espacios) — eso sí distingue "ya lo seteamos antes" de "está
    // comentado en el template".
    const yaSeteado = /^\s*debuggableVariants\s*=/m.test(contenido);
    if (yaSeteado) {
      // Ya está seteado de verdad (p. ej. corrida repetida de prebuild sin --clean) — no duplicar.
      return modConfig;
    }
    const marcaReactBlock = /react\s*\{/;
    if (!marcaReactBlock.test(contenido)) {
      throw new Error(
        '[QUIVO][withAndroidSpikeDebugEmbed] No se encontró el bloque react { ... } en android/app/build.gradle',
      );
    }
    modConfig.modResults.contents = contenido.replace(
      marcaReactBlock,
      `react {\n    // Spike ubicación fluida (EXPO_PUBLIC_SPIKE=1): sin esto, la variante ` +
        `"debug" (assembleDebug, la que exige este perfil para que el SDK de Transistorsoft no ` +
        `pida licencia) no empaqueta el bundle JS — ver el docblock de ` +
        `withAndroidSpikeDebugEmbed.js.\n    debuggableVariants = []`,
    );
    return modConfig;
  });
};
