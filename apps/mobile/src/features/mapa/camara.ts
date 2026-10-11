/**
 * Cámara del mapa Google nativo (`react-native-maps`) al SEGUIR al conductor y al encuadrar la
 * ruta. Funciones puras, sin React ni el SDK.
 *
 * El seguimiento sigue al conductor con zoom 17, el mismo que usaba el mapa Leaflet anterior
 * (tiles OSM de 256px y Google Maps usan la misma escala web-mercator). A diferencia de Leaflet,
 * que re-impone el zoom en cada fix, acá solo se fija al ENTRAR en seguimiento (`zoom` en la
 * primera cámara tras entrar), para no pisarle al usuario un pinch durante el seguimiento.
 */
export const ZOOM_SEGUIMIENTO = 17;

/** Márgenes (dp) del encuadre de la ruta: dejan libre la tarjeta superior y el sheet inferior.
 * Mismos valores que el `fitBounds` de Leaflet (`paddingTopLeft [20, 80]`,
 * `paddingBottomRight [20, 180]`). */
export const PADDING_ENCUADRE_RUTA = { top: 80, right: 20, bottom: 180, left: 20 } as const;

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

export type AccionEncuadre = 'ajustar-ruta' | 'centrar-posicion' | 'nada';

/**
 * Qué hacer para "ver la ruta" (encuadre inicial, recentrar sin posición conocida, fin del
 * seguimiento): con geometría se ajusta a la ruta entera; un paquete sin geometría (dato
 * incompleto del backend) no tiene bounds válidos, así que se centra en el vehículo si se lo
 * conoce, y si no se deja la vista como está — nunca debe tirar ni congelar el mapa.
 */
export function decidirEncuadre(cantidadCoordenadasRuta: number, hayPosicion: boolean): AccionEncuadre {
  if (cantidadCoordenadasRuta > 0) return 'ajustar-ruta';
  return hayPosicion ? 'centrar-posicion' : 'nada';
}
