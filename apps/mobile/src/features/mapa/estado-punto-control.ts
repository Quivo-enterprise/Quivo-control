/**
 * Reglas de negocio de los puntos de control en el mapa, extraídas a funciones puras (sin React
 * ni `react-native-maps`) para poder testearlas con `vitest`. El estado de cada punto lo deriva
 * `derivarProgreso` (`operacion/progreso-vuelta.ts`, RF-GPS-054): pasados en cualquier orden,
 * omitidos (rojo), próximo y pendientes.
 */

import type { EstadoPuntoVuelta } from '../operacion/progreso-vuelta';

export const COLOR_PUNTO_CONTROL = '#3127B1';
export const COLOR_PUNTO_CONTROL_COMPLETADO = '#22C55E';
export const COLOR_PUNTO_CONTROL_OMITIDO = '#C53B4A';

/** Aspecto del marcador numerado. `proximo` y `pendiente` comparten el azul de siempre. */
export type AspectoPuntoControl = 'pendiente' | 'pasado' | 'omitido';

/**
 * Aspecto del marcador según el estado derivado. Sin `tracking` ningún punto se marca nunca, por
 * diseño: la ruta en espera se muestra "virgen".
 */
export function aspectoPuntoControl(
  estado: EstadoPuntoVuelta | undefined,
  tracking: boolean,
): AspectoPuntoControl {
  if (!tracking) return 'pendiente';
  if (estado === 'pasado' || estado === 'omitido') return estado;
  return 'pendiente';
}

/** Color de relleno del marcador numerado de un punto de control. */
export function colorPuntoControl(aspecto: AspectoPuntoControl): string {
  if (aspecto === 'pasado') return COLOR_PUNTO_CONTROL_COMPLETADO;
  if (aspecto === 'omitido') return COLOR_PUNTO_CONTROL_OMITIDO;
  return COLOR_PUNTO_CONTROL;
}
