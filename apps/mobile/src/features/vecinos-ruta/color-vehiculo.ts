import { COLORES_VEHICULO } from '@quivo/shared';

/** Gris neutro para colores desconocidos, vacíos o `otro`/`multicolor` (sin hex único). */
export const COLOR_VEHICULO_NEUTRO = '#9A9AB0';

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// Los hex salen de `COLORES_VEHICULO` (fuente única de la web); `multicolor` trae un gradiente
// CSS, no un hex, y `otro` es un gris de UI: ambos caen al neutro.
const HEX_POR_COLOR: ReadonlyMap<string, string> = new Map(
  COLORES_VEHICULO.filter((c) => c.muestra.startsWith('#') && c.codigo !== 'otro').map((c) => [
    c.codigo,
    c.muestra,
  ]),
);

/**
 * Hex para pintar la silueta. La API devuelve strings libres (datos históricos), así que se
 * normaliza sin importar mayúsculas ni tildes ("Café" → `cafe`) y se cae al neutro si no se conoce.
 */
export function colorVehiculoAHex(color: string | null | undefined): string {
  if (!color) return COLOR_VEHICULO_NEUTRO;
  return HEX_POR_COLOR.get(normalizar(color)) ?? COLOR_VEHICULO_NEUTRO;
}

/** Igual que `colorVehiculoAHex`, pero `null` si no hay color secundario reconocible. */
export function colorSecundarioAHex(color: string | null | undefined): string | null {
  if (!color) return null;
  return HEX_POR_COLOR.get(normalizar(color)) ?? null;
}
