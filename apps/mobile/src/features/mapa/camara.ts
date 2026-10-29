import type { LatLng } from 'react-native-maps';
import type { OrientacionCamara } from './modo-camara';

/**
 * Cámara del mapa Google nativo (`react-native-maps`) en modo navegación y al encuadrar la
 * ruta. Funciones puras, sin React ni el SDK. El modelo completo (modos, bloqueo cuadro a
 * cuadro) está en el docblock de `route-map.tsx`; los modos en `modo-camara.ts`.
 *
 * Google Maps y los tiles OSM de 256px usan la misma escala web-mercator, así que los zooms
 * son los mismos que tenía el mapa Leaflet anterior.
 */

/** Zoom al centrar en el vehículo sin geometría de ruta (norte arriba, pitch 0). */
export const ZOOM_SEGUIMIENTO = 17;

/** Inclinación de la cámara de navegación (vista 3D hacia adelante). */
export const PITCH_NAVEGACION = 55;

/** Zoom de la cámara de navegación a baja velocidad / sin velocidad conocida: se manda en CADA
 * cámara (cualquier gesto sale de navegación, así que no hay pinch del usuario que respetar).
 * A mayor velocidad baja según `zoomPorVelocidad`. */
export const ZOOM_NAVEGACION = 19;

/** Puntos (km/h → zoom) de la curva de zoom automático; entre ellos interpola linealmente. */
const CURVA_ZOOM: ReadonlyArray<readonly [number, number]> = [
  [15, 19],
  [40, 18.5],
  [60, 18],
  [90, 17],
];

/** Zoom objetivo de la navegación según la velocidad (km/h): ≤15 → 19, 40 → 18.5, 60 → 18,
 * ≥90 → 17, lineal entre medio. Velocidad desconocida (`null`, no finita o negativa) → 19. */
export function zoomPorVelocidad(kmh: number | null): number {
  if (kmh === null || !Number.isFinite(kmh) || kmh < 0) return ZOOM_NAVEGACION;
  const primero = CURVA_ZOOM[0]!;
  const ultimo = CURVA_ZOOM[CURVA_ZOOM.length - 1]!;
  if (kmh <= primero[0]) return primero[1];
  if (kmh >= ultimo[0]) return ultimo[1];
  for (let i = 1; i < CURVA_ZOOM.length; i += 1) {
    const [v1, z1] = CURVA_ZOOM[i]!;
    if (kmh <= v1) {
      const [v0, z0] = CURVA_ZOOM[i - 1]!;
      return z0 + ((z1 - z0) * (kmh - v0)) / (v1 - v0);
    }
  }
  return ultimo[1];
}

/** Constante de tiempo (ms) del suavizado del zoom: ~65% del camino al objetivo en este tiempo
 * (a ~30 Hz equivale a un alpha de ~0.05 por frame). */
export const TAU_ZOOM_MS = 650;

/** Un paso de suavizado exponencial del zoom hacia `objetivo`, dependiente del tiempo `dtMs`
 * transcurrido (no del número de frames): nunca salta ni sobrepasa el objetivo. */
export function suavizarZoom(actual: number, objetivo: number, dtMs: number): number {
  if (!(dtMs > 0)) return actual;
  const alpha = 1 - Math.exp(-dtMs / TAU_ZOOM_MS);
  return actual + (objetivo - actual) * alpha;
}

/** Márgenes (dp) del encuadre de la ruta: dejan libre la tarjeta superior y el sheet inferior.
 * Mismos valores que el `fitBounds` de Leaflet (`paddingTopLeft [20, 80]`,
 * `paddingBottomRight [20, 180]`). */
export const PADDING_ENCUADRE_RUTA = { top: 80, right: 20, bottom: 180, left: 20 } as const;

export interface CamaraNavegacion {
  center: { latitude: number; longitude: number };
  heading?: number;
  pitch: number;
  zoom: number;
}

/** Cámara de navegación sobre `posicion`. Siempre manda pitch y `zoom` (por defecto
 * `ZOOM_NAVEGACION`; el mapa pasa el zoom ya suavizado por velocidad). Con orientación `rumbo`
 * (heading-up) manda `heading` solo con rumbo conocido (sin él se conserva el actual en vez de
 * snapear al norte); con `norte` fija heading 0 y sigue al vehículo igual. */
export function construirCamaraNavegacion(
  posicion: {
    lat: number;
    lng: number;
    rumbo: number | null;
  },
  orientacion: OrientacionCamara = 'rumbo',
  zoom: number = ZOOM_NAVEGACION,
): CamaraNavegacion {
  const heading = orientacion === 'norte' ? 0 : posicion.rumbo;
  return {
    center: { latitude: posicion.lat, longitude: posicion.lng },
    ...(heading !== null ? { heading } : {}),
    pitch: PITCH_NAVEGACION,
    zoom,
  };
}

/**
 * `mapPadding` de la navegación: Google dibuja el objetivo de cámara en el centro del área con
 * padding, `(top + alto - bottom) / 2`. Se fija `bottom = insetInferior` (el sheet colapsado) y
 * se despeja `top` para que el vehículo caiga a 2/3 de la banda visible entre la tarjeta
 * superior (`insetSuperior`) y el sheet, medido desde arriba — el tercio inferior. Sin medidas
 * válidas (alto 0 o banda degenerada) devuelve ceros, para no romper el mapa antes del layout.
 */
export function paddingNavegacion({
  alto,
  insetSuperior,
  insetInferior,
}: {
  alto: number;
  insetSuperior: number;
  insetInferior: number;
}): { top: number; right: number; bottom: number; left: number } {
  const banda = alto - insetInferior - insetSuperior;
  if (alto <= 0 || banda <= 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  const objetivoY = insetSuperior + (2 / 3) * banda;
  const top = Math.max(0, Math.round(2 * objetivoY - alto + insetInferior));
  return { top, right: 0, bottom: Math.max(0, Math.round(insetInferior)), left: 0 };
}

/** Coordenadas del encuadre general: la ruta más el vehículo si se lo conoce (antes podía
 * quedar fuera del encuadre al estar lejos del inicio). */
export function coordenadasEncuadre(
  ruta: LatLng[],
  posicion: { lat: number; lng: number } | null,
): LatLng[] {
  return posicion ? [...ruta, { latitude: posicion.lat, longitude: posicion.lng }] : ruta;
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

/** Cuánto (px) puede moverse un dedo antes de contar como gesto y no como toque. */
export const UMBRAL_GESTO_PX = 8;

/**
 * ¿El toque en curso es un gesto del conductor sobre el mapa? Sí si hay dos o más dedos (pinch /
 * rotación) o si el dedo se alejó más de `UMBRAL_GESTO_PX` de donde empezó. Un toque simple (p. ej.
 * sobre un marcador) no lo es. Pura: la usa `route-map.tsx` desde `onTouchMove`.
 */
export function esGestoSobreMapa(
  inicio: { x: number; y: number } | null,
  actual: { x: number; y: number },
  cantidadToques: number,
): boolean {
  if (cantidadToques >= 2) return true;
  if (!inicio) return false;
  return Math.hypot(actual.x - inicio.x, actual.y - inicio.y) > UMBRAL_GESTO_PX;
}
