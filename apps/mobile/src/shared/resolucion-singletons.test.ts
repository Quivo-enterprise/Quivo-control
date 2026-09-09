import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** `require(...)` como import (en vez de `require.resolve`, que sí está permitido) dispara
 * `@typescript-eslint/no-require-imports` — leemos el JSON a mano para no pelear con esa regla
 * por dos lecturas puntuales de `package.json`. */
function leerJson(ruta: string): unknown {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/**
 * Bug real que este test blinda: el APK de producción se instalaba pero crasheaba al abrir con
 * `TypeError: Cannot read property 'useState' of null` dentro de `useFonts` (llamado desde
 * `App.tsx`). La causa: `@expo-google-fonts/montserrat` (y sus hermanos `oxanium`,
 * `jetbrains-mono`) no declaran NINGUNA `dependencies` en su `package.json` — sólo tienen
 * `main`. pnpm les arma un `node_modules` propio vacío, así que su `import ... from 'expo-font'`
 * (ver `useFonts.js` dentro de cada paquete) resuelve por walk-up de Node hasta el hoist dir
 * COMPARTIDO por todo el monorepo (`node_modules/.pnpm/node_modules/`) en vez de encontrar la
 * copia que declara `apps/mobile/package.json`. Mientras hubiera una sola versión de
 * `expo-font` en todo el store pnpm ese walk-up llegaba bien de pura casualidad — hasta que
 * `apps/mobile-mockup` (Expo ~52 / React 18, movido a `archivo/mobile-mockup`, ver su README)
 * entró al workspace con los mismos `@expo-google-fonts/*` y trajo una segunda copia de
 * `expo-font`/React Native: a partir de ahí el walk-up podía devolver cualquiera de las dos.
 *
 * Este test dispara el mismo mecanismo de resolución que causó el bug —`require.resolve` con
 * `paths` apuntando al `node_modules` (vacío) de un paquete sin `dependencies` propias— y falla
 * si `expo-font` visto desde `@expo-google-fonts/montserrat` deja de ser la MISMA copia física
 * que ve `apps/mobile`. Es la señal más rápida y barata de que volvió a aparecer un segundo
 * consumidor de Expo/React Native en el store pnpm (por ejemplo, si alguien reintroduce
 * `apps/mobile-mockup` al workspace): corre en segundos con `pnpm test`, sin exportar el bundle
 * completo. El complemento — que sí ejercita el bundle real que arma Metro, con la guardia de
 * singletons de `apps/mobile/metro.config.js` de por medio — es
 * `scripts/assert-bundle-singletons.mjs` sobre `expo export --dump-sourcemap` (ver el paso de
 * CI en `.github/workflows/ci.yml`).
 *
 * `react` NO se prueba acá con el mismo mecanismo ambiental (a diferencia de lo que sugiere el
 * patrón de arriba para `expo-font`), y es a propósito: `expo-font` sólo lo usa `apps/mobile`
 * en todo el workspace, así que su ambigüedad en el store es siempre síntoma de un bug. `react`
 * en cambio SÍ tiene, por diseño, dos versiones conviviendo en el store pnpm:
 * `apps/web`/`apps/landing`/`packages/design-system` fijan `react@18.3.1` (cada uno con su
 * propio bundler — Next.js/Vite/tsup, no Metro) mientras `apps/mobile` fija `19.1.0`. La
 * resolución AMBIENTAL de Node para `react` visto "sin dueño" —como lo ve
 * `@expo-google-fonts/montserrat`, sin pasar por Metro— es ambigua entre esas dos versiones
 * incluso hoy, y eso es esperado: la guardia que impide que el BUNDLE final de `apps/mobile`
 * arrastre las dos vive en `metro.config.js` (fuerza `originModulePath` a `apps/mobile` sólo
 * dentro del pipeline de Metro) y la verifica `scripts/assert-bundle-singletons.mjs` sobre el
 * bundle real — no la resolución ambiental de Node que ejercita este archivo. Un test que
 * comparara `react` visto desde `@expo-google-fonts/montserrat` contra `apps/mobile` de la
 * misma forma que `expo-font` estaría siempre en rojo por esta razón, sin que sea un bug: por
 * eso acá sólo dejamos una guardia barata de que `apps/mobile` resuelve su PROPIO `react` a la
 * versión que declara su propio `package.json`.
 */
describe('resolución de paquetes que deben ser singleton en apps/mobile', () => {
  it('expo-font resuelve a la misma copia física desde @expo-google-fonts/montserrat que desde apps/mobile', () => {
    const desdeGoogleFonts = require.resolve('expo-font', {
      paths: [require.resolve('@expo-google-fonts/montserrat/package.json')],
    });
    const desdeMobile = require.resolve('expo-font');

    expect(desdeGoogleFonts).toBe(desdeMobile);
  });

  it('react resuelve, desde apps/mobile, exactamente a la versión que declara apps/mobile/package.json', () => {
    const mobilePackageJson = leerJson(require.resolve('../../package.json')) as {
      dependencies: Record<string, string>;
    };
    const versionDeclarada = mobilePackageJson.dependencies.react;

    const reactPackageJson = leerJson(require.resolve('react/package.json')) as { version: string };

    expect(reactPackageJson.version).toBe(versionDeclarada);
  });
});
