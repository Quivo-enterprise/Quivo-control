# Plan: APK demo de la app del chofer (todo mock, build local) + actualizar rama `mockup`

## Contexto
El guion V3 necesita tomas de la **app del conductor** en E05 (02:04–02:18), **E06 completa** (02:36–03:48) y E08 (05:24–06:23). El panel web ya está mockeado (iteración 3, `94900c5`). Ahora el CTO pide un **APK demo compilado en esta PC, sin EAS**, 100% mock, con estas funciones:
- 2 indicadores con foto y distancia: qué trufi va **adelante** y cuál viene **atrás**;
- perfil donde el chofer **sube su foto y su teléfono**;
- todo lo que pide el guion.

Decisiones del CTO:
- el chofer puede ser de **ambas líneas**: el login decide la placa, y con ella la línea;
- la verificación se hace con un **teléfono por USB**;
- se **mockea la tarjeta «Datos de hoy»** para el plano de «pocos megas».

Base: `~/Downloads/Quivo-control`, rama `mock/sandbox`, app en `apps/mobile`.

## Paso 0 — actualizar la rama `mockup` con la iteración 3 (pedido explícito; push autorizado)
- La `mockup` local está en `01dfad4` (fa9c3a2 más el revert de puertos de docker-compose). `94900c5` no toca docker-compose.
- `git checkout mockup && git cherry-pick 94900c5 && git checkout mock/sandbox`
- `git push git@github.com:Quivo-enterprise/Quivo-control.git mockup:refs/heads/mockup` (fast-forward), y después `git ls-remote` para verificar.
- El repo público `quivo-control-mockup` no se toca: el pedido fue solo la rama.

## Lo que hay hoy en `apps/mobile` (ya explorado)
- **Stack:** Expo 54, RN 0.81.5, react-navigation native-stack (`src/app/operation-navigator.tsx`: Map/Perfil/Ajustes), react-query y vitest (39 tests).
- **Mapa:** WebView con Leaflet inline (`src/features/operacion/route-map-html.ts`, `route-map-view.tsx`, `route-map-protocol.ts`). Mensajes `position`, `tracking`, `proximoPuntoControl`, etc. No existe un mensaje para marcadores arbitrarios. Una data URI en base64 funciona offline.
- **GPS Transistorsoft:** `GpsProvider` monta `useGpsOperativo`, que llama al SDK apenas monta (`use-gps-operativo.ts:703-800`). `index.js` registra el headless task. La licencia está ligada a `com.quivotech.conductor.app`.
- **Seams para el mock:**
  - `useAuthMovil` (etapas `restaurando|vehiculo|asignacion|operacion`), con `App.tsx:118-153` ramificando por etapa;
  - `usePaqueteDia` (`PaqueteDia`: `packages/shared/src/sync/paquete-dia.ts`, ruta en GeoJSON `[lon,lat]`);
  - `useGpsOperativo`, con el shape de retorno en `use-gps-operativo.ts:1514-1535`;
  - `usePerfilQuery` (`ContextoOperativoMovil`: `packages/shared/src/auth/mobile.ts:103-147`).
- **Lo que existe:** perfil sin foto ni teléfono (el avatar es un `View` en `perfil-screen.tsx:66`, igual en la tarjeta de identidad en `operation-screen.tsx:647`); observación con texto libre (`operation-screen.tsx:520-599`); iniciar/finalizar; puntos de control con toast.
- **Lo que falta:** adelante/atrás, cola/orden de salida, reportes tipificados, cambio de conductor en demo, banner sin conexión (el producto lo sacó a propósito, pero el guion lo pide).
- **Datos del web, portables (TS puro):**
  - `apps/web/src/lib/mock-flota/{datos,geometria,tipos}.ts`: `TRUFIS_MOCK` (8 unidades, 5 Z12 y 3 L120) y `LINEAS_MOCK` (polilínea, paradas, puntos de control);
  - fotos en `apps/web/public/mock/trufis/*.jpg`.

