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
  recenterTick: number;
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
  recenterTick,
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
    .map((puntoControl, index) => {
      const [lng, lat] = puntoControl.coord.coordinates;
      const esProximo = puntoControl.id === proximoPuntoControlId;
      const className = esProximo ? 'control-point-marker next' : 'control-point-marker';
      const html = `<div class="${className}">${index + 1}</div>`;
      return `L.marker([${lat}, ${lng}], { icon: L.divIcon({ className: '', html: \`${html}\`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map);`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(50, 38, 180, 0.7); }
      70% { box-shadow: 0 0 0 15px rgba(50, 38, 180, 0); }
      100% { box-shadow: 0 0 0 0 rgba(50, 38, 180, 0); }
    }
    .current-location-marker {
      width: 18px; height: 18px;
      background-color: #3226B4;
      border: 3px solid #FFFFFF;
      border-radius: 50%;
      animation: pulse 2s infinite;
      box-shadow: 0 0 4px rgba(0,0,0,0.3);
      box-sizing: border-box;
    }
    .control-point-marker {
      width: 24px; height: 24px;
      background-color: white;
      border: 2px solid #9191B0;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-family: sans-serif; font-weight: bold; font-size: 11px;
      color: #9191B0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      box-sizing: border-box;
    }
    .control-point-marker.next {
      border-color: #FD9E15;
      background-color: #FD9E15;
      color: white;
    }
    .nav-arrow-marker {
      width: 48px; height: 48px;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.5s ease-out;
    }
    .nav-arrow-marker svg {
      width: 40px; height: 40px;
      fill: #3226B4;
      stroke: white;
      stroke-width: 1.5px;
      filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    var ruta = L.polyline(${JSON.stringify(coordenadasRuta)}, { color: ${JSON.stringify(paquete.linea.color)}, weight: 4 }).addTo(map);
    ${marcadoresParadas}
    ${marcadoresPc}
    var posicion = null;
    var seguimientoActivo = false;
    var currentHeading = 0;
    var prevLatLng = null;

    function getArrowIcon() {
      var html = '<div class="nav-arrow-marker" style="transform: rotate(' + currentHeading + 'deg)">' +
                 '<svg viewBox="0 0 24 24"><path d="M12 2L4 21l8-4 8 4Z"/></svg></div>';
      return L.divIcon({ className: '', html: html, iconSize: [48, 48], iconAnchor: [24, 24] });
    }
    function getDotIcon() {
      return L.divIcon({ className: '', html: '<div class="current-location-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    }
    function updateMarkerIcon() {
      if (!posicion) return;
      posicion.setIcon(seguimientoActivo ? getArrowIcon() : getDotIcon());
    }

    function calcHeading(lat1, lon1, lat2, lon2) {
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
      var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
      var brng = Math.atan2(y, x);
      return ((brng * 180 / Math.PI) + 360) % 360;
    }

    function updateMap(data) {
      if (!data) return;
      if (data.type === 'recenter') {
        if (!posicion) {
          map.fitBounds(ruta.getBounds(), { paddingTopLeft: [36, 100], paddingBottomRight: [36, 230] });
          return;
        }
        seguimientoActivo = true;
        updateMarkerIcon();
        map.flyTo(posicion.getLatLng(), 18, { duration: 0.6 });
        return;
      }
      if (data.type === 'tracking') {
        var didChange = seguimientoActivo !== (data.active === true);
        seguimientoActivo = data.active === true;
        if (didChange) updateMarkerIcon();
        
        if (seguimientoActivo && posicion) {
          map.flyTo(posicion.getLatLng(), 18, { duration: 0.7 });
        } else if (!seguimientoActivo) {
          map.fitBounds(ruta.getBounds(), { paddingTopLeft: [36, 100], paddingBottomRight: [36, 230] });
        }
        return;
      }
      if (data.type !== 'position') return;
      var latlng = [data.lat, data.lng];
      
      if (prevLatLng && (prevLatLng[0] !== latlng[0] || prevLatLng[1] !== latlng[1])) {
        currentHeading = calcHeading(prevLatLng[0], prevLatLng[1], latlng[0], latlng[1]);
      }
      prevLatLng = latlng;

      if (!posicion) {
        posicion = L.marker(latlng, { icon: getDotIcon() }).addTo(map).bindPopup('Tu ubicación');
      } else {
        posicion.setLatLng(latlng);
        if (seguimientoActivo) updateMarkerIcon();
      }
      if (seguimientoActivo) map.flyTo(latlng, 18, { duration: 0.6 });
    }
    function receiveMessage(event) {
      try { updateMap(JSON.parse(event.data)); } catch (_) {}
    }
    document.addEventListener('message', receiveMessage);
    window.addEventListener('message', receiveMessage);
    map.on('dragstart', function () { seguimientoActivo = false; });
    map.fitBounds(ruta.getBounds(), { paddingTopLeft: [36, 100], paddingBottomRight: [36, 230] });
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: { height: 260, borderRadius: quivoRadius.lg, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
