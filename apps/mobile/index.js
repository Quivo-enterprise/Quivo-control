import { initSentry } from './src/shared/observability/sentry';

// QUI-365: tiene que ir ANTES que cualquier otro import de la app. Este archivo es el único
// punto de entrada que Android evalúa tanto para el JS normal (hilo de UI, ver
// `registerRootComponent` abajo) como para el headless task de Transistorsoft (ver el bloque
// `registerHeadlessTask` más abajo) — el SDK nativo arranca un contexto JS SEPARADO para el
// headless task tras el kill de la app, y ese contexto también ejecuta `index.js` desde cero.
// Inicializar Sentry acá (y no adentro de un componente de React, que nunca se monta en el
// contexto headless) es lo único que garantiza que un crash headless también quede reportado.
initSentry();

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
