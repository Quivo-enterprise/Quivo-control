// QUI-365: este import tiene que ser LA PRIMERA línea de todo el archivo, y a propósito no
// nombra ningún binding — importa solo por su efecto de lado. Los imports ESM se hoistean por
// encima de cualquier sentencia suelta (`babel-preset-expo` los transpila a `require(...)`
// emitidos arriba de todo el código del archivo), así que una llamada a `initSentry()` escrita
// como sentencia normal —aunque esté primera en el texto— terminaba corriendo DESPUÉS de que
// los imports de abajo (`expo`, `react-native-background-geolocation`, `./App`,
// `./src/gps/headless-task`) ya se hubieran evaluado, porque esos imports también se hoistean.
// Por eso el init real vive en su propio módulo, que lo ejecuta como side effect al importarse
// (ver el detalle completo en `src/shared/observability/sentry-init.ts`), y ese import va antes
// que cualquier otro acá: así el hoisting preserva el orden real de ejecución. Este archivo es
// el único punto de entrada que Android evalúa tanto para el JS normal (hilo de UI, ver
// `registerRootComponent` abajo) como para el headless task de Transistorsoft (ver el bloque
// `registerHeadlessTask` más abajo) — el SDK nativo arranca un contexto JS SEPARADO para el
// headless task tras el kill de la app, y ese contexto también ejecuta `index.js` desde cero.
import './src/shared/observability/sentry-init';

import { registerRootComponent } from 'expo';
import BackgroundGeolocation from 'react-native-background-geolocation';
import App from './App';
import { tareaHeadlessUbicacion } from './src/gps/headless-task';

registerRootComponent(App);

// QUI-216: único lugar donde el SDK permite registrar el headless task (doc oficial de
// Transistorsoft — "index.js is the ONLY place where you can register your headless-task").
// Sin esto, `enableHeadless: true` en `background-geolocation.config.ts` no tiene efecto: el
// SDK nativo sigue grabando en su SQLite interna tras el kill de la app, pero nada copia esos
// puntos a `quivo-outbox.db`, la fuente de verdad de la evidencia legal (RF-67..73).
BackgroundGeolocation.registerHeadlessTask(tareaHeadlessUbicacion);
