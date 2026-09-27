/**
 * Flag de build para el modo demo del APK del conductor (`docs/plan-apk-demo-conductor.md`).
 *
 * `EXPO_PUBLIC_MOCK_DEMO=true` en tiempo de build (leído por Expo/Metro, ver `app.config.ts`
 * para la variante `APP_VARIANT=demo` del `applicationId`) activa todo `src/demo/`: la app
 * corre 100% offline con datos mock, sin backend ni SDK de Transistorsoft. Sin el flag (build
 * normal) esta constante es `false` y el comportamiento de la app real no cambia en NADA — los
 * puntos de swap (`App.tsx`, `gps-provider.tsx`, `perfil-screen.tsx`, `index.js`) eligen la
 * implementación real o demo a nivel de MÓDULO (no dentro de un componente), así que es seguro
 * que sea una constante evaluada una sola vez al arrancar el proceso — no cambia entre renders.
 */
export const MODO_DEMO = process.env.EXPO_PUBLIC_MOCK_DEMO === 'true';
