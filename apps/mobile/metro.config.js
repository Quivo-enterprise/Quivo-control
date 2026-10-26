// @ts-check
const path = require('path');
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

/**
 * Guardia de singletons — el bug que crasheaba el APK de producción (`TypeError: Cannot read
 * property 'useState' of null` dentro de `useFonts`) no era un bug de `expo-font`: era que el
 * bundle final llevaba DOS copias de React, de React Native y de `expo-font` porque
 * `apps/mobile-mockup` (movido a `archivo/mobile-mockup`, fuera del workspace) traía un Expo/
 * React Native más viejo con los mismos `@expo-google-fonts/*`. Esos paquetes no declaran
 * `dependencies` NI `peerDependencies` en su `package.json` (sólo tienen `main`), así que pnpm
 * les arma un `node_modules` propio vacío y sus `import ... from 'react'` / `from 'expo-font'`
 * caen por walk-up de Node hasta el hoist dir compartido de todo el monorepo
 * (`node_modules/.pnpm/node_modules/`) — un solo directorio para el store entero, sin noción de
 * "qué app lo pidió". Sacar el mockup del workspace arregló el caso conocido, pero no la clase
 * de bug: `react@18.3.1` sigue en el store porque lo usan `apps/web`, `apps/landing` y
 * `packages/design-system`, y cualquier otro paquete que se agregue más adelante sin
 * `dependencies` (como estos `@expo-google-fonts/*`) vuelve a caer en el mismo hoist dir
 * ambiguo y puede volver a levantar la versión equivocada.
 *
 * La solución: para los paquetes que DEBEN ser singleton en el bundle de esta app, forzamos que
 * la resolución de Metro arranque su búsqueda de `node_modules` desde `apps/mobile/` (donde
 * están declarados como dependencia directa) en vez de desde el archivo que hace el `import` —
 * eso es lo que hace pisar `context.originModulePath` antes de delegar en el resolver real: la
 * búsqueda de Metro camina hacia arriba desde ahí y encuentra el `apps/mobile/node_modules/<paquete>`
 * correcto ANTES de llegar al hoist dir ambiguo, sin importar si quien pidió el módulo fue
 * `apps/mobile/App.tsx` o un paquete de terceros con `node_modules` vacío como
 * `@expo-google-fonts/montserrat`.
 *
 * Trampa: `expo-asset`, `expo-modules-core` y `react-dom` están en la lista por blindaje a
 * futuro (para el día que se agreguen como dependencia directa, o que algún paquete sin
 * `dependencies` los pida), pero HOY `apps/mobile/package.json` no los declara directo — sólo
 * llegan de forma transitiva (p. ej. `expo-modules-core` vía `expo`, que sí resuelve bien porque
 * `expo` declara sus propias `dependencies` y pnpm arma su `node_modules` anidado correcto). Si
 * forzáramos el origen para ELLOS también de forma incondicional, cualquier resolución interna
 * de `expo` → `expo-modules-core` (que hoy funciona perfecto vía resolución anidada normal)
 * rompería, porque `apps/mobile/node_modules/expo-modules-core` no existe. Por eso el fallback:
 * si forzar el origen a `apps/mobile` no encuentra el paquete ahí (ni caminando hacia arriba
 * hasta la raíz del workspace), reintentamos con el `context` original — dejamos que la
 * resolución anidada de siempre (la que pnpm ya arma bien para paquetes con `dependencies`
 * declaradas) siga su curso. Esto no tapa el bug: sólo cede el paso quirúrgicamente en el único
 * caso donde forzar el origen sería peor que no forzarlo.
 *
 * Nota (corregida — la versión anterior de este comentario afirmaba algo falso, verificado en
 * runtime): NO es cierto que `getSentryExpoConfig` (arriba) ya haya instalado su propio
 * `resolveRequest`. `getSentryExpoConfig(projectRoot, options)` sólo llama a `withSentryResolver`
 * cuando `options.includeWebReplay === false` (ver
 * `@sentry/react-native/dist/js/tools/metroconfig.js`), y acá se lo llama sin opciones
 * (`getSentryExpoConfig(__dirname)`) — así que `resolverSentry` es `null` y la rama
 * `resolverSentry ? … : …` de abajo SIEMPRE toma el segundo brazo hoy. El Debug ID de Sentry sale
 * del serializer (`unstableBeforeAssetSerializationDebugIdPlugin`, ver el comentario de QUI-365
 * arriba), no del resolver: los source maps nunca estuvieron en riesgo por esto.
 *
 * El motivo real para delegar en `ctx.resolveRequest` (y no llamar a mano al resolver por
 * defecto de Metro) es que, en tiempo de `expo export`/build, `ctx.resolveRequest` YA es la
 * cadena de resolvers que arma `@expo/cli` (`withMetroResolvers`/
 * `withMetroMutatedResolverContext`) — resuelve alias de plataforma, assets, y cualquier otro
 * resolver custom que Expo agregue. Resolver con el default de Metro a mano se saltearía toda esa
 * cadena. Igual conservamos el encadenado defensivo con `resolverSentry` por si una versión
 * futura de `@sentry/react-native` empieza a instalar un `resolveRequest` acá (por ejemplo si
 * este archivo pasara a llamar con `includeWebReplay: false`), para no tener que volver a auditar
 * esto entonces.
 */
