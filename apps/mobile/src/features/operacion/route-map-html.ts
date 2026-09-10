import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { LEAFLET_CSS_INLINE, LEAFLET_JS_INLINE } from './leaflet-inline.generated';

/**
 * Builder puro del HTML que corre dentro del WebView del mapa de navegación
 * (`route-map-view.tsx`). Vive separado del componente React para poder testearlo con
 * `vitest` sin necesidad de montar `react-native-webview` — ver `route-map-html.test.ts`.
 *
 * Entrega 25 (plan post-piloto 2026-09-09): la navegación en ruta no puede depender de la
 * red. Antes este HTML traía Leaflet desde `https://unpkg.com/...` — sin cobertura, ese
 * `<script>` nunca cargaba y el mapa quedaba en pantalla gris (el peor caso posible: un chofer
 * manejando sin ninguna referencia visual). Ahora `leaflet.js`/`leaflet.css` viajan inline,
 * embebidos en el bundle JS de la app (ver `leaflet-inline.generated.ts`), así que Leaflet
 * arranca siempre, con o sin red.
 *
 * Lo único que sigue dependiendo de la red son los tiles de OpenStreetMap (imágenes de calles
 * de fondo) — y ahí el fallback es la capa base `#F4F6F8` + la lógica de `tileerror` más abajo:
 * si los tiles no cargan, el mapa se queda sin ellos pero la polyline de la ruta, los puntos de
 * control y la posición del vehículo siguen dibujados sobre un fondo liso legible. La
 * navegación funcional se conserva — el chofer ve dónde está respecto de su ruta aunque no vea
 * las calles.
 */

/** Coordenada Leaflet, siempre `[lat, lng]` — a diferencia de GeoJSON, que es `[lng, lat]`
 * (RFC 7946). Todo el resto del código de la app (geofence, haversine, PaqueteDia) trabaja en
 * GeoJSON; esta es la ÚNICA frontera donde se convierte a Leaflet, justo antes de mandarlo al
 * WebView. Mantenerla como la única frontera es lo que evita el cruce de formatos que sospechaba
 * el síntoma 10 del piloto ("la ruta se movió sobre las casas, 2 segundos") — ver auditoría en
 * el handoff de esta entrega. */
export type CoordenadaLeaflet = [lat: number, lng: number];

/** Convierte un array de coordenadas GeoJSON `[lng, lat]` a Leaflet `[lat, lng]`. Pura y
 * testeada aparte (`route-map-html.test.ts`) porque un swap de orden acá es exactamente el tipo
 * de bug silencioso que produce el síntoma "la ruta aparece corrida sobre las casas": no tira
 * excepción, solo dibuja mal. */
export function convertirGeoJsonALatLng(coordenadas: readonly [number, number][]): CoordenadaLeaflet[] {
  return coordenadas.map(([lng, lat]) => [lat, lng]);
}

export interface PuntoControlMapaHtml {
  id: string;
  orden: number;
  lat: number;
  lng: number;
}

/** Opciones de {@link crearControladorTiles}. */
export interface OpcionesControladorTiles {
  /** Debe ser EXACTAMENTE el mismo string que se le pasa a `L.tileLayer(..., { errorTileUrl })`. */
  errorTileUrl: string;
  timeoutMs: number;
  /** Se invoca una sola vez cuando se decide que no hay cobertura y hay que sacar la capa. */
  onRemoverCapa: () => void;
}

export interface ControladorTiles {
  /** Notificar un `tileload` de Leaflet, pasando el `src` del `<img>` que cargó. */
  onTileLoad: (tileSrc: string | null | undefined) => void;
  /** Notificar un `tileerror` de Leaflet (no importa cuál tile — solo que falló uno). */
  onTileError: () => void;
  /** Reintentar: vuelve a habilitar la detección como si el mapa arrancara de cero. Se usa
   * cuando puede haber vuelto la red (ver `intentarRecuperarTiles` en el HTML generado). */
  reintentar: () => void;
  /** true si ya se decidió remover la capa por falta de cobertura sostenida. */
  estaRemovida: () => boolean;
}

