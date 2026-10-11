# Paridad del mapa: Leaflet (WebView) vs Google nativo

Matriz de comportamientos del mapa anterior (`route-map-html.ts` en `main`, Leaflet + WebView)
frente al motor actual (`apps/mobile/src/features/mapa/`, `react-native-maps` + `PROVIDER_GOOGLE`,
ADR 0004). Estados: **portado** (reimplementado en el código nuevo), **cubierto por SDK** (lo
hace Google Maps sin código propio), **descartado** (no se porta; con motivo).

| Comportamiento (Leaflet) | Equivalente Google | Estado |
|---|---|---|
| Color de ruta en espera (oscuro `#1E1B4B`) y en seguimiento (naranja `#FE9B0B`) | `RutaPolylines` con `estiloRuta(tracking)` (`estilo-ruta.ts`) | portado |
| Puntos de control numerados (círculo azul con número blanco) | `MarcadorPuntoControlItem` (`Marker` con vista custom) | portado |
| Estado "pasado" del punto de control (verde, solo con `tracking`) | `esPuntoControlPasado` + `colorPuntoControl` (`estado-punto-control.ts`) | portado |
| Resaltado del próximo punto de control | `indiceProximoPuntoControl` determina el límite pasado/pendiente; el resaltado se expresa con el cambio de color del punto, igual que antes | portado |
| Tramo OSRM (`rutaCalculada`) en naranja, solo con `tracking` | `Polyline` adicional con `debeResaltarRutaCalculada` | portado |
| Encuadre inicial de la ruta (`fitBounds`, márgenes 20/80/20/180) | `fitToCoordinates` con `PADDING_ENCUADRE_RUTA`, solo cuando mapa listo y con layout (`onMapReady` + `onLayout`) | portado |
| Si ya hay seguimiento al montar | Cámara de seguimiento (zoom 17, heading-up) en vez de encuadrar la ruta | portado (nuevo en Google) |
| Recentrar (botón) | `recenterTick` -> `seguirVehiculo`; sin posición conocida vuelve a encuadrar la ruta | portado |
| Halo de precisión (`accuracy`) | `Circle` con radio = `accuracy` | portado |
| Atenuado cuando el fix es obsoleto | `opacity` 0.4 del `Marker`; solo re-estiliza, no reinicia la animación | portado |
| Flecha vs punto | Flecha rotada con `rotation` + `flat`; punto sin flecha hasta que hay un rumbo válido | portado (cambio deliberado, ver abajo) |
| Interpolación suave del marcador entre fixes | Mismo núcleo (`movimiento/geo.ts`), con commits de estado a ~30 Hz | portado |
| Zoom de seguimiento 17 | `ZOOM_SEGUIMIENTO` (17), fijado solo al entrar en seguimiento | portado |
| Un pan sale del seguimiento (`dragstart`) | `onPanDrag` baja `seguimientoActivoRef`; el botón Recentrar lo restaura | portado |
| Recarga de tiles y reintentos al volver la conectividad (2026-09-25) | El SDK de Google gestiona su caché y reintentos de tiles | cubierto por SDK |
| `errorTileUrl`, poda de tiles, controlador de tiles OSM, `construirUrlTileZoomExacto` | No hay capa de tiles propia | descartado (el SDK reemplaza toda la capa de tiles) |
| Protocolo `postMessage` RN <-> WebView, HTML inyectado | Props de React sobre componentes nativos | descartado (sin WebView) |
| `invalidateSize` / pantalla gris por error de script | `MapErrorBoundary` aísla fallas del mapa | cubierto por SDK / boundary existente |
| Gestos de zoom/arrastre | Gestos nativos de Google | cubierto por SDK |

## Cambios deliberados respecto a Leaflet

- **Punto hasta tener rumbo válido:** el marcador se dibuja como punto sin flecha mientras
  `EstadoRumbo.rumbo === null`; no se inventa un rumbo.
- **Cámara heading-up:** en seguimiento la cámara rota con el rumbo del vehículo (Leaflet
  mantenía el norte arriba). Tras un pan manual, la brújula (visible) devuelve el norte arriba.
- **Recentrar sin posición:** no vuela a ningún lado; encuadra la ruta y deja el zoom de
  seguimiento pendiente para el primer fix.
- **Pinch/rotate también salen del seguimiento:** `onPanDrag` los reporta como arrastre.
  Igual que Google Maps, cualquier gesto sale del seguimiento y aparece Recentrar.
- Sin posición (p. ej. fin del recorrido) el marcador desaparece y el siguiente fix real
  aparece directo, sin animar desde el punto final anterior.
- Sin API key en un build de EAS que no sea `development`, el build falla (`app.config.ts`);
  el SDK sin key cierra la app, no deja el mapa en blanco.

## No verificado en dispositivo

- Render con la API key real de Google Maps.
- Fluidez de la animación (marcador a ~30 Hz + cámara) en Android de gama baja.
- Si `fitToCoordinates` resetea heading/tilt de la cámara al terminar el seguimiento.
- Apariencia sin conexión (tiles no cacheados).
- Diferencia entre la cámara con easing y el marcador lineal (pendiente: modo navegación).
