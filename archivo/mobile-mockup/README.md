# QUIVO Mockup

Copia autónoma de la app móvil para validar pantallas y flujos rápidamente.

## Por qué está fuera del workspace

Este paquete es el mockup de referencia del rediseño del PR #51 (dirección visual del panel
móvil). Vivió en `apps/mobile-mockup` hasta que se detectó que su Expo ~52.0.11 / React 18.3.1
/ React Native 0.76.9 contaminaba el bundle de producción de `apps/mobile` (Expo 54 / React
19.1.0 / RN 0.81.5): ambos paquetes traen `@expo-google-fonts/{montserrat,oxanium}@0.4.2`, que
no declaran `dependencies` ni `peerDependencies`, así que pnpm resuelve sus imports de `react`
y `expo-font` por walk-up al hoist dir compartido del store — y ahí terminaba ganando la copia
de SDK 52. El resultado era un APK que se instalaba pero crasheaba al abrir
(`TypeError: Cannot read property 'useState' of null` en `useFonts`), porque el bundle
exportado llevaba dos copias de React y de React Native. Por eso se movió a `archivo/` — fuera
del glob `apps/*` de `pnpm-workspace.yaml`, para que no vuelva a hoistearse junto a
`apps/mobile`.

Si alguien lo necesita correr de nuevo, instalarlo aparte, fuera del workspace (por ejemplo
copiando esta carpeta a otro directorio y corriendo `pnpm install` ahí), nunca reincorporarlo a
`apps/`.

- No usa backend, API, GPS ni almacenamiento de sesión.
- El acceso usa únicamente celular del chofer y placa del vehículo.
- Los datos de la jornada y los puntos de control son estáticos.
- Los puntos inicial y final tienen una lista de salida simulada con posición, placas y hora estimada.
- La llegada a un control y el turno de salida usan alertas sonoras diferentes.

## Ejecutar

Desde la raíz del monorepo:

```bash
pnpm --filter @quivo/mobile-mockup start
```

También se puede abrir en Android o iOS con los scripts del paquete. No es necesario iniciar Docker ni `apps/api`.

## Datos precargados

- Celular: `700 12345`
- Placa: `1234 ABC`

El botón de acceso acepta cualquier celular con al menos siete dígitos y cualquier placa con cuatro caracteres o más, porque el flujo es únicamente de demostración.
