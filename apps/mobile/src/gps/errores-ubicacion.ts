/**
 * Clasificación PURA de los códigos de error de ubicación del SDK
 * (`react-native-background-geolocation`, `LocationError`): 0 desconocido, 1 permiso denegado,
 * 2 red, 3 servicio en background con permiso "Solo mientras se usa", 408 `LOCATION_TIMEOUT`,
 * 499 cancelado.
 *
 * Por qué existe (prueba de campo del APK r13): un 408 es solo "no hubo fix a tiempo" (cielo
 * tapado, cañón urbano) y se resuelve solo en el siguiente fix — mostrarle al conductor
 * "No se pudo registrar una ubicación (código 408)" lo asusta sin darle nada que hacer, y
 * reportarlo a Sentry como error inundaba el panel. Solo los códigos que el conductor SÍ puede
 * corregir (permisos) merecen un mensaje; el resto es transitorio.
 */
export type ClasificacionErrorUbicacion = {
  tipo: 'transitorio' | 'permanente' | 'desconocido';
  /** Texto para el conductor; `null` en los transitorios y desconocidos (no se muestra nada). */
  mensaje: string | null;
};

const MENSAJE_PERMISO_DENEGADO =
  'Quivo no tiene permiso de ubicación. Actívalo en Ajustes para registrar el recorrido.';
const MENSAJE_SOLO_MIENTRAS_SE_USA =
  "La ubicación está en 'Solo mientras se usa'. Cámbiala a 'Permitir siempre' para registrar con la pantalla apagada.";

/** Solo 408/0/2/499 (códigos reconocidos del SDK) son transitorios. Cualquier otro código —o
 * uno ilegible (`null`/`undefined`)— es `desconocido`: no se le muestra nada al conductor, pero
 * tampoco se degrada en silencio a "ruido esperado" (el llamador decide si lo reporta). */
export function clasificarErrorUbicacion(
  code: number | null | undefined,
): ClasificacionErrorUbicacion {
  if (code === 1) return { tipo: 'permanente', mensaje: MENSAJE_PERMISO_DENEGADO };
  if (code === 3) return { tipo: 'permanente', mensaje: MENSAJE_SOLO_MIENTRAS_SE_USA };
  if (code === 0 || code === 2 || code === 408 || code === 499) {
    return { tipo: 'transitorio', mensaje: null };
  }
  return { tipo: 'desconocido', mensaje: null };
}

/** Extrae el código numérico de lo que rechaza/entrega el SDK: normalmente un número, a veces
 * un objeto `{ code }` o un `Error` con `code`. `null` si no se puede leer. */
export function codigoDeErrorUbicacion(error: unknown): number | null {
  if (typeof error === 'number') return error;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}
