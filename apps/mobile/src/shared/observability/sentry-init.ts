import { initSentry } from './sentry';
import { MODO_DEMO } from '../../demo/flag';

/**
 * QUI-365 — ejecuta `initSentry()` como efecto de lado AL IMPORTAR este módulo, no cuando
 * alguien decida llamarlo. Ver `./sentry.ts` para el porqué de la config; acá va solo el
 * porqué de que este archivo exista separado.
 *
 * FIX POST-REVISIÓN (hallazgo de revisión — "errores del demo no deben llegar a Sentry de
 * producción"): `app.config.ts` ya deja el build demo (`APP_VARIANT=demo`) SIN
 * `EXPO_PUBLIC_SENTRY_DSN`, y `initSentry()` (`./sentry.ts`) ya no-opea sin DSN — pero ese es un
 * guard indirecto (depende de que nadie configure un DSN junto con `EXPO_PUBLIC_MOCK_DEMO=true`
 * por error). Acá, en el único punto de entrada real de Sentry, el guard es EXPLÍCITO y directo:
 * con `MODO_DEMO` no se llama `initSentry()` en absoluto, sin importar qué DSN esté seteado —
 * los datos 100% mock del demo (ids, ubicaciones falsas, "conductores" ficticios) nunca deben
 * mezclarse con la telemetría real de la flota en producción.
 *
 * Antes, `index.js` importaba `initSentry` y la llamaba como sentencia suelta más abajo en el
 * archivo. Eso no alcanza: `babel-preset-expo` transpila los imports ESM a `require(...)`
 * emitidos ANTES que cualquier sentencia normal del archivo, sin importar el orden textual. Los
 * imports de `expo`, `react-native-background-geolocation`, `./App` y
 * `./src/gps/headless-task` también se hoisteaban por encima de la llamada a `initSentry()` —
 * así que esos módulos terminaban evaluándose ANTES de que Sentry estuviera inicializado. Un
 * throw durante esa evaluación (el escenario exacto del headless task tras un app kill, que
 * QUI-365 existe para cubrir) no llegaba a Sentry: `captureException` era no-op y el handler
 * nativo de crashes todavía no estaba instalado.
 *
 * Al mover la llamada real a este módulo (que la ejecuta en su propio top-level) e importarlo
 * en `index.js` POR SU SOLO EFECTO como primera línea del archivo, el hoisting pasa a jugar a
 * favor: este import es el primero entre los imports de `index.js`, así que su `require` se
 * emite antes que el de `expo`, `react-native-background-geolocation`, `./App` y
 * `./src/gps/headless-task`.
 */
if (!MODO_DEMO) {
  initSentry();
}