/**
 * Máquina de estados PURA (sin Leaflet, sin DOM) que decide cuándo la capa de tiles de
 * OpenStreetMap debe darse por perdida y removerse del mapa.
 *
 * Por qué existe separada de `construirHtml`: el code-review de la Entrega 25 encontró que el
 * fallback documentado ("sin tiles a los 4s se remueve la capa") **no se ejecutaba nunca**.
 * La causa: Leaflet, cuando un tile real falla, carga el `errorTileUrl` (un GIF transparente,
 * más abajo) como reemplazo — y ESO dispara el evento `tileload` igual que un tile real, porque
 * para Leaflet "cargó una imagen" no distingue cuál. El handler viejo de `tileload` marcaba
 * `tilesCargados = true` con cualquier carga, así que el primer tile fallido cancelaba el
 * timeout y la capa nunca se removía (invisible en pantalla porque el GIF es transparente sobre
 * el fondo liso, pero el mecanismo quedaba muerto y seguía reintentando tiles reales para
 * siempre en cada actualización de GPS).
 *
 * El fix: `onTileLoad` **ignora explícitamente** cualquier carga cuyo `src` sea el propio
 * `errorTileUrl` — esa carga es el placeholder de un fallo, nunca cuenta como "hay cobertura".
 * Se prefirió este filtro sobre sacar `errorTileUrl` y apoyarse solo en `tileerror`
 * (alternativa considerada) porque `errorTileUrl` sigue siendo necesario por su motivo
 * original: sin él, Android WebView dibuja el ícono nativo de "imagen rota" en cada tile
 * fallido mientras no hay red, en vez de quedar transparente sobre el fondo liso `#F4F6F8`.
 *
 * Esta función se serializa con `.toString()` dentro de `construirHtml` y su código fuente se
 * embebe tal cual en el `<script>` del WebView (ver más abajo) — así el test de
 * `route-map-html.test.ts` ejercita el MISMO código que corre en el mapa real, no una
 * reimplementación en paralelo que podría divergir con el tiempo. Por eso está escrita con
 * `function`/`var` en vez de arrow functions o destructuring: para que el texto embebido sea
 * JS plano y no dependa de qué target de TS/Babel compiló este archivo.
 */
