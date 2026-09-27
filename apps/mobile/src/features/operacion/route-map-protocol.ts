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

/** Un trufi ajeno a dibujar en el mapa (`docs/plan-apk-demo-conductor.md`, paso B; SOLO demo, ver
 * `otrosVehiculos` de `EstadoMapaProtocolo` más abajo). `fotoDataUri` es una entrada de
 * `FOTOS_TRUFI` (`src/demo/datos/fotos.generated.ts`) y `color` el color de la línea
 * (`LINEAS_MOCK[lineaId].color`) — ambos ya resueltos por el caller, este protocolo no sabe nada
 * de datos demo. Es la forma COMPLETA que recibe este módulo desde `operation-screen.tsx`; los
 * mensajes reales que viajan al WebView son más chicos — ver `construirMensajeFotosVehiculos`/
 * `construirMensajeOtrosVehiculos` más abajo. */
export interface VehiculoMapaMensaje {
  id: string;
  lat: number;
  lng: number;
  fotoDataUri: string;
  color: string;
}

/** Forma del mensaje `otros-vehiculos` que de verdad viaja al WebView en cada tick — SIN foto
 * (esa viaja una sola vez, ver `construirMensajeFotosVehiculos`). FIX POST-REVISIÓN (hallazgo de
 * revisión — "la foto de ~3 KB viaja de nuevo cada segundo"): antes cada `VehiculoMapaMensaje`
 * completo (foto incluida) se reenviaba entero en cada tick del motor demo (1 s) — con varios
 * vehículos eso son varios KB de base64 serializados/deserializados por segundo para un dato que
 * NUNCA cambia mientras el trufi está en ruta. */
export interface VehiculoPosicionMapa {
  id: string;
  lat: number;
  lng: number;
  color: string;
}

/** Estado completo del mapa que RN conoce en un momento dado — el mismo conjunto de datos que
 * antes viajaba disperso en 4 llamadas a `postMessage` distintas dentro de `enviarEstadoMapa`. */
export interface EstadoMapaProtocolo {
  tracking: boolean;
  proximoPuntoControlId: string | null;
  posicionActual: { lat: number; lng: number } | null;
  rutaCalculada: [number, number][] | null;
  /** Demo-only (`docs/plan-apk-demo-conductor.md`, paso B): otros trufis de la línea propia, para
   * los marcadores con foto del mapa. `undefined` en la app real — `route-map-view.tsx` solo lo
   * puebla cuando `MODO_DEMO`, y el mensaje `otros-vehiculos` NUNCA se manda si viene `undefined`
   * (a diferencia de `posicionActual`, acá no hace falta distinguir "sin vehículos" de "no
   * aplica": un array vacío ya cubre "sin vehículos" — ver `construirMensajesEstadoMapa`). */
  otrosVehiculos?: VehiculoMapaMensaje[];
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
  // Demo-only, siempre al final — ver el docblock de `otrosVehiculos` en `EstadoMapaProtocolo`.
  // `undefined` (app real, o demo antes del primer tick del motor) NO manda ningún mensaje; un
  // array vacío SÍ los manda (le dice al HTML "borrá los marcadores que tengas", ver
  // `route-map-html.ts`). Esta función solo se usa para el envío de ESTADO COMPLETO (handshake
  // `mapa-listo`/`onLoadEnd`/cambios de tracking-posición-ruta) — el envío recurrente de POSICIÓN
  // de los otros vehículos en cada tick del motor NO pasa por acá, ver el comentario grande en
  // `route-map-view.tsx` sobre por qué `otrosVehiculos` salió de las dependencias del efecto que
  // llama a esta función. `fotos-vehiculos` va ANTES que `otros-vehiculos` a propósito: el HTML
  // cachea las fotos por id (`route-map-html.ts`) y las necesita ya cacheadas para pintar el
  // primer marcador de cada vehículo.
  if (estado.otrosVehiculos) {
    mensajes.push(construirMensajeFotosVehiculos(estado.otrosVehiculos));
    mensajes.push(construirMensajeOtrosVehiculos(estado.otrosVehiculos));
  }
  return mensajes;
}

/** Mensaje `fotos-vehiculos` — la foto de cada trufi ajeno viaja UNA sola vez (acá) en vez de en
 * cada mensaje `otros-vehiculos` (ver el docblock de `VehiculoPosicionMapa`). El HTML la cachea
 * por id y la reusa para siempre mientras esa pestaña del WebView siga viva. */
export function construirMensajeFotosVehiculos(otrosVehiculos: VehiculoMapaMensaje[]): string {
  const fotos: Record<string, string> = {};
  otrosVehiculos.forEach((v) => {
    fotos[v.id] = v.fotoDataUri;
  });
  return JSON.stringify({ type: 'fotos-vehiculos', fotos });
}

/** Mensaje `otros-vehiculos` liviano — solo `{id, lat, lng, color}`, SIN foto (ver
 * `construirMensajeFotosVehiculos`). Es el que se manda en cada tick del motor demo. */
export function construirMensajeOtrosVehiculos(otrosVehiculos: VehiculoMapaMensaje[]): string {
  const vehiculos: VehiculoPosicionMapa[] = otrosVehiculos.map((v) => ({
    id: v.id,
    lat: v.lat,
    lng: v.lng,
    color: v.color,
  }));
  return JSON.stringify({ type: 'otros-vehiculos', vehiculos });
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