// Fuente de verdad única: ./paquetes-singleton.cjs (la comparte scripts/assert-bundle-singletons.mjs
// para no mantener esta lista duplicada a mano en los dos lados — ver el comentario ahí).
const PAQUETES_SINGLETON = require('./paquetes-singleton.cjs');

/** Extrae el nombre de paquete de un specifier, incluyendo subpaths (`react-native/Libraries/...`,
 * `expo-font/build/...`) y paquetes con scope (`@org/paquete/subpath`). Los ocho paquetes de
 * `PAQUETES_SINGLETON` no tienen scope, así que alcanza con el primer segmento salvo que empiece
 * con `@` (ahí el nombre son los primeros dos segmentos) — eso evita, por ejemplo, que
 * `@expo/vector-icons` se confunda con `expo`. */
function nombrePaquete(moduleName) {
  const segmentos = moduleName.split('/');
  return moduleName.startsWith('@') ? segmentos.slice(0, 2).join('/') : segmentos[0];
}

/** Mismo duck-typing que usa `@expo/cli` internamente para decidir si un error del resolver
 * significa "no encontré este módulo" (seguro reintentar con otro `originModulePath`) o
 * cualquier otra cosa (un bug del resolver, un `InvalidPackageError`, un
 * `PackagePathNotExportedError` por `exports` mal declarados, etc. — reintentar con otro origen
 * no arregla nada de eso, y tragárselo en silencio esconde el error real). Ver
 * `withMetroResolvers`/`metroErrors.js` en
 * `@expo/cli/build/src/start/server/metro/metroErrors.js`: es exactamente esta misma
 * comprobación. No importamos esas funciones directo desde `@expo/cli` porque viven en un path
 * de build interno, fuera de los `exports` del paquete — replicar el duck-typing acá es más
 * estable que depender de un path privado que puede desaparecer en cualquier bump de versión. */
function esErrorDeResolucion(error) {
  if (!error) return false;
  const nombreConstructor = error.constructor && error.constructor.name;
  const esFailedToResolveName = 'extraPaths' in error && nombreConstructor === 'FailedToResolveNameError';
  const esFailedToResolvePath =
    'candidates' in error &&
    nombreConstructor === 'FailedToResolvePathError' &&
    !String(error.message).includes('Importing native-only module');
  return esFailedToResolveName || esFailedToResolvePath;
}

const resolverSentry = config.resolver.resolveRequest;
const origenForzado = path.join(__dirname, 'metro.config.js');

config.resolver.resolveRequest = (context, moduleName, ...resto) => {
  const delegarEn = (ctx) =>
    resolverSentry ? resolverSentry(ctx, moduleName, ...resto) : ctx.resolveRequest(ctx, moduleName, ...resto);

  if (!PAQUETES_SINGLETON.includes(nombrePaquete(moduleName))) {
    return delegarEn(context);
  }

  try {
    return delegarEn({ ...context, originModulePath: origenForzado });
  } catch (error) {
    if (!esErrorDeResolucion(error)) {
      // No es "no encontré el módulo forzando el origen" — es otra cosa. Reintentar con el
      // context original no lo arregla, y tragárnoslo acá dejaría un error real invisible
      // (la cadena de Expo en withMetroResolvers re-lanza a propósito estos casos). Lo dejamos
      // propagar.
      throw error;
    }
    // Ver la trampa de expo-asset/expo-modules-core/react-dom en el comentario de arriba:
    // si apps/mobile no tiene este paquete como dependencia directa, no hay nada que forzar —
    // volvemos a la resolución anidada normal en vez de romper algo que hoy funciona. Dejamos
    // rastro de que la guardia cedió el paso: si un paquete empieza a pasar por acá seguido,
    // es candidato a declararse como dependencia directa de apps/mobile en vez de depender del
    // hoist dir compartido.
    console.warn(
      `[metro.config.js] "${moduleName}" (pedido desde "${context.originModulePath}") no resolvió ` +
        'forzando el origen a apps/mobile; cae a la resolución anidada normal.',
    );
    return delegarEn(context);
  }
};

// `.claude-flow/` (estado de herramientas de IA, sin seguimiento en git) crea y borra `.lock` todo
// el tiempo: el watcher de Metro intentaba vigilar uno que ya no existía y se caía con ENOENT.
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  /[\\/]\.claude-flow[\\/].*/,
];

module.exports = config;