export function crearControladorTiles(opciones: OpcionesControladorTiles): ControladorTiles {
  var cargoTileReal = false;
  var timeoutId: ReturnType<typeof setTimeout> | null = null;
  var removida = false;

  function onTileLoad(tileSrc: string | null | undefined) {
    if (removida) return;
    if (tileSrc === opciones.errorTileUrl) return; // el GIF de error NUNCA cuenta como carga real
    cargoTileReal = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function onTileError() {
    if (removida || cargoTileReal || timeoutId !== null) return;
    // Colchón antes de sacar la capa (no al primer error): un tileerror aislado con red
    // intermitente no debe tirar los tiles para toda la sesión del mapa, solo la ausencia
    // sostenida de éxito.
    timeoutId = setTimeout(function () {
      timeoutId = null;
      if (!cargoTileReal) {
        removida = true;
        opciones.onRemoverCapa();
      }
    }, opciones.timeoutMs);
  }

  function reintentar() {
    removida = false;
    cargoTileReal = false;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function estaRemovida() {
    return removida;
  }

  return {
    onTileLoad: onTileLoad,
    onTileError: onTileError,
    reintentar: reintentar,
    estaRemovida: estaRemovida,
  };
}

export function construirHtml(
  paquete: PaqueteDia,
  _vehiculo: ContextoOperativoMovil['vehiculo'],
  proximoPuntoControlId: string | null,
): string {
  const coordenadasRuta = convertirGeoJsonALatLng(paquete.ruta.geometria.coordinates);
  const proximoPuntoControl = paquete.puntosControl.find((pc) => pc.id === proximoPuntoControlId);
  const proximoPuntoLatLng: CoordenadaLeaflet | null = proximoPuntoControl
    ? [proximoPuntoControl.coord.coordinates[1], proximoPuntoControl.coord.coordinates[0]]
    : null;

  const puntosControlData: PuntoControlMapaHtml[] = paquete.puntosControl.map((pc, idx) => ({
    id: pc.id,
    orden: idx + 1,
    lat: pc.coord.coordinates[1],
    lng: pc.coord.coordinates[0],
  }));

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS_INLINE}</style>
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
  <script>${LEAFLET_JS_INLINE}</script>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false });

    var coordenadasRuta = ${JSON.stringify(coordenadasRuta)};
    // Fija un view inicial ANTES de agregar tiles/polyline/marcadores: L.map() de arriba se crea
    // sin center/zoom (no los tenemos hasta convertir la ruta), y Leaflet posiciona cada capa
    // que se agrega usando el zoom/centro que el mapa tenga EN ESE MOMENTO. Agregar capas antes
    // de tener un view definido las proyecta con zoom indefinido — se renderizan mal ubicadas
    // hasta que algo (acá, el fitBounds del final) fuerza un viewreset que las reacomoda. Ese
    // "mal ubicadas y después saltan a su lugar" es exactamente la forma del síntoma 10 del
    // piloto ("la ruta se movió sobre las casas, 2 segundos"). Por eso este setView corre ANTES
    // de tileLayer.addTo/L.polyline/L.marker más abajo, no después.
    map.setView(coordenadasRuta.length > 0 ? coordenadasRuta[0] : [0, 0], 15);

    // Tiles de OpenStreetMap: son el único recurso de este mapa que sigue viniendo de la red
    // (bundlear un mundo entero de tiles no es viable). Con cobertura, aparecen igual que
    // siempre encima del fondo liso. Sin cobertura, el fondo liso (#F4F6F8, seteado arriba en
    // html/body/#map) YA es la navegación funcional: la polyline, los puntos de control y la
    // posición del vehículo se dibujan igual, sin esperar ningún tile.
    //
    // AVISO DE RIESGO (no resuelto en esta entrega, ver plan Entrega 25): tile.openstreetmap.org
    // es el servidor de demostración de OSM — su política de uso no permite consumo intensivo
    // desde apps en producción con flota real. Con más de un puñado de vehículos hace falta un
    // proveedor de tiles propio o pago (p. ej. MapTiler, Mapbox, o un tile server propio).
    var TILE_ERROR_TIMEOUT_MS = 4000;
    // Pixel transparente 1x1: evita que Android WebView dibuje el ícono de "imagen rota" en
    // cada mosaico que falla mientras no hay red — sin esto, un mapa sin cobertura se llena
    // de cuadrados rotos parpadeando en cada reintento en vez de quedar en el fondo liso.
    var ERROR_TILE_URL =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';
    var tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      errorTileUrl: ERROR_TILE_URL
    });
    tileLayer.addTo(map);

    // PUNTO DE EXTENSIÓN — Entrega 27 (cache-first de tiles, depende de esta entrega):
    // la ruta del día es fija y conocida antes de salir, así que el bounding box completo se
    // puede pre-descargar al bajar el paquete del día y servir desde un tile cache local (p.
    // ej. un CachingTileLayer sobre expo-file-system, o un plugin tipo leaflet.offline) en vez
    // de depender del fetch en vivo de acá abajo. Cuando eso exista, esta capa pasa a ser
    // solamente el fallback de "no lo tenía cacheado".

    // crearControladorTiles (definida arriba en route-map-html.ts, pura y testeada en
    // route-map-html.test.ts) se embebe acá tal cual vía .toString() — es la MISMA función que
    // corre en el test, no una reimplementación paralela.
    ${crearControladorTiles.toString()}

    var controladorTiles = crearControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TILE_ERROR_TIMEOUT_MS,
      onRemoverCapa: function () { map.removeLayer(tileLayer); }
    });
    tileLayer.on('tileload', function (e) {
      controladorTiles.onTileLoad(e && e.tile ? e.tile.src : null);
    });
    tileLayer.on('tileerror', function () {
      controladorTiles.onTileError();
    });

    // Reintento de red apoyado en el heartbeat que YA existe (el GPS), no en 'online'/'offline':
    // esos eventos del navegador son notoriamente poco confiables en WKWebView (iOS) y no
    // conviene depender de ellos para algo tan visible como el mapa. Cada actualización de
    // posición (llega cada vez que el chofer se movió ~15m, ver route-map-view.tsx) es una
    // oportunidad barata para reintentar: si la capa fue removida, se vuelve a agregar y se
    // deja que tileload/tileerror decidan otra vez en TILE_ERROR_TIMEOUT_MS si esta vez hay
    // señal. REINTENTO_MIN_INTERVALO_MS evita reintentar en cada GPS individual mientras se
    // sigue sin cobertura por un rato largo.
    var REINTENTO_MIN_INTERVALO_MS = 30000;
    var ultimoReintentoTilesMs = 0;
    function intentarRecuperarTiles() {
      if (!controladorTiles.estaRemovida()) return;
      var ahora = Date.now();
      if (ahora - ultimoReintentoTilesMs < REINTENTO_MIN_INTERVALO_MS) return;
      ultimoReintentoTilesMs = ahora;
      controladorTiles.reintentar();
      tileLayer.addTo(map);
    }

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
        intentarRecuperarTiles();

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
    // El view inicial ya se fijó arriba (map.setView, antes de agregar tiles/polyline/
    // marcadores) — este fitBounds solo ajusta esa vista provisoria a los límites reales de la
    // ruta. Corre de forma síncrona apenas el script se ejecuta (inmediato: ya no espera ningún
    // <script src> remoto), así que el ajuste es un solo frame de JS local, no una espera de red.
    map.fitBounds(ruta.getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 180] });
  </script>
</body>
</html>`;
}
