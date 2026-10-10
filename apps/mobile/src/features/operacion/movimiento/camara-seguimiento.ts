/**
 * Spike `ubicación fluida` (S2): zoom de la cámara del motor Google nativo al SEGUIR al conductor.
 *
 * Leaflet (`route-map-html.ts`) sigue al conductor con `map.flyTo(latlng, 17, ...)` en cada fix y
 * en `recenter` (zoom 17 explícito, también el `setView(..., 17)` de respaldo). Tiles OSM de 256px
 * y Google Maps usan la misma escala de zoom web-mercator (a zoom N la tierra mide 256*2^N px de
 * "dp" lógicos), así que 17 es comparable casi 1:1. Sin esto, `animateCamera({center, heading})`
 * dejaba el zoom de `fitToCoordinates` de la ruta entera y la comparación de fluidez no era justa.
 *
 * Leaflet re-impone 17 en cada fix; acá NO: solo se fija al ENTRAR en seguimiento (`zoom` en la
 * primera cámara tras entrar), para no pisarle al usuario un pinch durante el seguimiento.
 */
export const ZOOM_SEGUIMIENTO = 17;

export interface CamaraSeguimiento {
  center: { latitude: number; longitude: number };
  heading?: number;
  zoom?: number;
}

export function construirCamaraSeguimiento(
  posicion: { lat: number; lng: number; rumbo: number | null },
  aplicarZoom: boolean,
): CamaraSeguimiento {
  return {
    center: { latitude: posicion.lat, longitude: posicion.lng },
    ...(posicion.rumbo !== null ? { heading: posicion.rumbo } : {}),
    ...(aplicarZoom ? { zoom: ZOOM_SEGUIMIENTO } : {}),
  };
}
