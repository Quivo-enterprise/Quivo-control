/**
 * Lógica PURA (sin `react` ni `react-native`) de la detección de la transición offline→online
 * del teléfono — separada de `reconexion-mapa-offline.ts` (el hook que la cablea con
 * `useNetInfo`) a propósito: `@react-native-community/netinfo` arrastra `react-native` entero,
 * que no corre bajo `vitest`/Node (mismo motivo documentado en
 * `sync-outbox.lease.test.ts`/`drenaje-oportunista.test.ts` — hay que mockear el paquete entero
 * para poder importar cualquier módulo que lo toque). Manteniendo esta lógica en un archivo sin
 * ningún import de React/RN, `reconexion-detector.test.ts` la testea directo, sin mocks.
 *
 * Decisión del CTO (2026-09-25): el mapa offline (`route-map-html.ts`) reintenta cada tile de
 * OpenStreetMap que falla con backoff exponencial hasta un tope de intentos (ver el comentario
 * grande sobre `CONTROLADOR_TILES_JS_SOURCE` en `route-map-html.ts`). Agotado ese tope, el tile
 * queda abandonado con `errorTileUrl` hasta que un pan/zoom lo saque de la vista y Leaflet cree un
 * `<img>` nuevo — si el corte de red duró más que esa ventana (con los defaults, ~15 minutos), el
 * chofer se queda sin esas calles hasta mover el mapa a mano, aunque la conexión ya haya vuelto.
 * Este módulo (junto con `reconexion-mapa-offline.ts`) cierra ese hueco: detecta la transición
 * offline→online del propio teléfono (no de si `tile.openstreetmap.org` responde — eso lo sigue
 * resolviendo el controlador de tiles del WebView con sus propios reintentos) para que
 * `route-map-view.tsx` le avise al mapa (`postMessage({ type: 'reconectado' })`) que reinicie los
 * contadores de los tiles pendientes/abandonados y los vuelva a pedir de una.
 */

/** Debounce entre una reconexión detectada y el disparo real del callback — redes que "aletean"
 * (Wi-Fi que se reconecta varias veces en un segundo al recuperar señal, handoff Wi-Fi↔datos)
 * pueden mandar varios eventos offline→online→offline en rápida sucesión; sin debounce cada uno
 * dispararía su propio reinicio de contadores y su propio lote de re-pedidos de tiles. */
export const DEBOUNCE_RECONEXION_MS = 2000;

/**
 * `true` si el teléfono está online según NetInfo. Misma idea que `calcularIsOffline` en
 * `use-sync-status.ts` pero en sentido positivo y con la fórmula que pidió el CTO:
 * `isConnected && isInternetReachable !== false`. `isInternetReachable` queda en `null` mientras
 * NetInfo todavía no resolvió la conectividad real (común apenas arranca la app o al cambiar de
 * red) — tratarlo como "no offline" (en vez de exigir que sea exactamente `true`) evita quedar
 * pegado en `isOnline = false` en ese estado transitorio tan común en los Android de gama baja a
 * los que apunta esta app.
 */
export function esOnline(isConnected: boolean | null, isInternetReachable: boolean | null): boolean {
  return isConnected === true && isInternetReachable !== false;
}

export interface OpcionesDetectorReconexion {
  /** Ventana de debounce en ms — ver `DEBOUNCE_RECONEXION_MS`. */
  debounceMs: number;
  /** Se invoca UNA sola vez por cada transición offline→online que sobrevive el debounce (nunca
   * en online→online ni mientras el teléfono sigue offline). */
  onReconectado: () => void;
}

export interface DetectorReconexion {
  /** Notifica el estado de conectividad ACTUAL (ver `esOnline`) — se llama en cada cambio que
   * reporte NetInfo, no solo en las transiciones; el detector decide internamente cuándo
   * corresponde disparar. */
  notificar: (online: boolean) => void;
  /** Cancela cualquier disparo pendiente (debounce en curso) — se llama al desmontar el
   * componente que posee este detector, para no invocar `onReconectado` sobre un mapa que ya no
   * existe. */
  destruir: () => void;
}

/**
 * Detector puro (sin NetInfo ni React) de la transición offline→online, con debounce — testeado
 * en `reconexion-detector.test.ts` con `vi.useFakeTimers()`. `useReconexionMapaOffline` (en
 * `reconexion-mapa-offline.ts`) es el único llamador real; separarlo así permite testear
 * "offline→online dispara una vez", "online→online no dispara" y el debounce contra redes que
 * aletean sin necesitar `react-native`/NetInfo ni mocks.
 */
export function crearDetectorReconexion(opciones: OpcionesDetectorReconexion): DetectorReconexion {
  // Arranca asumiendo que NO venimos de un offline conocido — el primer `notificar(true)` (el
  // mapa ya estaba online al montarse) NO debe disparar `onReconectado`: no hay ningún tile
  // abandonado que reintentar todavía en ese caso, y el montaje inicial del mapa ya arranca sus
  // propios reintentos desde cero (ver `route-map-view.tsx`/`route-map-html.ts`).
  let estabaOffline = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelarTimerPendiente() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function notificar(online: boolean) {
    if (!online) {
      estabaOffline = true;
      // Un nuevo corte de red cancela cualquier disparo de reconexión que estuviera esperando su
      // debounce — si la conexión se va de nuevo antes de confirmarse, todavía no "volvió" de
      // verdad (red que aletea).
      cancelarTimerPendiente();
      return;
    }
    if (!estabaOffline) return; // online → online: no es una transición, no dispara.
    // offline → online: espera el debounce antes de confirmar. Si llega OTRO 'online' mientras
    // el timer sigue corriendo (NetInfo puede reportar el mismo estado más de una vez), reinicia
    // la espera en vez de acumular timers en paralelo.
    cancelarTimerPendiente();
    timer = setTimeout(() => {
      timer = null;
      estabaOffline = false;
      opciones.onReconectado();
    }, opciones.debounceMs);
  }

  function destruir() {
    cancelarTimerPendiente();
  }

  return { notificar, destruir };
}
