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
  const html = useMemo(
    () => construirHtml(paquete, vehiculo, proximoPuntoControlId),
    [paquete, vehiculo, proximoPuntoControlId],
  );
  const source = useMemo(() => ({ html }), [html]);

  const enviarEstadoMapa = useCallback(() => {
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'tracking',
        active: tracking,
        proximoPuntoControlId,
      }),
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
