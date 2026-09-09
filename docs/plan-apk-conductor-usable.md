# Plan — dejar QUIVO Conductor usable en el teléfono

## Contexto

El APK build 8 (`ef298d5`, versionCode 8) se instala pero **no abre**: crashea con
`TypeError: Cannot read property 'useState' of null` dentro de `useFonts`
(`App.tsx:45-55`). El build 7 (18-ago) sí funcionaba. Producción backend está sana
(`GET /v1/health` → `{"status":"ok","db":"up","redis":"up"}`, verificado hoy contra la URL
que usa `eas.json:29`), así que el problema es 100% de la app móvil.

**Reloj externo:** la licencia trial de Transistorsoft vence el **2026-09-15** con
`grace_builds` en cero (`docs/handoff.md:470`). Decisión del CTO: cortar el APK antes de esa
fecha y decidir la compra después. Quedan 7 días, y cada rebuild consume tiempo de ese margen.

**Sobre el rename:** aclarado con el CTO — se refería al nombre que muestra Android al
terminar de instalar. Ya está correcto (`app.config.ts:26`, `name: 'QUIVO Conductor'`;
`android/app/src/main/res/values/strings.xml` generado coincide). **No se tocan los assets de
marca**, aunque `logo.png` y `logo-white.png` digan "QUIVO CONTROL" en login, header y Ajustes.

## Causa raíz (verificada)

