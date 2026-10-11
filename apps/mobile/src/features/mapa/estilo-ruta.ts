/**
 * Estilo de la ruta en el mapa según el estado del recorrido — funciones puras, portadas del
 * HTML de Leaflet que ya no existe (paridad: colores espera/seguimiento y tramo OSRM).
 */

/** Ruta en espera (recorrido sin iniciar). */
export const COLOR_ESPERA = '#1E1B4B';
/** Ruta en seguimiento activo y tramo OSRM resaltado. */
export const COLOR_LINEA = '#FE9B0B';

export interface EstiloRuta {
  color: string;
  grosor: number;
}

/** Oscura y más fina en espera; naranja y más gruesa en seguimiento. */
export function estiloRuta(tracking: boolean): EstiloRuta {
  return tracking ? { color: COLOR_LINEA, grosor: 5.5 } : { color: COLOR_ESPERA, grosor: 4.5 };
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
