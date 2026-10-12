// Decisión PURA de "este evento DOM del div del mapa es el usuario cambiando la cámara" para el
// motor Google. Los eventos de cámara de Google (`zoom_changed`, `dragstart`) no distinguen quién
// los causó, y el motor levanta una bandera "programático" (hasta 1.2 s) cuando él mueve la
// cámara; un zoom del usuario dentro de esa ventana se perdía y el follow le peleaba. Mirar el
// input DOM es independiente de esa bandera (equivalente al `originalEvent` de MapLibre).

export interface EventoEntradaMapa {
  tipo: 'wheel' | 'dblclick' | 'keydown' | 'pointerdown';
  /** `KeyboardEvent.key` (solo `keydown`). */
  tecla?: string;
  /** `true` con Ctrl/Meta/Alt pulsado (atajos del navegador, no del mapa). */
  modificador?: boolean;
  /** Punteros activos tras este `pointerdown` (2+ => pellizco). */
  punterosActivos?: number;
  /** El objetivo del evento está dentro de un control de Google (botones de zoom). */
  enControlGoogle?: boolean;
}

/** Teclas con las que el mapa de Google hace zoom o desplaza (`keyboardShortcuts`). */
const TECLAS_CAMARA = new Set([
  '+', '=', '-', '_',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
]);

export function esGestoUsuarioDeCamara(evento: EventoEntradaMapa): boolean {
  switch (evento.tipo) {
    case 'wheel':
    case 'dblclick':
      return true;
    case 'keydown':
      return !evento.modificador && evento.tecla !== undefined && TECLAS_CAMARA.has(evento.tecla);
    case 'pointerdown':
      return Boolean(evento.enControlGoogle) || (evento.punterosActivos ?? 0) >= 2;
    default:
      return false;
  }
}
