# ADR 0004 — Motor de mapa móvil: Google (react-native-maps), Leaflet retirado

**Estado:** aceptado (decisión del CTO, 2026-10-10).
**Fecha:** 2026-10-10
**Cierra:** decisión S2 de [`docs/plan-ubicacion-fluida.md`](../plan-ubicacion-fluida.md) (Leaflet vs Google).
**Plan de ejecución:** [`docs/plan-release-13-features.md`](../plan-release-13-features.md), feature C.

> Numeración: se usa 0004 porque hay dos ADR `0002` y la renumeración (plan de saneamiento,
> Fase 1) reserva 0001–0003 para los existentes.

## Problema

El release 13 agrega un **modo navegación** al tocar COMENZAR RUTA: heading-up, inclinado,
siguiendo al vehículo y con zoom, estilo Google Maps.

El motor actual es Leaflet dentro de un WebView (`route-map-html.ts`, ~1000 líneas de HTML/JS
inline más un protocolo `postMessage` con handshake), y ahí:
- **El mapa no rota.** Solo gira la flecha del vehículo con CSS.
- **No hay inclinación (pitch).**
- Rotar el contenedor con CSS 3D rompe los toques y los tiles.

El spike `spike/ubicacion-fluida` ya tiene un motor Google nativo (`route-map-native.tsx`, con
`react-native-maps` y `PROVIDER_GOOGLE`), con la misma interfaz de props, cámara heading-up vía
`animateCamera` y marcador interpolado. Se probó en calle con el APK `beba67fa`, y la navegación
anduvo bien.

## Decisión

1. **Google (react-native-maps 1.20.1, `PROVIDER_GOOGLE`) es el único motor de mapa móvil.**
2. **Leaflet se borra por completo del móvil**, con todo lo que existía solo por el WebView:
   - el HTML inline (`route-map-html.ts`) y su test;
   - el bundle Leaflet generado y su script generador;
   - el protocolo `postMessage` (`route-map-protocol.ts`);
   - el detector de reconexión, si solo servía para recargar los tiles;
   - las dependencias `leaflet` y `react-native-webview`.

   Antes de borrar, una matriz de paridad.
3. **Sin toggle de motor.** El código del spike que solo sirve para comparar no pasa a
   producción: `spike-motor-mapa.ts`, el FAB de cambio de motor y `SpikeMetricsOverlay`.
4. El panel web no cambia: ya usa MapLibre (`packages/design-system`).

## Consecuencias

**A favor**
- La cámara nativa tiene `heading`, `pitch` y `zoom` animables.
- Se elimina el puente WebView↔RN y su clase de bugs (mensajes perdidos antes del handshake,
  recarga de tiles al reconectar).
- Se borran unas 2.5k líneas de HTML/JS y tests acoplados al DOM.

**En contra / riesgos**
- **Requiere Google Play Services.** En teléfonos sin GMS (Huawei y otros) el mapa queda en
  blanco y **no hay respaldo**, porque Leaflet se retira. Antes del release hay que verificar que
  todos los teléfonos del piloto tengan GMS.
- **API key `GOOGLE_MAPS_ANDROID_API_KEY`:**
  - Hoy solo está en el entorno EAS `preview` y hay que crearla en `production`.
  - Tiene que estar restringida al paquete y al SHA-1 del keystore de producción.
  - Si el SHA-1 no coincide, el mapa sale en blanco y sin error visible. Se verifica en el
    primer APK.
- **Costo:** la carga de mapas dinámicos del SDK nativo de Android figura como $0, pero
  **no se verificó en la consola de facturación**.
- **Dependencia de un proveedor más** (Google Maps Platform) para el núcleo de la operación.

## Alternativas descartadas

- **Leaflet en modo degradado** (seguimiento con zoom alto y flecha girando, sin rotar ni
  inclinar el mapa): no cumple "estilo Google Maps".
- **MapLibre nativo** (`@maplibre/maplibre-react-native`): soporta pitch y bearing, pero exige
  un proveedor de tiles vectoriales propio. Además, el motor Google ya estaba probado en calle.
- **Esperar al resultado formal de S2:** la prueba de calle con `beba67fa` ya validó la
  navegación con Google, y el CTO decidió no esperar.
