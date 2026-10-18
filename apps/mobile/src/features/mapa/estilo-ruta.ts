/**
 * Estilo de la ruta en el mapa según el estado del recorrido — funciones puras.
 */

import { quivoColors } from '../../shared/theme/quivo-theme';

/** Ruta en espera (recorrido sin iniciar). */
export const COLOR_ESPERA = '#1E1B4B';
/** Ruta en seguimiento: azul Quivo Control (token `primary`). */
export const COLOR_LINEA = quivoColors.primary;
/** Borde (casing) de la ruta en seguimiento: `primary` oscurecido ~40 %. */
export const COLOR_CASING_LINEA = quivoColors.primaryDark;
/** Tramo de la designación a Molinos: acento de marca (distinguible del azul base). */
export const COLOR_DESIGNACION = quivoColors.accent;
/** Borde del tramo de designación (`warningStrong`, naranja oscuro del tema). */
export const COLOR_CASING_DESIGNACION = quivoColors.warningStrong;
/** Trazo discontinuo del tramo OSRM: `primaryDark`, legible sobre el mapa claro y sobre la base azul. */
export const COLOR_TRAMO_CALCULADO = quivoColors.primaryDark;
/** Banda blanca bajo el trazo del tramo OSRM: lo despega del mapa y de la base azul. */
export const COLOR_CASING_TRAMO_CALCULADO = quivoColors.white;
/** Patrón (dp: trazo, hueco) del tramo OSRM; se dibuja con `lineCap="butt"` para que se note. */
export const PATRON_TRAMO_CALCULADO: readonly number[] = [14, 8];
/** Fracción del ancho de la base que ocupa el tramo OSRM. */
export const FRACCION_TRAMO_CALCULADO = 0.7;

/** Ancho real de una calzada de un sentido (m) que representa la polilínea. */
export const METROS_CALZADA = 7;
/** Límites del ancho (dp): visible a zoom bajo, sin engordar de más al acercar. */
export const ANCHO_MIN_DP = 8;
export const ANCHO_MAX_DP = 24;
/** Borde visible por lado (dp). */
export const BORDE_CASING_DP = 1.75;
/** Paso de cuantización del zoom: el estado solo cambia al cruzar un paso. */
export const PASO_ZOOM = 0.25;

const METROS_POR_DP_ZOOM_0 = 156543.03;

/** Cuantiza el zoom a pasos de `PASO_ZOOM` para no re-renderizar en cada frame de cámara. */
export function cuantizarZoom(zoom: number): number {
  return Math.round(zoom / PASO_ZOOM) * PASO_ZOOM;
}

/**
 * Ancho en dp que ocupan `METROS_CALZADA` metros reales a ese zoom y latitud. El SDK de Google
 * Maps (Android) define el zoom sobre un mundo de 256 dp (no px), por lo que
 * `metros/dp = 156543.03 · cos(lat) / 2^zoom`. `react-native-maps` convierte `strokeWidth` de dp a
 * px con `metrics.density` (`MapPolylineManager.java`), así que el valor es dp directo.
 */
export function anchoLineaDp(zoom: number, latitud: number): number {
  const metrosPorDp = (METROS_POR_DP_ZOOM_0 * Math.cos((latitud * Math.PI) / 180)) / 2 ** zoom;
  const ancho = METROS_CALZADA / metrosPorDp;
  return Math.min(ANCHO_MAX_DP, Math.max(ANCHO_MIN_DP, ancho));
}

export interface EstiloRuta {
  color: string;
  grosor: number;
  /** Color del borde; `null` = sin borde (ruta en espera). */
  colorCasing: string | null;
  grosorCasing: number;
}

/** Grosor fijo (dp) de un tramo sin seguimiento. */
export const GROSOR_ESPERA_DP = 4.5;
/** Grosor (dp) del tramo de designación sin seguimiento: más ancho que la base (4.5) para destacar. */
export const GROSOR_DESIGNACION_ESPERA_DP = 7;

/**
 * Estilo de un tramo (base o designación) con el mismo criterio de ancho: en seguimiento, el ancho
 * de la calzada por zoom con borde `colorCasing`; sin seguimiento, fino (4.5 dp) y sin borde.
 */
