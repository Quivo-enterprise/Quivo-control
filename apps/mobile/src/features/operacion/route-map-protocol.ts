/**
 * Protocolo de `postMessage` entre el HTML del mapa (WebView, `route-map-html.ts`) y RN
 * (`route-map-view.tsx`) — extraído a funciones puras, sin ninguna referencia a `WebView` ni al
 * DOM, para poder testearlas con `vitest` en Node. Ver el comentario grande sobre el handshake
 * `mapa-listo` en `route-map-view.tsx` para el detalle completo del problema que resuelve.
 *
 * Entrega 25/31b (post-piloto): el estado inicial del mapa (posición del vehículo incluida) se
 * mandaba desde RN con un `useEffect`/`onLoadEnd` sin saber si el `<script>` del HTML ya había
 * llegado a registrar sus listeners de `message`. Si el mensaje llegaba antes, se perdía en el
 * vacío — mismo síntoma que "la flecha del vehículo aparece congelada": la ruta se dibuja (no
 * depende de ningún mensaje), pero el marcador de posición nunca llega a existir hasta el próximo
 * cambio de estado. El fix es un handshake: el HTML avisa `mapa-listo` apenas sus listeners
 * existen (sin esperar tiles ni ninguna otra red) y RN responde con el estado COMPLETO actual.
 */

/** Estado completo del mapa que RN conoce en un momento dado — el mismo conjunto de datos que
 * antes viajaba disperso en 4 llamadas a `postMessage` distintas dentro de `enviarEstadoMapa`. */
export interface EstadoMapaProtocolo {
  tracking: boolean;
  proximoPuntoControlId: string | null;
  posicionActual: { lat: number; lng: number } | null;
  rutaCalculada: [number, number][] | null;
}

/**
 * Construye, en el mismo orden en que `route-map-view.tsx` los mandaba antes de esta extracción,
 * los mensajes JSON (ya serializados, listos para `webViewRef.current?.postMessage(...)`) que le
 * comunican al HTML el estado completo actual. Pura: no toca ninguna ref de WebView — eso lo hace
 * el llamador, iterando el array que devuelve esta función. El mensaje `'position'` se omite por
 * completo cuando no hay ninguna posición conocida todavía (en vez de mandar `null`), igual que el
 * `if (posicionActual)` que tenía `enviarEstadoMapa`.
 */
export function construirMensajesEstadoMapa(estado: EstadoMapaProtocolo): string[] {
  const mensajes: string[] = [
    JSON.stringify({ type: 'tracking', active: estado.tracking }),
    JSON.stringify({ type: 'proximoPuntoControl', id: estado.proximoPuntoControlId }),
  ];
  if (estado.posicionActual) {
    mensajes.push(JSON.stringify({ type: 'position', ...estado.posicionActual }));
  }
  mensajes.push(JSON.stringify({ type: 'ruta-calculada', coordinates: estado.rutaCalculada }));
  return mensajes;
}

/**
 * `true` si el mensaje que llegó por `onMessage` de la WebView es el handshake `mapa-listo` que
 * emite el `<script>` del HTML apenas registra sus listeners de `message` (ver el comentario junto
 * a `document.addEventListener('message', ...)` en `route-map-html.ts`) — la señal de que ya puede
 * recibir con seguridad el estado completo sin perder el primer mensaje. Tolera JSON inválido o de
 * otra forma (devuelve `false` en vez de tirar) porque `event.nativeEvent.data` puede traer
 * cualquier string si el HTML llega a mandar algo más en el futuro.
 */
export function esHandshakeMapaListo(rawData: unknown): boolean {
  if (typeof rawData !== 'string') return false;
  try {
    const data: unknown = JSON.parse(rawData);
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: unknown }).type === 'mapa-listo'
    );
  } catch {
    return false;
  }
}
