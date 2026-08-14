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
  /** Ruta real siguiendo calles (OSRM), o `null` si no hay ninguna calculada aún o falló
   * — el mapa cae a la línea recta entre la posición actual y la ruta trazada. */
  rutaCalculada: [number, number][] | null;
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
  rutaCalculada,
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

  useEffect(() => {
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'ruta-calculada', coordinates: rutaCalculada }),
    );
  }, [rutaCalculada]);

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
  const proximoPuntoControl = paquete.puntosControl.find((pc) => pc.id === proximoPuntoControlId);
  const proximoPuntoLatLng = proximoPuntoControl
    ? [proximoPuntoControl.coord.coordinates[1], proximoPuntoControl.coord.coordinates[0]]
    : null;

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
    var coordenadasRuta = ${JSON.stringify(coordenadasRuta)};
    var ruta = L.polyline(coordenadasRuta, { color: ${JSON.stringify(paquete.linea.color)}, weight: 4 }).addTo(map);
    ${marcadoresParadas}
    ${marcadoresPc}
    var proximoPuntoLatLng = ${JSON.stringify(proximoPuntoLatLng)};
    var caminoResaltado = null;
    var conectorFueraDeRuta = null;
    var rutaCalculadaCoords = null;
    var posicion = null;
    var seguimientoActivo = false;
    var currentHeading = 0;
    var prevLatLng = null;

    // Índice del punto más cercano de la ruta trazada a una coordenada dada — no es un
    // proyector geométrico real sobre el segmento, pero alcanza para resaltar el tramo
    // pendiente porque coordenadasRuta ya viene con vértices densos (ver geometria de ruta).
    function indiceMasCercano(latlng) {
      var mejorIndice = 0;
      var mejorDistancia = Infinity;
      for (var i = 0; i < coordenadasRuta.length; i++) {
        var dLat = coordenadasRuta[i][0] - latlng[0];
        var dLng = coordenadasRuta[i][1] - latlng[1];
        var distancia = dLat * dLat + dLng * dLng;
        if (distancia < mejorDistancia) {
          mejorDistancia = distancia;
          mejorIndice = i;
        }
      }
      return mejorIndice;
    }

    function actualizarCaminoAlProximoPunto(latlngActual) {
      if (caminoResaltado) {
        map.removeLayer(caminoResaltado);
        caminoResaltado = null;
      }
      if (conectorFueraDeRuta) {
        map.removeLayer(conectorFueraDeRuta);
        conectorFueraDeRuta = null;
      }
      if (!seguimientoActivo || !latlngActual || coordenadasRuta.length < 2) return;

      // Si ya tenemos una ruta real siguiendo calles (OSRM), la dibujamos tal cual y no
      // hace falta el conector recto ni el resaltado del tramo trazado — es más precisa.
      // Estilo sólido naranja intencional: distinto del resaltado punteado de abajo (que es
      // una estimación mientras no hay ruta OSRM todavía), para que se note a simple vista
      // cuál de los dos está activo.
      if (rutaCalculadaCoords && rutaCalculadaCoords.length >= 2) {
        caminoResaltado = L.polyline(rutaCalculadaCoords, { color: '#FD9E15', weight: 6, opacity: 0.9 }).addTo(map);
        caminoResaltado.bringToFront();
        return;
      }

      var desde = indiceMasCercano(latlngActual);
      var puntoMasCercanoEnRuta = coordenadasRuta[desde];

      // Conector punteado: de la posición real del vehículo al punto más cercano de la ruta
      // trazada. Sirve tanto para "cómo llegar al inicio del recorrido" (si todavía no está
      // sobre la ruta) como para "cómo volver" si se desvía en el camino — misma lógica,
      // se recalcula en cada actualización de posición.
      var dLat = latlngActual[0] - puntoMasCercanoEnRuta[0];
      var dLng = latlngActual[1] - puntoMasCercanoEnRuta[1];
      var fueraDeRuta = Math.sqrt(dLat * dLat + dLng * dLng) > 0.00005; // ~5 m
      if (fueraDeRuta) {
        conectorFueraDeRuta = L.polyline([latlngActual, puntoMasCercanoEnRuta], {
          color: '#C53B4A',
          weight: 4,
          dashArray: '8 8',
        }).addTo(map);
      }

      // Preferimos el próximo punto de control como destino del tramo resaltado; si la ruta
      // no tiene puntos de control cargados, igual mostramos cómo llegar trazando hasta el
      // final del recorrido con las coordenadas reales de la ruta.
      var destino = proximoPuntoLatLng || coordenadasRuta[coordenadasRuta.length - 1];
      var hasta = indiceMasCercano(destino);
      var inicio = Math.min(desde, hasta);
      var fin = Math.max(desde, hasta);
      var segmento = coordenadasRuta.slice(inicio, fin + 1);
      if (segmento.length < 2) return;
      // Estimación (todavía sin ruta real de OSRM): gris punteado, para no confundirla con
      // el trazado sólido naranja de arriba, que sí sigue calles reales.
      caminoResaltado = L.polyline(segmento, {
        color: '#9191B0',
        weight: 5,
        opacity: 0.85,
        dashArray: '2 10',
      }).addTo(map);
      caminoResaltado.bringToFront();
    }

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
      if (data.type === 'ruta-calculada') {
        rutaCalculadaCoords = Array.isArray(data.coordinates) && data.coordinates.length >= 2
          ? data.coordinates
          : null;
        actualizarCaminoAlProximoPunto(posicion ? [posicion.getLatLng().lat, posicion.getLatLng().lng] : null);
        return;
      }
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
        actualizarCaminoAlProximoPunto(posicion ? [posicion.getLatLng().lat, posicion.getLatLng().lng] : null);
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
      actualizarCaminoAlProximoPunto(latlng);
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
