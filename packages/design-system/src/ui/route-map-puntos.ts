// Lógica PURA de los marcadores de punto del motor Google (`route-map-google.tsx`): qué es
// arrastrable, cuándo el contenido HTML de un marcador debe recrearse (y cuándo NO, para no
// reiniciar el halo animado de `pulse` ni romper un arrastre en curso) y cómo leer/mover una
// posición. Sin imports de mapas ni de React, así se testea en `node`.

import type { MapPoint } from '../types.js';
import { alertaVisible } from './route-map-vehiculo.js';

export interface LatLngPlano {
  lat: number;
  lng: number;
}

/** Un punto es arrastrable solo si lo pide Y hay a quién avisar al soltarlo (como en MapLibre,
 * donde `onDragEnd` es lo único que consume el arrastre). Solo los `markers` se arrastran: igual
 * que en MapLibre, donde el arrastre está cableado únicamente a las capas de marcadores (las
 * paradas `stops` nunca). Los vehículos tampoco: su posición la manda la interpolación. */
export function esArrastrable(
  punto: Pick<MapPoint, 'draggable' | 'onDragEnd' | 'pinType'>,
  tipo: 'stop' | 'marker' = 'marker',
): boolean {
  return tipo === 'marker' && punto.pinType !== 'vehicle' && Boolean(punto.draggable && punto.onDragEnd);
}

/** El punto necesita ser enfocable por teclado: es clickable o arrastrable. */
export function esInteractivo(
  punto: Pick<MapPoint, 'onClick' | 'draggable' | 'onDragEnd' | 'pinType'>,
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
    | 'pinType'
    | 'color'
    | 'label'
    | 'description'
    | 'estadoFrescura'
    | 'placa'
    | 'fotoUrl'
    | 'colorLinea'
    | 'alerta'
    | 'molinos'
    | 'onClick'
    | 'draggable'
    | 'onDragEnd'
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
    punto.fotoUrl,
    punto.colorLinea,
    // Solo lo que obliga a rehacer el dibujo: nivel y parpadeo. La cantidad de abiertas y la
    // selección se actualizan EN el elemento existente (`actualizarVehiculoEnLugar`): recrearlo
    // por eso recargaría la foto y reiniciaría la animación.
    alertaVisible(punto.alerta) ? `${punto.alerta.nivel}:${punto.alerta.parpadea}` : '',
    punto.molinos ? 'M' : '',
    esInteractivo(punto, contexto.tipo),
    esArrastrable(punto, contexto.tipo),
  ].join('~');
}

/** Texto de ayuda de teclado de un marcador arrastrable (mecánica nativa de Google). Se dice
 * Alt+Enter y no Alt+Espacio: en Windows Alt+Espacio abre el menú de la ventana. */
export const AYUDA_ARRASTRE_TECLADO = 'Alt+Enter para mover';

/** Nombre accesible de un punto. Arrastrable: corto, "Nodo 2 — Alt+Enter para mover" (es también
 * el tooltip del anfitrión; el detalle va en `descripcionPunto`). Resto: etiqueta y descripción. */
export function etiquetaPunto(
  punto: Pick<MapPoint, 'label' | 'description' | 'draggable' | 'onDragEnd' | 'pinType'>,
  tipo: 'stop' | 'marker',
): string {
  if (!esArrastrable(punto, tipo)) return [punto.label?.trim(), punto.description].filter(Boolean).join(', ');
  const nombre = punto.label?.trim() || punto.description?.trim() || '';
  return [nombre, AYUDA_ARRASTRE_TECLADO].filter(Boolean).join(' — ');
}

/** Descripción larga (`aria-description` del anfitrión) de un marcador arrastrable. */
export function descripcionPunto(
  punto: Pick<MapPoint, 'label' | 'description' | 'draggable' | 'onDragEnd' | 'pinType'>,
  tipo: 'stop' | 'marker',
): string {
  return esArrastrable(punto, tipo) && punto.label?.trim() ? (punto.description?.trim() ?? '') : '';
}

/** Ventana en la que un `click` todavía cuenta como el que cierra un arrastre. */
export const VENTANA_CLICK_TRAS_ARRASTRE_MS = 500;

/**
 * El `click` que el navegador emite al soltar un arrastre (o el que Google emite por el Enter que
 * suelta) no es una activación. `finArrastreTs` es el `timeStamp` del fin del arrastre (null si no
 * hay uno pendiente). Se suprime UN solo click y solo si llega dentro de la ventana; el estado
 * siempre queda consumido, así un click posterior (p. ej. sintético de un lector de pantalla)
 * funciona. Compara `timeStamp` de eventos: sin temporizadores.
 */
export function clickTrasArrastre(
  finArrastreTs: number | null,
  clickTs: number,
): { suprimir: boolean; finArrastreTs: null } {
  if (finArrastreTs === null) return { suprimir: false, finArrastreTs: null };
  const transcurrido = clickTs - finArrastreTs;
  return { suprimir: transcurrido >= 0 && transcurrido <= VENTANA_CLICK_TRAS_ARRASTRE_MS, finArrastreTs: null };
}

/**
 * Red de seguridad para `arrastrando`: normalmente solo lo baja `gmp-dragend`, pero si ese evento
 * no llega (Esc, foco perdido, el punto dejó de ser arrastrable) el marcador quedaría congelado.
 * - `pointerdown`: una pulsación nueva nunca es parte de un arrastre en curso.
 * - `keydown`: en un arrastre con puntero cualquier tecla lo interrumpe; en uno por teclado solo
 *   Esc lo cancela (las flechas y Enter son el propio arrastre).
 * - `focusout` del anfitrión: un arrastre por teclado sin foco no puede continuar.
 */
export function debeCerrarArrastre(
  evento: { tipo: 'pointerdown' | 'keydown' | 'focusout'; tecla?: string },
  estado: { arrastrando: boolean; modo: 'puntero' | 'teclado' },
): boolean {
  if (!estado.arrastrando) return false;
  if (evento.tipo === 'pointerdown') return true;
  if (evento.tipo === 'focusout') return estado.modo === 'teclado';
  return estado.modo === 'puntero' || evento.tecla === 'Escape';
}

export interface DecisionPunto {
  /** Hay que reemplazar el elemento HTML del marcador. */
  recrearContenido: boolean;
  /** Hay que escribir `marker.position` con la posición recibida. */
  moverPosicion: boolean;
  /** Es seguro alinear `gmpDraggable` con el flag vigente (no hay arrastre en curso). */
  sincronizarArrastre: boolean;
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
  if (entrada.arrastrando) return { recrearContenido: false, moverPosicion: false, sincronizarArrastre: false };
  return {
    sincronizarArrastre: true,
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
