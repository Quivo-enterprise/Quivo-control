import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { quivoRadius } from '../../shared/theme/quivo-theme';

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

function construirHtml(
  paquete: PaqueteDia,
  _vehiculo: ContextoOperativoMovil['vehiculo'],
  proximoPuntoControlId: string | null,
): string {
  const coordenadasRuta = paquete.ruta.geometria.coordinates.map(([lng, lat]) => [lat, lng]);
  const proximoPuntoControl = paquete.puntosControl.find((pc) => pc.id === proximoPuntoControlId);
  const proximoPuntoLatLng = proximoPuntoControl
    ? [proximoPuntoControl.coord.coordinates[1], proximoPuntoControl.coord.coordinates[0]]
    : null;

  const puntosControlData = paquete.puntosControl.map((pc, idx) => ({
    id: pc.id,
    orden: idx + 1,
    lat: pc.coord.coordinates[1],
    lng: pc.coord.coordinates[0],
  }));

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background-color: #F4F6F8; }
    
    .control-point-marker {
      width: 24px;
      height: 24px;
      background-color: #3127B1;
      border: 2px solid #FFFFFF;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-weight: 700;
      font-size: 11.5px;
      color: #FFFFFF;
      box-shadow: 0 2px 5px rgba(0,0,0,0.35);
      box-sizing: border-box;
      transition: background-color 0.3s ease;
    }
    .control-point-marker.completed {
      background-color: #22C55E;
    }

    .nav-arrow-container {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
    }
    .nav-arrow-svg {
      width: 24px;
      height: 24px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    var coordenadasRuta = ${JSON.stringify(coordenadasRuta)};
    var COLOR_ESPERA = '#1E1B4B';
    var COLOR_LINEA = '#FE9B0B';

    var ruta = L.polyline(coordenadasRuta, {
      color: COLOR_ESPERA,
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    var puntosControlData = ${JSON.stringify(puntosControlData)};
    var proximoPuntoIdActual = ${JSON.stringify(proximoPuntoControlId)};
    var pcMarkers = [];

    function renderizarPuntosControl() {
      // Limpiar marcadores existentes
      pcMarkers.forEach(function(m) { map.removeLayer(m); });
      pcMarkers = [];

      var proximoIdx = -1;
      if (proximoPuntoIdActual) {
        for (var k = 0; k < puntosControlData.length; k++) {
          if (puntosControlData[k].id === proximoPuntoIdActual) {
            proximoIdx = k;
            break;
          }
        }
      }

      puntosControlData.forEach(function(pc, idx) {
        var isPassed = seguimientoActivo && proximoIdx > 0 && idx < proximoIdx;
        var className = isPassed ? 'control-point-marker completed' : 'control-point-marker';
        var html = '<div class="' + className + '">' + pc.orden + '</div>';
        var marker = L.marker([pc.lat, pc.lng], {
          icon: L.divIcon({
            className: '',
            html: html,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          })
        }).addTo(map);
        pcMarkers.push(marker);
      });
    }

    var proximoPuntoLatLng = ${JSON.stringify(proximoPuntoLatLng)};
    var caminoResaltado = null;
    var rutaCalculadaCoords = null;
    var posicion = null;
    var seguimientoActivo = false;
    var currentHeading = 0;
    var prevLatLng = null;

    renderizarPuntosControl();

    function getArrowIcon(heading) {
      var html = '<div class="nav-arrow-container" style="transform: rotate(' + heading + 'deg)">' +
                 '<svg class="nav-arrow-svg" viewBox="0 0 24 24">' +
                 '<path d="M12 2L4 20.5l8-3.8 8 3.8Z" fill="#3127B1" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>' +
                 '</svg></div>';
      return L.divIcon({ className: '', html: html, iconSize: [28, 28], iconAnchor: [14, 14] });
    }

    function calcHeading(lat1, lon1, lat2, lon2) {
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
      var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
      var brng = Math.atan2(y, x);
      return ((brng * 180 / Math.PI) + 360) % 360;
    }

    function actualizarCaminoAlProximoPunto() {
      if (caminoResaltado) {
        map.removeLayer(caminoResaltado);
        caminoResaltado = null;
      }
      if (!seguimientoActivo || !rutaCalculadaCoords || rutaCalculadaCoords.length < 2) return;

      caminoResaltado = L.polyline(rutaCalculadaCoords, {
        color: COLOR_LINEA,
        weight: 5.5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      caminoResaltado.bringToFront();
    }

    function updateMap(data) {
      if (!data) return;

      if (data.type === 'ruta-calculada') {
        rutaCalculadaCoords = Array.isArray(data.coordinates) && data.coordinates.length >= 2
          ? data.coordinates
          : null;
        actualizarCaminoAlProximoPunto();
        return;
      }

      if (data.type === 'recenter') {
        if (!posicion) {
          map.fitBounds(ruta.getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 180] });
          return;
        }
        seguimientoActivo = true;
        map.flyTo(posicion.getLatLng(), 17, { duration: 0.6 });
        return;
      }

      if (data.type === 'tracking') {
        var didChange = seguimientoActivo !== (data.active === true);
        seguimientoActivo = data.active === true;
        if (data.proximoPuntoControlId) {
          proximoPuntoIdActual = data.proximoPuntoControlId;
        }

        // Color de la ruta en mapa: En espera (#1E1B4B) vs En línea (#FE9B0B)
        ruta.setStyle({
          color: seguimientoActivo ? COLOR_LINEA : COLOR_ESPERA,
          weight: seguimientoActivo ? 5.5 : 4.5
        });

        renderizarPuntosControl();

        if (posicion) {
          posicion.setIcon(getArrowIcon(currentHeading));
        }

        if (seguimientoActivo && posicion) {
          map.flyTo(posicion.getLatLng(), 17, { duration: 0.7 });
        } else if (!seguimientoActivo) {
          map.fitBounds(ruta.getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 180] });
        }
        actualizarCaminoAlProximoPunto();
        return;
      }

      if (data.type === 'position') {
        var latlng = [data.lat, data.lng];

        if (prevLatLng && (prevLatLng[0] !== latlng[0] || prevLatLng[1] !== latlng[1])) {
          currentHeading = calcHeading(prevLatLng[0], prevLatLng[1], latlng[0], latlng[1]);
        }
        prevLatLng = latlng;

        if (!posicion) {
          posicion = L.marker(latlng, { icon: getArrowIcon(currentHeading) }).addTo(map);
        } else {
          posicion.setLatLng(latlng);
          posicion.setIcon(getArrowIcon(currentHeading));
        }

        if (seguimientoActivo) {
          map.flyTo(latlng, 17, { duration: 0.5 });
        }
        actualizarCaminoAlProximoPunto();
      }
    }

    function receiveMessage(event) {
      try { updateMap(JSON.parse(event.data)); } catch (_) {}
    }
    document.addEventListener('message', receiveMessage);
    window.addEventListener('message', receiveMessage);
    map.on('dragstart', function () { seguimientoActivo = false; });
    map.fitBounds(ruta.getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 180] });
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: { height: 260, borderRadius: quivoRadius.lg, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
