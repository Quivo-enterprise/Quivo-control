/**
 * Validación de la API key de Google Maps SDK for Android en el config de Expo
 * (`app.config.ts`). SIN la meta-data `com.google.android.geo.API_KEY` el SDK lanza
 * `IllegalStateException: API key not found` al crear el primer `MapView` y la app se CIERRA
 * (no es un mapa en blanco), así que un build de EAS que no sea `development` debe fallar en
 * build time en vez de entregar un APK que crashea al abrir el mapa.
 *
 * Es `.cjs` a propósito: Expo transpila `app.config.ts` pero resuelve sus imports con Node
 * plano, sin loader de TypeScript (importar un `.ts` rompe la carga del config).
 */

/** `ok` con key; sin key: `fallar` en un build de EAS que no sea el perfil `development`,
 * `advertir` en cualquier otro caso (corridas locales y dev client).
 * @param {{ GOOGLE_MAPS_ANDROID_API_KEY?: string, EAS_BUILD?: string, EAS_BUILD_PROFILE?: string }} env
 * @returns {'ok' | 'advertir' | 'fallar'}
 */
function evaluarClaveMapas(env) {
  if (env.GOOGLE_MAPS_ANDROID_API_KEY) return 'ok';
  const esBuildEas = !!env.EAS_BUILD;
  const esDesarrollo = env.EAS_BUILD_PROFILE === 'development';
  return esBuildEas && !esDesarrollo ? 'fallar' : 'advertir';
}

module.exports = { evaluarClaveMapas };