## Mapa guion → función en el APK demo
| Toma | Qué se ve en el teléfono | Implementación |
|---|---|---|
| E05 02:04 / E06 02:36 | Abre la app, con el logo | Splash real. Si no hay sesión, login |
| E06 02:45 | Hoja de ruta digital, recorrido, orden de salida | Pantalla nueva **Hoja de ruta**: turno (horario, salida programada), recorrido (lista de paradas con los puntos de control marcados, mini mapa de la línea) y **orden de salida** (cola con foto, placa y hora; la unidad propia resaltada con «Sos el 3º · sale 07:24») |
| E06 02:56 | Activar la jornada con un toque | Botón existente **Iniciar recorrido**, con GPS simulado |
| E06 03:04 | Registro automático | El trufi propio avanza por la polilínea. El toast de punto de control existente se dispara al pasar por cada uno |
| E06 03:16 | Vehículos adelante/detrás | **2 indicadores** (arriba, bajo la tarjeta de identidad): foto redonda con el borde del color de la línea, placa y «Adelante · a 850 m / ~3 min», «Atrás · a 1,2 km». Distancia **a lo largo de la ruta**. Además, en el mapa, los marcadores con foto de los otros trufis de la línea |
| E06 03:25 / E08 05:42–06:01 | Sin conexión, guarda y sincroniza | Panel demo: **Perder señal** muestra el banner «Sin conexión · guardando recorrido (N puntos)», con el contador subiendo y el recorrido que sigue. **Recuperar señal** muestra «Sincronizando N puntos…» (~3 s) y después «Sincronizado» |
| E06 03:36 | Reportar un vehículo fuera de orden | El modal de observación pasa a ser **Reportar**: chips de tipo (Vehículo fuera de orden · Pinchazo · Control policial · Bloqueo de vía · Falla mecánica · Incidente con pasajero · Otro). Fuera de orden elige la placa de una lista con fotos. Nota opcional. Enviar muestra «Enviado al delegado», o «Se enviará al recuperar señal» si no hay señal |
| E06 03:42 | Cambio de conductor en el mismo vehículo | Login con **placa + PIN** contra cuentas mock: cada placa jugable tiene 2 conductores, uno por PIN. Perfil → Cerrar sesión → otro PIN, y cambian nombre y foto. Placas jugables: una Z12 (3ª de 5) y una L120 (2ª de 3). Los PIN se imprimen en el guion de tomas |
| E08 05:24 | Solo celular + app | La app misma, sin nada extra |
| E08 05:34 | Pocos megas | Tarjeta **«Datos de hoy: 2,4 MB»** en Perfil o Ajustes, con un valor mock que crece despacio con el recorrido. Decisión del CTO: es una cifra mock y se rotula en edición |
| Pedido CTO | Perfil con foto y teléfono | Perfil: tocar el avatar abre una hoja de acciones con **Tomar foto / Elegir de galería** (`expo-image-picker`, recorte 1:1, calidad 0.5, base64). Campo **Teléfono** (+591, 8 dígitos) con Guardar. Todo se persiste en AsyncStorage **por conductor**. La foto aparece también en la tarjeta de identidad de la pantalla de operación |

**Panel demo oculto** (el equivalente a la tecla `S` del web): se abre con una pulsación larga de 1,5 s sobre el FAB de centrar mapa. Tiene:
- Perder / Recuperar señal;
- Velocidad ×1/×4;
- Saltar al próximo punto de control;
- Trufi adelante se acerca, para ver cómo baja la distancia;
- Reiniciar demo.

En la toma no se ve nada del panel.

## Arquitectura (todo detrás de `EXPO_PUBLIC_MOCK_DEMO=true`; sin el flag, la app real no cambia)
- **`app.config.ts`:** con `APP_VARIANT=demo`, el package pasa a `com.quivotech.conductor.demo` y el nombre visible queda «QUIVO Control». Así **convive** con la app real instalada y no borra el outbox pendiente del piloto. Sentry queda sin DSN.
- **`index.js`:** con el flag, no registra el headless task de Transistorsoft.
- **`src/demo/`** (nuevo):
  - `datos/`: port de `TRUFIS_MOCK`, `LINEAS_MOCK` y `geometria` del web (copia, sin importar desde `apps/web`), más `fotos.generated.ts` con miniaturas de 96 px en base64, generado con un script a partir de los jpg del web usando ImageMagick;
  - `cuentas.ts`: placas jugables y PIN;
  - `motor.ts`: **reducer puro con reloj inyectado**, que lleva el avance (0..1) de las 8 unidades por su línea, la velocidad, el estado de señal y el buffer, y la cola de salida. Tiene los selectores `adelanteAtras(trufiId)` (distancia sobre la ruta en metros y ETA), `colaDe(linea)` y `posicion(trufiId)`. Tests con vitest;
  - `demo-provider.tsx`: contexto con tick de 1 s y las acciones;
  - hooks mock con **el mismo shape** que los reales: `useAuthMovilDemo`, `usePaqueteDiaDemo` (un `PaqueteDia` construido desde `LINEAS_MOCK`, convirtiendo a `[lon,lat]`), `useGpsOperativoDemo` (retorno idéntico al de `use-gps-operativo.ts:1514-1535`, **sin importar el SDK**, con detección de puntos de control por radio) y `usePerfilDemo`.
