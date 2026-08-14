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
