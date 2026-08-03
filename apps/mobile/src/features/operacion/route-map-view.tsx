import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { PaqueteDia } from '@quivo/shared';
import { quivoRadius } from '../../shared/theme/quivo-theme';

interface RouteMapViewProps {
  paquete: PaqueteDia;
  proximoPuntoControlId: string | null;
  posicionActual: { lat: number; lng: number } | null;
  tracking: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Mapa de la ruta activa (RF-64, QUI-243): Leaflet + tiles de OpenStreetMap dentro de un
 * WebView — 100% open source, sin API key. `react-native-maps` se probó primero pero en
 * Android solo soporta Google Maps y exige una API key real (confirmado con un crash real
 * en un Moto E13 sin key configurada) — se reemplazó por este enfoque, mismo motor que
 * `RouteMap` del design system web (Leaflet, decisión ya tomada en QUI-229), sin necesitar
 * credenciales de Google.
 *
 * Leaflet se carga desde CDN (`unpkg.com`) — sin red, el mapa no renderiza, mismo límite
 * que los propios tiles de OSM. El resto de la pantalla de operación no depende de esto
 * (ver `MapErrorBoundary`, que aísla cualquier falla acá del resto de la UI).
 */
export function RouteMapView({
  paquete,
  proximoPuntoControlId,
  posicionActual,
  tracking,
  style,
}: RouteMapViewProps) {
  const webViewRef = useRef<WebView>(null);
  const html = useMemo(
    () => construirHtml(paquete, proximoPuntoControlId),
    [paquete, proximoPuntoControlId],
  );
  const source = useMemo(() => ({ html }), [html]);
  const enviarEstadoMapa = useCallback(() => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'tracking', active: tracking }));
    if (posicionActual) {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: 'position', ...posicionActual }),
      );
    }
  }, [posicionActual, tracking]);
  useEffect(enviarEstadoMapa, [enviarEstadoMapa]);

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

function construirHtml(paquete: PaqueteDia, proximoPuntoControlId: string | null): string {
  const coordenadasRuta = paquete.ruta.geometria.coordinates.map(([lng, lat]) => [lat, lng]);

  const marcadoresParadas = paquete.paradas
    .map((parada) => {
      const [lng, lat] = parada.coord.coordinates;
      const etiqueta =
        parada.tipo === 'origen' ? 'Origen' : parada.tipo === 'destino' ? 'Destino' : 'Parada';
      return `L.marker([${lat}, ${lng}]).addTo(map).bindPopup(${JSON.stringify(etiqueta)});`;
    })
    .join('\n');

  const marcadoresPc = paquete.puntosControl
    .map((puntoControl) => {
      const [lng, lat] = puntoControl.coord.coordinates;
      const esProximo = puntoControl.id === proximoPuntoControlId;
      const color = esProximo ? '#FD9E15' : '#9191B0';
      const etiqueta = esProximo ? 'Próximo punto de control' : 'Punto de control';
      return `L.circleMarker([${lat}, ${lng}], { radius: 8, color: ${JSON.stringify(color)}, fillColor: ${JSON.stringify(color)}, fillOpacity: 0.9 }).addTo(map).bindPopup(${JSON.stringify(etiqueta)});`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    #recenter {
      position: fixed; right: 16px; bottom: 210px; z-index: 1000;
      width: 48px; height: 48px; border: 0; border-radius: 24px;
      background: white; color: #3226B4; font: 700 21px sans-serif;
      box-shadow: 0 3px 12px rgba(26,26,46,.22);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <button id="recenter" aria-label="Centrar en mi ubicación">◎</button>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    var ruta = L.polyline(${JSON.stringify(coordenadasRuta)}, { color: ${JSON.stringify(paquete.linea.color)}, weight: 4 }).addTo(map);
    ${marcadoresParadas}
    ${marcadoresPc}
    var posicion = null;
    var seguimientoActivo = false;
    function updateMap(data) {
      if (!data) return;
      if (data.type === 'tracking') {
        seguimientoActivo = data.active === true;
        if (seguimientoActivo && posicion) {
          map.flyTo(posicion.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.7 });
        } else if (!seguimientoActivo) {
          map.fitBounds(ruta.getBounds(), { paddingTopLeft: [36, 100], paddingBottomRight: [36, 230] });
        }
        return;
      }
      if (data.type !== 'position') return;
      var latlng = [data.lat, data.lng];
      if (!posicion) {
        posicion = L.circleMarker(latlng, { radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#3226B4', fillOpacity: 1 }).addTo(map).bindPopup('Tu ubicación');
      } else {
        posicion.setLatLng(latlng);
      }
      if (seguimientoActivo) map.flyTo(latlng, Math.max(map.getZoom(), 17), { duration: 0.6 });
    }
    function receiveMessage(event) {
      try { updateMap(JSON.parse(event.data)); } catch (_) {}
    }
    document.addEventListener('message', receiveMessage);
    window.addEventListener('message', receiveMessage);
    map.on('dragstart', function () { seguimientoActivo = false; });
    document.getElementById('recenter').addEventListener('click', function () {
      if (!posicion) return;
      seguimientoActivo = true;
      map.flyTo(posicion.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.6 });
    });
    map.fitBounds(ruta.getBounds(), { paddingTopLeft: [36, 100], paddingBottomRight: [36, 230] });
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: { height: 260, borderRadius: quivoRadius.lg, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
