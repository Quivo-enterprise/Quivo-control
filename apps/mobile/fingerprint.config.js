// @ts-check
/**
 * Configuración de `@expo/fingerprint` (la usa `runtimeVersion: { policy: 'fingerprint' }` al
 * construir el APK y al correr `eas update`).
 *
 * Problema que resuelve: `app.config.ts` mete en la config resuelta valores que vienen del
 * entorno de EAS y que NO existen al correr `eas update` desde otra máquina: la API key de
 * Google Maps (variable SENSIBLE), la licencia de Transistorsoft (SENSIBLE), el perfil de build
 * (`EAS_BUILD_PROFILE`: 'production' en el build, 'local' fuera de él) y los slugs de Sentry.
 * Sin neutralizarlos el hash del APK y el del update nunca coinciden y el OTA no llega.
 *
 * Qué hace: antes de hashear el bloque `expoConfig`, reemplaza esos valores por constantes.
 * Todo lo demás (dependencias nativas, plugins, permisos, versión de SDK, etc.) sigue contando,
 * así que un cambio nativo real SÍ cambia el runtimeVersion.
 *
 * Trade-off aceptado: cambiar el VALOR de una de esas claves (rotarla) no cambia el fingerprint.
 * Es correcto: rotar una clave exige un build nuevo igual, pero no hace incompatible al JS.
 */

/** @type {import('@expo/fingerprint').Config} */
const config = {
  fileHookTransform: (source, chunk) => {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk == null) {
      return chunk;
    }
    const expoConfig = JSON.parse(chunk.toString());

    // Google Maps: la presencia de la sección sigue contando, solo se neutraliza el valor.
    expoConfig.android = expoConfig.android ?? {};
    expoConfig.android.config = {
      ...(expoConfig.android.config ?? {}),
      googleMaps: { apiKey: '<env>' },
    };

    // extra.easBuildProfile (EAS_BUILD_PROFILE) no es nativo.
    if (expoConfig.extra) delete expoConfig.extra.easBuildProfile;

    // Plugins con props derivadas del entorno.
    if (Array.isArray(expoConfig.plugins)) {
      expoConfig.plugins = expoConfig.plugins.map((plugin) => {
        if (!Array.isArray(plugin)) return plugin;
        const [name, props] = plugin;
        if (name === 'react-native-background-geolocation') {
          return [name, { ...props, license: '<env>' }];
        }
        if (typeof name === 'string' && name.startsWith('@sentry/react-native')) {
          return [name, { ...props, organization: '<env>', project: '<env>' }];
        }
        return plugin;
      });
    }

    // Misma serialización estable que usa @expo/fingerprint (claves ordenadas).
    return JSON.stringify(sortKeys(expoConfig));
  },
};

/** @param {unknown} value */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

module.exports = config;
