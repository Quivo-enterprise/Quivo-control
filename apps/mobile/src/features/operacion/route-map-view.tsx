import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { quivoRadius } from '../../shared/theme/quivo-theme';
import { construirHtml } from './route-map-html';

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
  // estado que ahora viaja por `postMessage` (ver `enviarEstadoMapa` abajo), no por reconstrucción
  // de HTML. Ver el comentario grande en `construirHtml` (route-map-html.ts) para el detalle.
  const html = useMemo(() => construirHtml(paquete, vehiculo), [paquete, vehiculo]);
  const source = useMemo(() => ({ html }), [html]);

  const enviarEstadoMapa = useCallback(() => {
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'tracking',
        active: tracking,
      }),
    );
    // Próximo punto de control: mensaje propio (no viaja dentro de 'tracking') para que el
    // handler del HTML pueda reestilizar solo los marcadores sin acoplarse al resto del estado
    // de seguimiento. Se manda siempre acá, en el mismo camino que el resto de `enviarEstadoMapa`
    // (montaje + cada `onLoadEnd`), porque el script del WebView arranca con
    // `proximoPuntoIdActual = null` — nunca lo recibe horneado en el HTML.
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'proximoPuntoControl', id: proximoPuntoControlId }),
    );
    if (posicionActual) {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'position', ...posicionActual }));
    }
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'ruta-calculada', coordinates: rutaCalculada }),
    );
  }, [posicionActual, proximoPuntoControlId, rutaCalculada, tracking]);

  useEffect(enviarEstadoMapa, [enviarEstadoMapa]);

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
        onLoadEnd={enviarEstadoMapa}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 260, borderRadius: quivoRadius.lg, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
