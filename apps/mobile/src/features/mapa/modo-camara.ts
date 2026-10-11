/**
 * Modo de la cámara del mapa de la ruta activa. Reducer puro (sin React ni el SDK) para que cada
 * transición se pruebe sin montar nada; el hook fino es `use-modo-camara.ts` y el consumidor es
 * `RouteMap` (`route-map.tsx`, ver su docblock para el modelo completo de cámara).
 *
 * - `general`: vista de la ruta entera, norte arriba y sin inclinación (día sin iniciar, o tras
 *   finalizar el recorrido).
 * - `navegacion`: cámara bloqueada al vehículo (heading-up, inclinada), movida cuadro a cuadro.
 * - `libre`: el conductor tocó el mapa durante la navegación; la cámara no se mueve sola hasta
 *   que recentre.
 *
 * `accion` + `seq` le dicen al mapa QUÉ movimiento puntual hacer: `seq` sube solo cuando hay un
 * movimiento que ejecutar, así el mapa reacciona a `seq` y no a objetos nuevos. Si un evento no
 * cambia nada el reducer devuelve la MISMA referencia: `onPanDrag` dispara muchas veces por
 * gesto y no debe re-renderizar la pantalla.
 */
export type ModoCamara = 'general' | 'navegacion' | 'libre';
export type AccionCamara = 'seguir' | 'encuadrar' | 'ninguna';

export interface EstadoCamara {
  modo: ModoCamara;
  /** Modo ANTERIOR a la transición que produjo este estado (en el estado inicial, el propio
   * `modo`). Le sirve al mapa para elegir la duración del movimiento puntual: entrar desde
   * `general` es un viaje largo, recentrar desde `libre` uno corto. */
  desde: ModoCamara;
  accion: AccionCamara;
  seq: number;
}

export type EventoCamara =
  | { tipo: 'iniciarRecorrido' }
  | { tipo: 'finalizarRecorrido' }
  | { tipo: 'panUsuario' }
  | { tipo: 'recentrar' };

/** Estado al montar: un remount en pleno recorrido (`tracking`) arranca directo en navegación. */
export function estadoCamaraInicial(tracking: boolean): EstadoCamara {
  return tracking
    ? { modo: 'navegacion', desde: 'navegacion', accion: 'seguir', seq: 0 }
    : { modo: 'general', desde: 'general', accion: 'encuadrar', seq: 0 };
}

export function reducirModoCamara(estado: EstadoCamara, evento: EventoCamara): EstadoCamara {
  switch (evento.tipo) {
    case 'iniciarRecorrido':
      if (estado.modo === 'navegacion') return estado;
      return { modo: 'navegacion', desde: estado.modo, accion: 'seguir', seq: estado.seq + 1 };
    case 'finalizarRecorrido':
      // Siempre emite, incluso desde `general`: solo ocurre en un borde de `tracking`, es barato.
      return { modo: 'general', desde: estado.modo, accion: 'encuadrar', seq: estado.seq + 1 };
    case 'panUsuario':
      if (estado.modo !== 'navegacion') return estado;
      return { modo: 'libre', desde: estado.modo, accion: 'ninguna', seq: estado.seq };
    case 'recentrar':
      if (estado.modo === 'general') {
        return { modo: 'general', desde: estado.modo, accion: 'encuadrar', seq: estado.seq + 1 };
      }
      return { modo: 'navegacion', desde: estado.modo, accion: 'seguir', seq: estado.seq + 1 };
  }
}
