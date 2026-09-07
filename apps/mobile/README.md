# @quivo/mobile

Aplicación Android del conductor con identidad visual QUIVO. El acceso operativo valida
primero el vehículo (placa + PIN) y después al chofer (documento + PIN). Una asignación
vigente carga vehículo, sindicato, línea, ruta y turno antes de habilitar el recorrido GPS.

Los tokens se guardan con `expo-secure-store`; SQLite se usa únicamente para el outbox de
eventos. Al reiniciar el proceso se restaura el contexto local y se reconcilia con la API.

## Desarrollo completo

Desde la raíz:

```bash
pnpm dev
```

El lanzador aplica migraciones y seed, detecta la IP LAN y abre backend, web y Metro en tres
terminales independientes. Expo recibe `EXPO_PUBLIC_API_URL=http://<ip-lan>:3001`. El móvil
físico debe compartir la red con la PC; para elegir otra interfaz:

```bash
QUIVO_HOST_IP=192.168.x.x pnpm dev
```

Si se inicia sólo Expo, copiar `.env.example` a `.env` y reemplazar la IP de ejemplo.

## Cliente Android obligatorio

El GPS, SecureStore y SQLite son módulos nativos: **Expo Go no sirve para esta app**. La
primera vez, o después de cambiar una dependencia/plugin nativo, ejecutar con Android
conectado por ADB:

```bash
pnpm --filter @quivo/mobile android
```

Esto compila e instala `com.quivotech.conductor`. Si Expo muestra “No development build is
installed”, falta precisamente ese paso. Las siguientes ejecuciones usan `pnpm dev` y se
abre la aplicación instalada **QUIVO Conductor**.

## Acceso demo local

Después de ejecutar el seed:

| Entidad  | Identificador | PIN por defecto |
| -------- | ------------- | --------------- |
| Vehículo | `1001ABC`     | `246810`        |
| Chofer   | `1000101 LP`  | `135790`        |

Son valores exclusivamente locales y se pueden reemplazar mediante
`MOBILE_SEED_VEHICLE_PIN` y `MOBILE_SEED_DRIVER_PIN`. No reutilizarlos en ambientes
compartidos o productivos.

El seed deja para el día actual una asignación móvil publicada de turno `tarde` (demo de
las 15:00), con la ruta `Línea 120 · ida` y cuatro paradas/puntos de control entre Plaza
Colón y La Cancha, Cochabamba. Después del login, la ruta se descarga como paquete del día
antes de habilitar el botón **Iniciar recorrido**.

## Verificación

```bash
pnpm --filter @quivo/mobile typecheck
pnpm --filter @quivo/mobile lint
pnpm --filter @quivo/mobile test
```

`build` ejecuta TypeScript; el APK nativo se genera con `expo run:android`/Gradle. La
compilación de producto aún requiere configurar la licencia Transistorsoft indicada en
`docs/spike-gps.md`.

**Mapa (QUI-243):** la pantalla de recorrido usa Leaflet + tiles de OpenStreetMap dentro de
un `WebView` (`react-native-webview`) — sin API key, 100% open source (mismo motor que
`RouteMap` del design system web, QUI-229). Se probó primero `react-native-maps`, pero en
Android solo soporta Google Maps y exige una API key real de Google Maps Platform; se
descartó para no depender de esa credencial (confirmado con un crash real en un Moto E13 sin
key configurada). Leaflet se carga desde CDN (`unpkg.com`) — sin red, el mapa no renderiza,
pero el resto de la pantalla (inicio/fin de recorrido, sync, observaciones) sigue
funcionando (`MapErrorBoundary` aísla cualquier falla del mapa del resto de la UI).
