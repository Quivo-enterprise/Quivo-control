// Lógica PURA de los marcadores de punto del motor Google (`route-map-google.tsx`): qué es
// arrastrable, cuándo el contenido HTML de un marcador debe recrearse (y cuándo NO, para no
// reiniciar el halo animado de `pulse` ni romper un arrastre en curso) y cómo leer/mover una
// posición. Sin imports de mapas ni de React, así se testea en `node`.

import type { MapPoint } from '../types.js';

export interface LatLngPlano {
  lat: number;
  lng: number;
}

/** Un punto es arrastrable solo si lo pide Y hay a quién avisar al soltarlo (como en MapLibre,
 * donde `onDragEnd` es lo único que consume el arrastre). Solo los `markers` se arrastran: igual
 * que en MapLibre, donde el arrastre está cableado únicamente a las capas de marcadores (las
 * paradas `stops` nunca). */
export function esArrastrable(
  punto: Pick<MapPoint, 'draggable' | 'onDragEnd'>,
  tipo: 'stop' | 'marker' = 'marker',
): boolean {
  return tipo === 'marker' && Boolean(punto.draggable && punto.onDragEnd);
}

/** El punto necesita ser enfocable por teclado: es clickable o arrastrable. */
export function esInteractivo(
  punto: Pick<MapPoint, 'onClick' | 'draggable' | 'onDragEnd'>,
  tipo: 'stop' | 'marker' = 'marker',
): boolean {
  return Boolean(punto.onClick) || esArrastrable(punto, tipo);
}

/**
 * Firma del CONTENIDO HTML de un marcador: si no cambia, el elemento existente se conserva
 * (así el halo `pulse` no reinicia su animación en cada render o poll y el foco no se pierde).
 * Las funciones (`onClick`, `onDragEnd`) entran solo como booleano porque cambian de identidad
 * en cada render del consumidor. Que sea arrastrable SÍ entra (cambia role, tabindex, cursor y
 * nombre accesible del elemento), pero la posición no: se mueve con el setter del marcador.
 */
export function firmaPunto(
  punto: Pick<
    MapPoint,
    'pinType' | 'color' | 'label' | 'description' | 'estadoFrescura' | 'placa' | 'onClick' | 'draggable' | 'onDragEnd'
  >,
  contexto: { oscuro: boolean; tipo: 'stop' | 'marker'; rol: string },
): string {
  return [
    contexto.oscuro,
    contexto.tipo,
    contexto.rol,
    punto.pinType,
    punto.color,
    punto.label,
    punto.description,
    punto.estadoFrescura,
    punto.placa,
    esInteractivo(punto, contexto.tipo),
    esArrastrable(punto, contexto.tipo),
  ].join('~');
}

export interface DecisionPunto {
  /** Hay que reemplazar el elemento HTML del marcador. */
  recrearContenido: boolean;
  /** Hay que escribir `marker.position` con la posición recibida. */
  moverPosicion: boolean;
}

/**
 * Qué hacer con un marcador existente cuando llegan props nuevas. Durante un arrastre no se
 * toca nada (ni contenido ni posición): reemplazar el elemento que Google está arrastrando, o
 * devolverlo a la posición vieja, cortaría el gesto. Al terminar, la posición que mande el
 * consumidor se aplica sobre el MISMO marcador (setter), nunca recreándolo.
 */
export function decidirActualizacionPunto(entrada: {
  arrastrando: boolean;
  firmaPrevia: string;
  firmaNueva: string;
  ultima: LatLngPlano;
  posicion: LatLngPlano;
}): DecisionPunto {
  if (entrada.arrastrando) return { recrearContenido: false, moverPosicion: false };
  return {
    recrearContenido: entrada.firmaPrevia !== entrada.firmaNueva,
    moverPosicion: entrada.ultima.lat !== entrada.posicion.lat || entrada.ultima.lng !== entrada.posicion.lng,
  };
}

/** `marker.position` es un `LatLng` (con `lat()`/`lng()`) o un literal/`LatLngAltitude` (números). */
export function latLngDePosicion(
  posicion: { lat: number | (() => number); lng: number | (() => number) } | null | undefined,
): LatLngPlano | null {
  if (!posicion) return null;
  const lat = typeof posicion.lat === 'function' ? posicion.lat() : posicion.lat;
  const lng = typeof posicion.lng === 'function' ? posicion.lng() : posicion.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Píxeles que mueve una flecha del teclado sobre un marcador arrastrable (Mayús = paso grande). */
export const PASO_TECLADO_PX = 8;
export const PASO_TECLADO_GRANDE_PX = 32;

/** Desplazamiento en px de pantalla (y hacia abajo) de una tecla de flecha, o `null` si no lo es. */
export function desplazamientoDeTecla(tecla: string, grande: boolean): { dx: number; dy: number } | null {
  const paso = grande ? PASO_TECLADO_GRANDE_PX : PASO_TECLADO_PX;
  switch (tecla) {
    case 'ArrowLeft':
      return { dx: -paso, dy: 0 };
    case 'ArrowRight':
      return { dx: paso, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -paso };
    case 'ArrowDown':
      return { dx: 0, dy: paso };
    default:
      return null;
  }
}

/** El loop de interpolación solo mueve vehículos que NO se están arrastrando. */
export function debeAnimarEnTick(entrada: { esVehiculo: boolean; arrastrando: boolean }): boolean {
  return entrada.esVehiculo && !entrada.arrastrando;
}