`apps/mobile-mockup` entró en el workspace con el rediseño (PR #51, `ca1618a`) trayendo un
segundo mundo completo: **Expo ~52.0.11 / RN 0.76.9 / React 18.3.1**, con los mismos
`@expo-google-fonts/{montserrat,oxanium}@0.4.2` que usa `apps/mobile` (Expo 54 / RN 0.81.5 /
React 19.1.0).

Los paquetes `@expo-google-fonts/*` **no declaran ninguna dependencia ni peerDependency**
(verificado: su `package.json` solo tiene `main`). pnpm les crea una instancia sin peer-suffix
y con `node_modules` vacío, así que su `import { useState } from 'react'` y su
`import { loadAsync } from 'expo-font'` caen por walk-up al hoist dir oculto
`node_modules/.pnpm/node_modules/`, que es **uno solo para todo el monorepo**. Estado medido
hoy en ese directorio:

```
expo-font         -> expo-font@14.0.12_expo@52.0.49_...   <-- SDK 52
expo-modules-core -> expo-modules-core@2.2.3              <-- SDK 52
react             -> react@19.1.0
```

`expo-font@52` requiere eager `FontUtils.js`, que hace `require('react-native')` a nivel de
módulo y arrastra RN 0.76.9 entero. El bundle exportado localmente
(`expo export --platform android`, 2425 módulos) contiene **las dos copias**: `react@19.1.0`
y `react@18.3.1`, `react-native@0.81.5` (418 módulos) y `react-native@0.76.9` (423),
`expo-font` de SDK 54 y de SDK 52.

Antes de #51 había una sola instancia de cada uno, así que la caída al hoist dir acertaba por
casualidad — de ahí que el build 7 funcione y el 8 no. **El PR que rompió la app móvil no tocó
`apps/mobile/package.json`**: la rompió agregando otra app al workspace.

Qué versión concreta de React queda en ese slot depende del orden de instalación, y cuatro
paquetes piden 18.3.1 (`web`, `landing`, `design-system`, el mockup) contra uno solo que pide
19.1.0 (`mobile`). En la instalación limpia de EAS cayó del lado 18 y `useFonts` leyó
`ReactCurrentDispatcher.current === null`, porque quien renderiza es el reconciler de RN 0.81.5
sobre React 19. **Ese último eslabón es inferencia, no está reproducido** — pero es indistinto
para la decisión: dos copias de React y dos de React Native en un bundle son fatales igual.

## Cambios

### 1. Sacar `apps/mobile-mockup` del workspace

`git mv apps/mobile-mockup archivo/mobile-mockup` (38 archivos, 392K; conserva historia).
`pnpm-workspace.yaml` usa el glob `apps/*`, así que moverlo fuera de `apps/` lo saca sin tocar
la config. Borrar su `node_modules` y regenerar `pnpm-lock.yaml` con `pnpm install`.

Con eso desaparecen del store el segundo `expo-font`, el segundo `react-native` y
`expo-modules-core@2.2.3`.

### 2. Guardia de singletons en `apps/mobile/metro.config.js`

Sacar el mockup elimina *este* caso, pero no la clase: `react@18.3.1` sigue en el store por
`web`/`landing`/`design-system`, y cualquier paquete futuro publicado sin `dependencies` vuelve
a caer al mismo hoist dir. La guardia hace la resolución **determinista** en vez de depender de
la lotería de pnpm — que es justamente lo que hace que el mismo lockfile produzca un APK
distinto en la máquina de EAS.

En `resolver.resolveRequest`, forzar que `react`, `react-dom`, `react-native`, `expo`,
`expo-font`, `expo-asset`, `expo-constants` y `expo-modules-core` resuelvan siempre desde
`apps/mobile/node_modules`, sea cual sea el módulo que los pide.

**Encadenar el `resolveRequest` que ya existe** (lo instala `getSentryExpoConfig`, ver el
comentario de `metro.config.js`), nunca pisarlo: si se pisa, se pierde el Debug ID y los source
maps de Sentry dejan de matchear el bundle.

### 3. Canario en CI

Hoy CI **nunca ejecuta Metro**: `@quivo/mobile` define `"build": "tsc --noEmit"` y
`"test": "vitest run --passWithNoTests"`. Por eso el rediseño se mergeó con la app rota y CI
quedó verde un día entero.

- `scripts/assert-bundle-singletons.mjs` (~30 líneas): lee `sources` del `.hbc.map`, extrae la
  clave `node_modules/.pnpm/<clave>/` y falla si aparece más de una versión de los ocho
  paquetes de arriba.
- Paso nuevo en `.github/workflows/ci.yml`:
  `pnpm --filter @quivo/mobile exec expo export --platform android --dump-sourcemap` seguido del
  script. Medido: ~1 min, sin emulador, determinista.
- Test barato adicional en `apps/mobile` (entra en el `pnpm test` existente, <1s): comparar
  `require.resolve('expo-font', { paths: [require.resolve('@expo-google-fonts/montserrat/package.json')] })`
  contra `require.resolve('expo-font')` desde `apps/mobile` y fallar si difieren.

### 4. Dos arreglos que bloquean el uso real

- **`App.tsx:121-130`** — el splash tiene `await new Promise(r => setTimeout(r, 2000))` con el
  comentario "we just wait a minimum time for the animation to look nice". Dos segundos de
  espera artificial tapando la app en cada arranque, residuo del rediseño. Que el splash cierre
  cuando la restauración de sesión termina, no por temporizador.
- **`docs/runbooks/alta-de-conductor-android.md:48`** — describe un login de dos pantallas
  ("placa + PIN del vehículo, después CI + PIN del conductor") que dejó de existir con el PR
  #53. Quien dé de alta a un conductor real hoy sigue instrucciones falsas. Actualizar a un
  paso: placa + PIN del conductor.

## Fuera de alcance (dicho, no hecho)

- Assets de marca "QUIVO CONTROL" visibles en login, header y Ajustes — decisión del CTO.
- `logo-white.png` y `logo-wordmark-white.png` son byte a byte el mismo archivo (md5
  `434722a9...`). Duplicado, cosmético.
- Compra de la licencia Transistorsoft.
- Los 4 criterios GO/NO-GO del GPS en background siguen **sin medirse con la app propia**
  (`docs/spike-gps.md:88-101`): las trazas analizadas salieron de Geo Tracker. El APK va a
  abrir, pero la confiabilidad del tracking en una jornada de 8h no está probada.
- `expo-haptics` sin instalar (vibración del acuse).
- `.env.example` documenta `EXPO_PUBLIC_USE_MOCK_ROUTE`, que no tiene ningún consumidor.

## Verificación

1. `pnpm install` y confirmar que `node_modules/.pnpm/` ya no tiene `react-native@0.76.9`,
   `expo-font@...expo@52` ni `expo-modules-core@2.2.3`.
2. `expo export --platform android --dump-sourcemap` y correr el script del canario:
   **una sola clave por paquete**. Este es el criterio de aceptación duro del fix.
3. `pnpm typecheck`, `pnpm test`, `pnpm build` en la raíz.
4. `/code-review` antes del PR. No toca auth/RLS/secrets, así que no aplica `/security-review`.
5. PR, esperar CI, mergear, borrar rama, sincronizar `main`, actualizar `docs/handoff.md`.
6. `eas build --platform android --profile production --non-interactive` desde `apps/mobile`.
   Mismo keystore (`Build Credentials 9zSZpTExKl`) que los builds 7 y 8, así que se instala
   encima sin desinstalar — importante, porque desinstalar destruye recorridos sin sincronizar.
7. **El paso que realmente cierra esto:** instalar en el teléfono y confirmar que abre y llega
   a la pantalla de login. Hasta ahí, el fix está verificado en el bundle pero no en el
   dispositivo.
8. Con la app abierta, probar login end-to-end contra producción (placa + PIN del conductor).
   Nunca se probó auth en prod: el health check solo prueba conectividad a DB y Redis.