export function estiloTramo(
  color: string,
  colorCasing: string,
  zoom: number,
  latitud: number,
  tracking: boolean,
): EstiloRuta {
  if (!tracking) return { color, grosor: GROSOR_ESPERA_DP, colorCasing: null, grosorCasing: 0 };
  const grosor = anchoLineaDp(zoom, latitud);
  return { color, grosor, colorCasing, grosorCasing: grosor + 2 * BORDE_CASING_DP };
}

/**
 * Tramo de la designación a Molinos. En seguimiento, igual que la base (ancho de calzada por zoom,
 * borde naranja oscuro). Sin seguimiento conserva su énfasis: más ancho que la base (7 dp vs 4.5) y
 * con borde.
 */
export function estiloDesignacion(zoom: number, latitud: number, tracking: boolean): EstiloRuta {
  if (tracking)
    return estiloTramo(COLOR_DESIGNACION, COLOR_CASING_DESIGNACION, zoom, latitud, true);
  return {
    color: COLOR_DESIGNACION,
    grosor: GROSOR_DESIGNACION_ESPERA_DP,
    colorCasing: COLOR_CASING_DESIGNACION,
    grosorCasing: GROSOR_DESIGNACION_ESPERA_DP + 2 * BORDE_CASING_DP,
  };
}

/**
 * Tramo OSRM (vehículo → próximo PC) sobre la base azul: trazo discontinuo `primaryDark` sobre una
 * banda blanca, al 70 % del ancho de la base (mínimo 5.6 dp: el piso de la base es 8).
 */
export function estiloTramoCalculado(zoom: number, latitud: number): EstiloRuta {
  const grosor = anchoLineaDp(zoom, latitud) * FRACCION_TRAMO_CALCULADO;
  return {
    color: COLOR_TRAMO_CALCULADO,
    grosor,
    colorCasing: COLOR_CASING_TRAMO_CALCULADO,
    grosorCasing: grosor + 2 * BORDE_CASING_DP,
  };
}

/** En espera: oscura y fina, sin borde. En seguimiento: azul del ancho de la calzada (por zoom)
 * con borde oscuro. */
export function estiloRuta(tracking: boolean, zoom: number, latitud: number): EstiloRuta {
  return estiloTramo(
    tracking ? COLOR_LINEA : COLOR_ESPERA,
    COLOR_CASING_LINEA,
    zoom,
    latitud,
    tracking,
  );
}

const ZOOM_MAX = 21;

const aFraccionMercatorY = (lat: number) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI);
};

/** Zoom aproximado de un `fitToCoordinates` (bounds en el área útil tras el padding). */
export function zoomParaEncuadre(
  coords: readonly { latitude: number; longitude: number }[],
  anchoDp: number,
  altoDp: number,
  padding: { top: number; right: number; bottom: number; left: number },
): number | null {
  if (coords.length === 0) return null;
  const utilW = anchoDp - padding.left - padding.right;
  const utilH = altoDp - padding.top - padding.bottom;
  if (!(utilW > 0) || !(utilH > 0)) return null;
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const c of coords) {
    minLng = Math.min(minLng, c.longitude);
    maxLng = Math.max(maxLng, c.longitude);
    minLat = Math.min(minLat, c.latitude);
    maxLat = Math.max(maxLat, c.latitude);
  }
  const fx = (maxLng - minLng) / 360;
  const fy = aFraccionMercatorY(minLat) - aFraccionMercatorY(maxLat);
  const zx = fx > 0 ? Math.log2(utilW / (256 * fx)) : ZOOM_MAX;
  const zy = fy > 0 ? Math.log2(utilH / (256 * fy)) : ZOOM_MAX;
  return Math.min(ZOOM_MAX, Math.max(0, Math.min(zx, zy)));
}

/**
 * El tramo OSRM (`rutaCalculada`, siguiendo calles) se resalta SOLO con el recorrido en
 * seguimiento y con al menos 2 puntos (una polyline necesita 2); en espera no se dibuja aunque
 * exista.
 */
export function debeResaltarRutaCalculada(
  tracking: boolean,
  rutaCalculada: readonly unknown[] | null,
): boolean {
  return tracking && !!rutaCalculada && rutaCalculada.length >= 2;
}

/**
 * Tramo OSRM a coordenadas de mapa. La tupla es `[lat, lng]` (API de ruteo), a diferencia del
 * GeoJSON `[lng, lat]` de `paquete.ruta.geometria`.
 */
export function aCoordsRutaCalculada(
  ruta: readonly (readonly [number, number])[] | null | undefined,
): { latitude: number; longitude: number }[] {
  return (ruta ?? []).map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
}
