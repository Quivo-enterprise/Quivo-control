# @quivo/mobile

App Expo (React Native), Android. En este cycle contiene únicamente el **arnés del spike
GPS** (QUI-216) — la app real del conductor (login por vehículo, paquete offline, tracking
en producción) llega en QUI-235..241 (M3). Ver `docs/spike-gps.md` para el protocolo y
estado del spike.

## Notas de desarrollo

- `pnpm --filter @quivo/mobile run typecheck` / `lint` / `test` corren en Node (no requieren
  Android SDK ni emulador) — `test` cubre la lógica pura de `src/gps/battery-gap-monitor.ts`.
- `build` es un alias de `typecheck` (`tsc --noEmit`): una app Expo no compila a un `dist/`
  vía `tsc` — el bundling real lo hace Metro (`expo start`) y el build de producto es
  `eas build` / `expo run:android`, fuera del pipeline de Turborepo de este repo.
- Para correr la app de verdad hace falta: licencia Transistorsoft en `app.json`, Android
  SDK/emulador o dispositivo físico, y `npx expo prebuild -p android && npx expo run:android`
  (o un dev-build EAS). Ninguno de los dos está disponible en este entorno — ver
  `docs/spike-gps.md` para el protocolo que debe correr quien sí los tenga.