- **Swap en un solo lugar:** `App.tsx`, `operation-navigator.tsx` y `gps-provider.tsx` eligen entre el hook real y el demo según el flag. Hoy `GpsProvider` monta el SDK apenas se renderiza, así que hay que cortar antes de que eso pase.
- **Mapa:** un mensaje nuevo, `otros-vehiculos` (`{id, lat, lng, fotoDataUri, color}`), en `route-map-protocol.ts` y `route-map-html.ts`, con un `Map<id, L.Marker>` que sigue el patrón de `position`.
- **UI:** seguir `shared/theme/quivo-theme.ts` (Montserrat/Oxanium, `BlurView`), los componentes de `shared/components/` y `resolverMarcaLinea` (`packages/shared/src/entities/linea.ts:179`). Los subagentes cargan `impeccable` antes de la UI (regla 7, feature puntual: un solo camino).

## Ejecución (el chairman orquesta; el código lo escribe Sonnet)
1. Paso 0 (push de `mockup`). Guardar el plan en `docs/plan-apk-demo-conductor.md` y agregar el puntero en el handoff.
2. **A (Sonnet):** `src/demo/` (datos, fotos generadas, cuentas, motor con tests, provider, hooks mock), la variante en `app.config.ts`, el gating de `index.js` y los swaps en `App.tsx`, el navigator y el provider. También agrega `expo-image-picker` (`pnpm --filter @quivo/mobile exec expo install expo-image-picker`), porque necesita red.
3. **Después de A, en paralelo y con archivos separados:**
   - **B (Sonnet):** `operation-screen.tsx`: indicadores adelante/atrás, foto en la tarjeta de identidad, banner de señal, modal Reportar tipificado, panel demo oculto y botón **Hoja de ruta**; además el mensaje `otros-vehiculos` en el mapa.
   - **C (Sonnet):** pantalla nueva Hoja de ruta (y su ruta en el navigator), perfil con foto y teléfono, tarjeta «Datos de hoy», login demo (reusa `VehicleLoginScreen` con la API mock).
4. Revisión: `/code-review` más `impeccable audit` (subagente). Las correcciones van a un Sonnet nuevo.
5. **Build local (chairman):**
   ```
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=$HOME/Android/Sdk
   cd apps/mobile
   APP_VARIANT=demo EXPO_PUBLIC_MOCK_DEMO=true pnpm exec expo prebuild -p android --clean
   cd android && APP_VARIANT=demo EXPO_PUBLIC_MOCK_DEMO=true ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
   ```
   - El release se firma con `debug.keystore`, que alcanza para instalar por sideload.
   - Se compila solo `arm64-v8a` porque la RAM está justa (~2 GB libres).
   - Las variables `EXPO_PUBLIC_*` tienen que estar también en el paso de gradle, porque el bundle JS se arma ahí.
   - El resultado se copia a `~/Downloads/quivo-conductor-demo.apk`.
   - `android/` está en gitignore; `--clean` lo regenera.
6. **Verificación en el teléfono por USB:** `adb install -r`, más el MCP `mobile`, recorriendo cada fila de la tabla y dejando capturas en `docs/tomas-app/`.
7. Actualizar `docs/guion-grabacion-mock.md` con la sección de la app: placas, PIN, cómo abrir el panel demo, tomas E05/E06/E08. Actualizar el handoff y hacer commit en `mock/sandbox`, sin atribución de IA.

## Trampas y decisiones
- **Transistorsoft:** en el modo demo no se importa ni se llama el SDK en runtime (el módulo nativo sigue linkeado). Si el release sin licencia para `.demo` tira un toast o un error al arrancar, se verifica en el teléfono.
- **El panel web y el APK son dos simulaciones independientes** (no hay backend). Si se filman en el mismo plano, las posiciones no van a coincidir. Hay que grabarlos por separado.
- El producto real sacó a propósito los badges de red (`docs/estados-red-vs-captura.md`); el banner de señal existe **solo con el flag demo**.
- «Datos de hoy» y todas las cifras son mock, y edición las rotula como «Demostración».
- La foto de `z12-1` es CC BY 2.0 y lleva crédito si aparece.
- El build con prebuild `--clean` no toca la app de `~/Documents/Quivo-App` (es otra carpeta).

## Verificación
- `pnpm --filter @quivo/mobile typecheck`, `test` (los 39 existentes más los nuevos del motor) y `lint`, sin warnings nuevos.
- Sin el flag, el bundle no incluye `src/demo`, o no cambia ningún comportamiento; se revisa el diff de los swaps.
- `assembleRelease` termina con exit 0, y `aapt dump badging` muestra el package `com.quivotech.conductor.demo`.
- En el teléfono:
  - login con PIN A y PIN B en la misma placa (cambia el conductor);
  - las dos líneas;
  - Hoja de ruta;
  - Iniciar, con el trufi que se mueve y los toasts de punto de control;
  - los indicadores adelante/atrás, con la distancia que cambia, y los marcadores con foto en el mapa;
  - Perder señal por 15 s, con el contador subiendo, y después Recuperar, con la sincronización;
  - Reportar fuera de orden;
  - foto de perfil desde la cámara y la galería, más el teléfono persistido tras matar la app;
  - «Datos de hoy»;
  - Reiniciar demo.
