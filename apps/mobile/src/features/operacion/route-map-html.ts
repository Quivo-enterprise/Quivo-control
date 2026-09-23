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
 * de fondo) — y ahí el fallback YA está resuelto sin tocar la capa de tiles: el `errorTileUrl`
 * (GIF transparente, ver más abajo) evita el ícono de "imagen rota" tile por tile, el fondo liso
 * `#F4F6F8` (seteado en html/body/#map) cubre el resto del lienzo, y la polyline de la ruta, los
 * puntos de control y la posición del vehículo se dibujan siempre, tile o no tile. La capa de
 * tiles NUNCA se retira del mapa — ver `CONTROLADOR_TILES_JS_SOURCE` más abajo para el porqué (un
 * mecanismo anterior que la retiraba a los 4s de fallos sostenidos terminaba borrando tiles que sí
 * habían cargado, exactamente en el caso normal con buena cobertura). Lo único que hace el
 * controlador de tiles es reintentar, cada tanto, los tiles puntuales que fallaron — nunca toca
 * los que ya están bien.
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

/** Opciones de `crearControladorTiles` (ver `CONTROLADOR_TILES_JS_SOURCE`) — tipa el objeto que
 * se le pasa a la función una vez evaluada en el WebView o en `new Function` en los tests. */
export interface OpcionesControladorTiles {
  /** Debe ser EXACTAMENTE el mismo string que se le pasa a `L.tileLayer(..., { errorTileUrl })`.
   * Sirve para distinguir el `tileload` del GIF placeholder (no es una carga real) del de un tile
   * de verdad. */
  errorTileUrl: string;
  /** Cada cuánto se reintentan, en bloque, TODOS los tiles fallidos pendientes. El temporizador
   * (un único `setInterval` compartido) solo corre mientras haya al menos un tile pendiente. */
  reintentoIntervaloMs: number;
  /** Dado el `coords` que Leaflet manda en el evento `tileerror`, devuelve la URL original del
   * tile. Hace falta recalcularla porque, para cuando llega `tileerror`, Leaflet YA reemplazó
   * `tile.src` por `errorTileUrl` (ver el comentario grande sobre `CONTROLADOR_TILES_JS_SOURCE`
   * más abajo) — el `<img>` fallido ya no tiene la URL real en ningún atributo. Se invoca UNA sola
   * vez por tile, dentro de `onTileError` — nunca en cada reintento — precisamente porque el valor
   * que devuelve (típicamente `tileLayer.getTileUrl(coords)`) usa el zoom ACTUAL de la capa, no
   * `coords.z`; recalcularlo más tarde, en un reintento, podría mezclar el zoom nuevo con las x/y
   * viejas de `coords`. Ver el comentario grande sobre `urlBase` en `CONTROLADOR_TILES_JS_SOURCE`. */
  obtenerUrlOriginal: (coords: unknown) => string;
  /** true si el `<img>` del tile fallido sigue montado en el DOM del mapa. Leaflet lo desmonta
   * (poda) cuando el tile queda fuera de la vista por un pan/zoom — reintentar un tile podado
   * sería re-descargar algo que ya no se va a dibujar. */
  tileSigueEnMapa: (tile: unknown) => boolean;
}

export interface ControladorTiles {
  /** Notificar un `tileload` de Leaflet: `tile` es el `<img>` que disparó el evento, `tileSrc` su
   * `src` en ese momento. Si el tile estaba en la lista de pendientes, sale de ahí. */
  onTileLoad: (tile: unknown, tileSrc: string | null | undefined) => void;
  /** Notificar un `tileerror` de Leaflet: `tile` es el `<img>` que falló, `coords` el `{x,y,z}`
   * que Leaflet manda en el evento (necesario para recalcular la URL original al reintentar). */
  onTileError: (tile: unknown, coords: unknown) => void;
}

/**
 * Código fuente LITERAL (JS plano, ES5) del controlador que reintenta, en bloque y cada tanto,
 * los tiles de OpenStreetMap que fallaron — SIN retirar nunca la capa de tiles del mapa. Es un
 * STRING, no una función TypeScript — y esa diferencia es justamente el fix del Hallazgo 1 del
 * code-review de esta entrega (release real, no un caso de laboratorio). Ver el bloque de
 * comentario largo más abajo, antes de `CONTROLADOR_TILES_JS_SOURCE`, para el detalle completo de
 * por qué.
 *
 * Versión anterior (revisada y descartada): este controlador retiraba la capa completa de tiles
 * (`map.removeLayer(tileLayer)`) a los 4s de no ver ningún `tileload` real tras un `tileerror`.
 * El code-review posterior encontró que eso EMPEORABA el caso normal: con cobertura completa, si
 * fallaba el último tile pendiente (un timeout suelto, un 429 del servidor de demo de OSM), a los
 * 4s se borraban TODOS los tiles que sí habían cargado — pantalla lisa con red funcionando. En
 * redes lentas, el primer error armaba el timer y la retirada podía abortar tiles que estaban
 * cargando bien. El requisito real ("sin red, nunca pantalla gris") ya lo cumplen el
 * `errorTileUrl`, el fondo liso `#F4F6F8` y la polyline/puntos de control/posición, que se dibujan
 * siempre — retirar la capa no sumaba nada y solo agregaba riesgo. Por eso ahora la capa queda
 * SIEMPRE montada y lo único que hace este controlador es reintentar, tile por tile, los que
 * fallaron — Leaflet no reintenta un tile con `tileerror` por su cuenta.
 *
 * Este texto se ejecuta en DOS lugares y TIENE QUE SER exactamente el mismo en ambos:
 *   1. Interpolado tal cual dentro del `<script>` del HTML — ver `construirHtml` más abajo.
 *   2. Evaluado con `new Function(...)` en `route-map-html.test.ts` para poder testear el
 *      comportamiento real sin Leaflet ni WebView (`vi.useFakeTimers()` sobre el resultado).
 * Como es el mismo string en los dos casos, no hay forma de que el comportamiento testeado
 * diverja del que corre en el mapa real — a diferencia de lo que pasaba antes con `.toString()`.
 *
 * ============================================================================================
 * POR QUÉ NUNCA `Function.prototype.toString()` PARA INYECTAR CÓDIGO EN EL WEBVIEW
 * (bug real verificado en el bundle de release de esta entrega — Hallazgo 1 del code-review):
 *
 * Antes, este archivo tenía `crearControladorTiles` como función TypeScript normal, y
 * `construirHtml` la embebía en el HTML con `${crearControladorTiles.toString()}`. Esto se ve
 * inofensivo en dev/tests porque ahí `.toString()` sí devuelve el código fuente legible. Pero
 * se rompe en dos capas distintas de un build de release real, cualquiera de las dos sola ya
 * es fatal:
 *
 *   1. MINIFICADOR DE METRO (renombre de identificadores): en release, Metro minifica y
 *      renombra símbolos de nivel de módulo — `crearControladorTiles` pasa a ser, por ejemplo,
 *      `s`. `Function.prototype.toString()` de la función YA renombrada en memoria devuelve el
 *      código CON el nombre nuevo (`function s(n){var e=!1,...}`), pero el HTML seguía
 *      invocando `crearControladorTiles({...})` por el nombre literal viejo, escrito a mano más
 *      abajo en este archivo. Resultado: el WebView define `s` y ejecuta
 *      `crearControladorTiles(...)` → `ReferenceError: crearControladorTiles is not defined`.
 *      Ese throw CORTA TODO el resto del `<script>` (no solo el controlador de tiles): nunca se
 *      dibuja la polyline de la ruta ni los puntos de control ni la posición del vehículo, no
 *      se registran los listeners de `message` (`document.addEventListener` / `window
 *      .addEventListener`) y `map.fitBounds` del final tampoco corre. Pantalla gris — peor que
 *      `main`, porque ni siquiera el fallback documentado llega a ejecutar.
 *      Verificado contra un bundle real: `npx expo export --platform android --no-bytecode`
 *      produce `${s.toString()}` seguido de `function s(n){...}` y CERO ocurrencias de
 *      `function crearControladorTiles` en todo el archivo exportado.
 *
 *   2. BYTECODE DE HERMES: aunque el paso 1 no existiera (nombre preservado), Hermes compila el
 *      JS de la app a bytecode antes de empaquetarlo. `Function.prototype.toString()` de una
 *      función ya compilada a bytecode NO devuelve el código fuente — devuelve un placeholder
 *      opaco tipo `function s(a0) { [bytecode] }`. Ese texto tampoco sería JS ejecutable si se
 *      insertara en el HTML, sin importar qué nombre tuviera.
 *
 * Los tests de este archivo con `vitest` no detectaban nada de esto porque vitest corre el
 * código de test SIN pasar por el minificador de Metro ni por Hermes — ahí `.toString()`
 * siempre devolvía el código fuente real, con el nombre real. El bug era 100% invisible en
 * dev/test y solo se manifestaba en un APK/AAB de release de verdad. Por eso, de ahora en más,
 * el controlador viaja como STRING literal escrito a mano — nunca como `.toString()` de una
 * función que el bundler puede haber transformado. Un string literal es opaco para el
 * minificador (no le toca el contenido de texto, solo identificadores del AST), así que el
 * nombre `crearControladorTiles` dentro de este string llega intacto al bundle de release sin
 * importar qué haga Metro con los símbolos "de verdad" del módulo.
 * ============================================================================================
 *
 * Por qué además sigue escrito en ES5 (`function`/`var`, sin arrow functions/destructuring/
 * template strings propios): para que el texto sea JS plano interpretable por cualquier motor
 * de WebView sin depender de qué target de TS/Babel compiló este archivo — y para que `new
 * Function` en los tests no dependa de ninguna transformación previa.
 */
export const CONTROLADOR_TILES_JS_SOURCE = `
function crearControladorTiles(opciones) {
  // Lista de tiles fallidos pendientes de reintento: { tile: <img>, coords: {x,y,z}, urlBase }.
  // Un mismo <img> nunca queda duplicado acá (ver onTileError) — mientras siga fallando, sigue
  // siendo la MISMA entrada, no una nueva por cada tileerror sucesivo.
  //
  // POR QUÉ 'urlBase' SE CALCULA UNA SOLA VEZ, EN onTileError, Y NUNCA EN CADA REINTENTO (bug real
  // de zoom mezclado, reportado por la verificación de esta entrega):
  // 'opciones.obtenerUrlOriginal' típicamente delega en 'tileLayer.getTileUrl(coords)' de Leaflet.
  // En Leaflet 1.9.4, esa función arma la URL con el zoom ACTUAL DE LA CAPA (this._getZoomForUrl()),
  // no con 'coords.z' — a pesar de recibir 'coords' como argumento, IGNORA su 'z'. El mecanismo
  // anterior de este controlador guardaba solo '{ tile, coords }' en 'pendientes' y volvía a
  // invocar 'obtenerUrlOriginal(coords)' recién en cada tick de 'reintentarPendientes' (hasta
  // reintentoIntervaloMs = 30s después del fallo). Si el mapa cambiaba de zoom en esa ventana (el
  // chofer hace zoom in/out mientras un tile de otro zoom sigue pendiente), el reintento
  // combinaba las x/y viejas de 'coords' con el zoom NUEVO de la capa — un mosaico de una región
  // distinta a la que se pidió, dibujado como si fuera el tile correcto. La solución: calcular y
  // guardar la URL completa ('urlBase') UNA sola vez, en onTileError, en el mismo instante en que
  // el zoom de la capa todavía coincide con 'coords.z' (el fallo recién ocurrió a ESE zoom). Los
  // reintentos posteriores reusan ese 'urlBase' congelado (solo le agregan el cache-busting), sin
  // importar cuánto tiempo pase ni cuántas veces cambie el zoom mientras el tile sigue pendiente.
  var pendientes = [];
  // Un único setInterval compartido para todos los tiles pendientes (no uno por tile): más barato
  // y evita reintentos desincronizados. Solo existe mientras haya al menos un pendiente — arranca
  // en el primer tileerror y se apaga solo cuando la lista queda vacía (ver detenerTimerSiVacio).
  var intervalId = null;

  function indiceDe(tile) {
    for (var i = 0; i < pendientes.length; i++) {
      if (pendientes[i].tile === tile) return i;
    }
    return -1;
  }

  function detenerTimerSiVacio() {
    if (pendientes.length === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function reintentarPendientes() {
    // Recorre una copia porque la lista muta durante el loop (los tiles podados se descartan acá
    // mismo, sin esperar al próximo tileload/tileerror que nunca va a llegar para un <img> que ya
    // no está en el DOM).
    var siguientes = [];
    for (var i = 0; i < pendientes.length; i++) {
      var entrada = pendientes[i];
      // El tile salió de la vista por un pan/zoom (Leaflet lo podó del DOM): reintentar algo que
      // ya no se va a dibujar sería tráfico de red desperdiciado. Se descarta sin reintentar.
      if (!opciones.tileSigueEnMapa(entrada.tile)) continue;
      // 'urlBase' es la URL calculada en onTileError, con el zoom que tenía la capa cuando ESTE
      // tile falló — NUNCA se vuelve a invocar 'obtenerUrlOriginal' acá (ver el comentario grande
      // sobre 'urlBase' más arriba): si el zoom de la capa cambió desde entonces, recalcular la
      // URL ahora mezclaría el zoom nuevo con las x/y viejas de 'entrada.coords'.
      var url = entrada.urlBase;
      // Cache-busting: sin esto el navegador puede resolver el reintento contra la misma
      // respuesta fallida que tiene cacheada en vez de golpear la red de nuevo.
      url += (url.indexOf('?') === -1 ? '?' : '&') + '_retry=' + Date.now();
      // Asignar .src de nuevo dispara una carga real del <img> — Leaflet ya le tiene enganchados
      // sus propios onload/onerror (los que a su vez disparan 'tileload'/'tileerror'), así que si
      // esta carga funciona, onTileLoad de acá abajo se entera solo y saca la entrada de la lista;
      // si vuelve a fallar, onTileError la deja donde está (mismo tile, no se duplica) para el
      // próximo tick. Deliberadamente NO se usa tileLayer.redraw(): eso recarga TODOS los tiles
      // del mapa (parpadeo visible) por reintentar unos pocos.
      entrada.tile.src = url;
      siguientes.push(entrada);
    }
    pendientes = siguientes;
    detenerTimerSiVacio();
  }

  function onTileLoad(tile, tileSrc) {
    if (tileSrc === opciones.errorTileUrl) return; // el GIF de error NUNCA cuenta como carga real
    var idx = indiceDe(tile);
    if (idx !== -1) {
      pendientes.splice(idx, 1);
      detenerTimerSiVacio();
    }
  }

  function onTileError(tile, coords) {
    if (indiceDe(tile) !== -1) return; // ya está pendiente — no arma un segundo reintento en paralelo
    // 'urlBase' se calcula ACÁ, apenas falla el tile, y no en 'reintentarPendientes' — ver el
    // comentario grande sobre 'urlBase' arriba de 'pendientes' para el porqué (zoom mezclado).
    pendientes.push({ tile: tile, coords: coords, urlBase: opciones.obtenerUrlOriginal(coords) });
    if (intervalId === null) {
      intervalId = setInterval(reintentarPendientes, opciones.reintentoIntervaloMs);
    }
  }

  return {
    onTileLoad: onTileLoad,
    onTileError: onTileError
  };
}
`;

/**
 * Entrega 31b (defecto post-piloto, 2026-09-10): `construirHtml` YA NO recibe
 * `proximoPuntoControlId`. Antes lo recibía y lo horneaba dentro del `<script>` generado
 * (`var proximoPuntoIdActual = ${JSON.stringify(proximoPuntoControlId)}`), y como
 * `route-map-view.tsx` lo tenía en las dependencias del `useMemo` del HTML, cada vez que el
 * chofer pasaba un punto de control (cambia el próximo) el `useMemo` recalculaba un HTML
 * DISTINTO — mismo string salvo ese único valor — y React le pasaba a la WebView un `source.html`
 * nuevo, forzando una recarga COMPLETA del documento: Leaflet se reinstancia desde cero
 * (`L.map(...)` de nuevo), se pierden el marcador de posición y el estado de seguimiento hasta
 * el próximo `onLoadEnd`, y el controlador de tiles (`crearControladorTiles`) también arranca de
 * cero. En una ruta de 26 puntos de control eso son 26 recargas completas del mapa con
 * parpadeo — inaceptable para navegación en vivo.
 *
 * El próximo punto de control YA NO es un dato de construcción del HTML: es estado que viaja
 * por `postMessage` (mismo mecanismo que `tracking`/`position`/`ruta-calculada`, ver
 * `enviarEstadoMapa` en route-map-view.tsx), con un handler acá abajo (`data.type ===
 * 'proximoPuntoControl'`) que solo reestiliza los marcadores existentes
 * (`renderizarPuntosControl()`) sin tocar `L.map`. Así el HTML generado es un string IDÉNTICO
 * para el mismo paquete+vehículo sin importar qué punto de control sea el próximo — el `useMemo`
 * de React no lo recalcula y la WebView nunca recarga por este motivo. Lo único que sigue
 * determinando el HTML (y por lo tanto las dependencias del `useMemo`) es la identidad del
 * paquete (la ruta dibujada, los puntos de control fijos) y del vehículo.
 */
export function construirHtml(
  paquete: PaqueteDia,
  _vehiculo: ContextoOperativoMovil['vehiculo'],
): string {
  const coordenadasRuta = convertirGeoJsonALatLng(paquete.ruta.geometria.coordinates);

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

    // CONTROLADOR_TILES_JS_SOURCE (definido arriba en route-map-html.ts como STRING literal, NO
    // como función TS) se interpola acá tal cual, texto por texto. Es EXACTAMENTE el mismo
    // string que route-map-html.test.ts evalúa con \`new Function\` para testear el
    // comportamiento. Ver el comentario largo sobre CONTROLADOR_TILES_JS_SOURCE más arriba en
    // route-map-html.ts para el motivo completo (minificador de Metro + bytecode de Hermes).
    ${CONTROLADOR_TILES_JS_SOURCE}

    // La capa de tiles queda SIEMPRE montada (ver el comentario grande sobre
    // CONTROLADOR_TILES_JS_SOURCE arriba en route-map-html.ts — una versión anterior la retiraba
    // por ausencia sostenida de éxito y eso rompía el caso normal). Lo único que hace este
    // controlador es reintentar, cada REINTENTO_TILES_INTERVALO_MS, los <img> puntuales que
    // fallaron — sin depender de ningún mensaje de posición, así que un vehículo detenido
    // también recupera sus calles.
    var REINTENTO_TILES_INTERVALO_MS = 30000;
    var controladorTiles = crearControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      reintentoIntervaloMs: REINTENTO_TILES_INTERVALO_MS,
      // Para cuando llega 'tileerror' Leaflet YA reemplazó tile.src por ERROR_TILE_URL (ver el
      // comentario grande arriba), así que la URL real hay que recalcularla a partir de las
      // coords que el propio evento trae — tileLayer.getTileUrl es la misma función que Leaflet
      // usa internamente para pedir el tile la primera vez.
      obtenerUrlOriginal: function (coords) { return tileLayer.getTileUrl(coords); },
      // Un tile podado (fuera de la vista tras un pan/zoom) ya no tiene el <img> montado en el
      // DOM — parentNode es la señal barata y estable de "Leaflet ya lo descartó", sin tocar
      // ninguna estructura interna privada de la librería.
      tileSigueEnMapa: function (tile) { return !!(tile && tile.parentNode); }
    });
    tileLayer.on('tileload', function (e) {
      controladorTiles.onTileLoad(e && e.tile, e && e.tile ? e.tile.src : null);
    });
    tileLayer.on('tileerror', function (e) {
      controladorTiles.onTileError(e && e.tile, e && e.coords);
    });

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
    // Arranca en null (nunca horneado desde construirHtml — ver el comentario grande de arriba,
    // Entrega 31b): el valor real llega por postMessage ('proximoPuntoControl'), que
    // route-map-view.tsx manda tanto al montar la WebView como en cada onLoadEnd. Hasta que
    // llegue ese mensaje ningún punto de control aparece destacado como "próximo" — una ventana
    // de un solo frame, indistinguible a simple vista de tenerlo ya resuelto.
    var proximoPuntoIdActual = null;
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

      if (data.type === 'proximoPuntoControl') {
        // Entrega 31b: reestiliza los marcadores de puntos de control (el próximo destacado, el
        // resto en su color normal) SIN tocar L.map ni recrear la polyline/capa de tiles — por
        // eso este mensaje llega solo, separado de 'tracking'. renderizarPuntosControl() ya hacía
        // exactamente este trabajo (remueve y vuelve a crear los markers, no el mapa), así que se
        // reusa tal cual: no hace falta un mecanismo de reestilado nuevo, solo dispararlo desde
        // este tipo de mensaje además de desde 'tracking'.
        proximoPuntoIdActual = data.id || null;
        renderizarPuntosControl();
        return;
      }

      if (data.type === 'tracking') {
        var didChange = seguimientoActivo !== (data.active === true);
        seguimientoActivo = data.active === true;

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

    // Entrega 25/31b (handshake mapa-listo): recién ACÁ, con los listeners de 'message' ya
    // registrados arriba, es seguro avisarle a RN que puede mandar el estado completo sin que se
    // pierda. Antes, RN mandaba el estado inicial (posición del vehículo incluida) por
    // postMessage desde un useEffect/onLoadEnd sin saber si el script del WebView ya había
    // llegado a esta línea — si tardaba (motor más lento, dispositivo viejo, primera carga), ese
    // primer mensaje se perdía en el vacío y el marcador de posición quedaba ausente hasta el
    // próximo cambio de estado: mismo síntoma que "la flecha del vehículo aparece congelada" (la
    // ruta sí se dibuja porque no depende de ningún mensaje). Se manda DELIBERADAMENTE antes de
    // tocar tiles/fitBounds: no debe esperar ningún recurso de red, solo que los listeners ya
    // existan, que es lo único que hace falta. window.ReactNativeWebView lo inyecta
    // react-native-webview — se chequea su existencia por si este HTML llegara a correr alguna
    // vez fuera de una WebView (p. ej. un preview de escritorio).
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapa-listo' }));
    }

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
