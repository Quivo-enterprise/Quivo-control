import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { quivoRadius } from '../../shared/theme/quivo-theme';
import { construirHtml } from './route-map-html';
import {
  construirMensajesEstadoMapa,
  esHandshakeMapaListo,
  type EstadoMapaProtocolo,
} from './route-map-protocol';

interface RouteMapViewProps {
  paquete: PaqueteDia;
  vehiculo: ContextoOperativoMovil['vehiculo'];
  proximoPuntoControlId: string | null;
  posicionActual: { lat: number; lng: number } | null;
  tracking: boolean;
  recenterTick: number;
  /** Ruta real siguiendo calles (OSRM), o `null` si no hay ninguna calculada aún o falló */
  rutaCalculada: [number, number][] | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * Mapa de la ruta activa según el diseño de Figma:
 * - Ruta oscura (#1E1B4B) en espera, naranja (#FE9B0B) en seguimiento activo.
 * - Puntos de control: círculos azules (#3127B1) con número blanco, verdes (#22C55E) cuando ya se pasaron.
 * - Flecha de navegación triangular azul (#3127B1) orientada según el rumbo.
 *
 * El HTML que corre dentro del WebView (Leaflet + la lógica de dibujado) vive en
 * `route-map-html.ts`, separado de este componente para poder testearlo sin RN — Entrega 25
 * del plan post-piloto: Leaflet viaja inline en ese HTML (no desde unpkg), así que este mapa
 * arranca sin red. Ver el comentario de cabecera de `route-map-html.ts` para el detalle.
 */
export function RouteMapView({
  paquete,
  vehiculo,
  proximoPuntoControlId,
  posicionActual,
  tracking,
  recenterTick,
  rutaCalculada,
  style,
}: RouteMapViewProps) {
  const webViewRef = useRef<WebView>(null);
  // Entrega 31b (defecto post-piloto): `proximoPuntoControlId` SALE de estas dependencias a
  // propósito. Antes estaba acá y cada vez que el conductor pasaba un punto de control (cambia
  // el próximo) React recalculaba un `html` nuevo — mismo string salvo ese valor — y se lo pasaba
  // a la WebView como `source.html` nuevo, forzando una recarga COMPLETA del documento: Leaflet
  // se reinstancia, se pierde el marcador de posición/estado de seguimiento hasta el próximo
  // `onLoadEnd`, y el controlador de tiles arranca de cero. En una ruta de 26 puntos de control
  // son 26 recargas con parpadeo. Lo único que de verdad cambia la ruta dibujada (la geometría,
  // los puntos de control fijos) depende de `paquete`/`vehiculo` — el próximo punto de control es
  // estado que ahora viaja por `postMessage` (ver `enviarEstadoCompleto` abajo), no por reconstrucción
  // de HTML. Ver el comentario grande en `construirHtml` (route-map-html.ts) para el detalle.
  const html = useMemo(() => construirHtml(paquete, vehiculo), [paquete, vehiculo]);
  // `baseUrl` (dominio real de producción de este proyecto, confirmado en `apps/api/README.md` y
  // `docs/plan-integracion-redesign-jairo.md`: CORS_ORIGIN/paneles públicos apuntan a
  // `control.myquivo.com`) — hallazgo del code-review de esta entrega: sin `baseUrl`, el WebView
  // carga este HTML desde un string sin ningún origen, así que las peticiones de tiles a
  // `tile.openstreetmap.org` (`route-map-html.ts`) salían sin header `Referer`. La política de uso
  // de OSM pide un Referer identificable — sin él, OSM puede bloquear la IP, y el bucle de
  // reintento (antes sin tope, ver el fix en `route-map-html.ts`) volvía a pedir cada tile visible
  // cada 30s para siempre, agravando el bloqueo. `baseUrl` NO afecta a Leaflet ni al CSS: ambos
  // viajan inline dentro del mismo string de `html` (`leaflet-inline.generated.ts`), así que no
  // son peticiones de red que dependan de resolverse contra este origen — y por la misma razón
  // tampoco rompe el arranque sin red (offline): lo único que cambia es el header `Referer` que
  // manda el WebView al pedir un tile, nunca cómo se resuelven los recursos inline.
  const source = useMemo(() => ({ html, baseUrl: 'https://control.myquivo.com/' }), [html]);

  // Entrega 25/31b (handshake mapa-listo): guarda el último estado conocido en una ref —
  // actualizada en cada render, ver más abajo — para que `enviarEstadoCompleto` pueda mandarlo
  // desde CUALQUIER disparador (el cambio de props de siempre, `onLoadEnd`, o ahora también el
  // mensaje `mapa-listo` que llega por `onMessage`) sin depender de qué closure exacta haya
  // quedado registrada como callback en ese momento. Ver `route-map-protocol.ts` para el porqué
  // completo del handshake y el diseño de `EstadoMapaProtocolo`.
  const estadoActualRef = useRef<EstadoMapaProtocolo>({
    tracking,
    proximoPuntoControlId,
    posicionActual,
    rutaCalculada,
  });
  estadoActualRef.current = { tracking, proximoPuntoControlId, posicionActual, rutaCalculada };

  const enviarEstadoCompleto = useCallback(() => {
    construirMensajesEstadoMapa(estadoActualRef.current).forEach((mensaje) => {
      webViewRef.current?.postMessage(mensaje);
    });
  }, []);

  // Sigue mandando el estado cada vez que cambia una de estas props (comportamiento de siempre) —
  // el handshake de abajo (`onMessage` + `mapa-listo`) es el mecanismo que GARANTIZA que el
  // primer envío no se pierda, no un reemplazo de este disparador por cambios posteriores.
  useEffect(enviarEstadoCompleto, [
    tracking,
    proximoPuntoControlId,
    posicionActual,
    rutaCalculada,
    enviarEstadoCompleto,
  ]);

  // Entrega 25/31b (handshake mapa-listo): el HTML (`route-map-html.ts`) manda
  // `{type:'mapa-listo'}` por `ReactNativeWebView.postMessage` apenas registra sus listeners de
  // `message` — antes de tocar tiles o cualquier otro recurso de red. Antes de este handshake, el
  // estado inicial (posición del vehículo incluida) se mandaba a ciegas desde `useEffect`/
  // `onLoadEnd`, sin saber si esos listeners ya existían: si el script del WebView tardaba en
  // llegar a esa línea (motor más lento, dispositivo viejo, primera carga), el mensaje se perdía
  // en el vacío y el marcador de posición quedaba ausente hasta el próximo cambio de estado —
  // mismo síntoma reportado como "la flecha del vehículo aparece congelada" (la ruta sí se dibuja
  // porque no depende de ningún mensaje). Con el handshake, en cambio, es el propio HTML el que
  // avisa cuándo está listo para recibir, y acá simplemente respondemos con el estado completo
  // más reciente (`estadoActualRef.current`). Si el WebView se recarga (nueva navegación, error
  // de red, etc.) el script vuelve a ejecutar desde cero y manda `mapa-listo` de nuevo, así que
  // este mismo handler repite el envío sin necesidad de lógica adicional.
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (esHandshakeMapaListo(event.nativeEvent.data)) {
        enviarEstadoCompleto();
      }
    },
    [enviarEstadoCompleto],
  );

  const lastRecenter = useRef(recenterTick);
  useEffect(() => {
    if (recenterTick > lastRecenter.current) {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'recenter' }));
      lastRecenter.current = recenterTick;
    }
  }, [recenterTick]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={source}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled={false}
        // `onLoadEnd` queda como respaldo (reenvía el mismo estado, idempotente en el HTML) por si
        // el motor de WebView lo dispara después de que el script ya registró sus listeners — pero
        // el mecanismo que GARANTIZA que no se pierda el primer envío es `onMessage` + el handshake
        // `mapa-listo` de arriba, no este callback.
        onLoadEnd={enviarEstadoCompleto}
        onMessage={onMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 260, borderRadius: quivoRadius.lg, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
