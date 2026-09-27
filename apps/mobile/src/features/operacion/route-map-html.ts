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
  /** Cada cuánto TICK del temporizador compartido se evalúa si a un tile pendiente ya le toca
   * reintentarse — es el intervalo BASE del backoff exponencial (ver `maxIntentos`/
   * `esperaMaximaTicks` más abajo), no necesariamente el tiempo real entre dos reintentos del
   * MISMO tile (que crece con cada fallo sucesivo). El temporizador (un único `setInterval`
   * compartido) solo corre mientras haya al menos un tile pendiente. */
  reintentoIntervaloMs: number;
  /** Tope de reintentos por tile antes de abandonarlo (Hallazgo del code-review de esta entrega:
   * sin este tope, un bloqueo sostenido del servidor de tiles — cae dentro de lo que permite la
   * política de uso de `tile.openstreetmap.org`, ver el AVISO DE RIESGO más abajo en
   * `construirHtml` — hacía que CADA tile visible se re-pidiera cada `reintentoIntervaloMs` PARA
   * SIEMPRE, sin límite, agravando el bloqueo en vez de aliviarlo). Agotado el tope, el tile queda
   * con `errorTileUrl` (el fondo liso ya cubre el hueco) hasta que un pan/zoom lo saque y lo
   * vuelva a traer a la vista — Leaflet crea un `<img>` nuevo en ese caso, que arranca sus propios
   * intentos desde cero. Opcional: default `6` si se omite. */
  maxIntentos?: number;
  /** Techo del backoff exponencial, en unidades de `reintentoIntervaloMs` (no en ms directos):
   * cada fallo sucesivo del MISMO tile duplica la espera hasta este techo, para no seguir
   * golpeando la red al mismo ritmo mientras el bloqueo/la falta de cobertura persiste. Opcional:
   * default `8` si se omite (con `reintentoIntervaloMs = 30000`, un techo de 4 minutos entre
   * reintentos sucesivos de un mismo tile). */
  esperaMaximaTicks?: number;
  /** Tope defensivo para la lista `abandonados` (Hallazgo del code-review de esta entrega,
   * 2026-09-25): `reintentarPendientes` ya poda `abandonados` en cada pasada descartando las
   * entradas cuyo `tile` ya no está montado en el mapa (`!tileSigueEnMapa`), pero eso solo cubre
   * el caso "el chofer se movió y Leaflet desmontó el `<img>`". Con un bloqueo sostenido de OSM
   * (403/429) y buena cobertura de red todo el turno, un chofer que se queda quieto o recorre
   * pocas calles repetidas puede acumular muchos tiles abandonados que SIGUEN visibles —
   * `tileSigueEnMapa` no los descarta porque de verdad siguen en el DOM. Sin este tope, esa lista
   * crecería sin límite mientras dure el bloqueo. Al superarlo, se descartan las entradas MÁS
   * VIEJAS primero. Opcional: default `200` si se omite. */
  topeAbandonados?: number;
  /** Dado el `coords` que Leaflet manda en el evento `tileerror`, devuelve la URL original del
   * tile. Hace falta recalcularla porque, para cuando llega `tileerror`, Leaflet YA reemplazó
   * `tile.src` por `errorTileUrl` (ver el comentario grande sobre `CONTROLADOR_TILES_JS_SOURCE`
   * más abajo) — el `<img>` fallido ya no tiene la URL real en ningún atributo. Se invoca UNA sola
   * vez por tile, dentro de `onTileError` — nunca en cada reintento (ver el comentario sobre
   * `urlBase` en `CONTROLADOR_TILES_JS_SOURCE`) — pero congelar el resultado en `onTileError` NO
   * alcanza por sí solo (hallazgo de la verificación `verify-fix` de esta entrega): en Leaflet
   * 1.9.4, `tileLayer.getTileUrl(coords)` arma la URL con el zoom ACTUAL de la capa
   * (`this._getZoomForUrl()`), IGNORANDO `coords.z` a pesar de recibirlo. Y ese zoom puede haber
   * cambiado YA para cuando llega el PRIMER `tileerror` de un tile: Leaflet actualiza `_tileZoom`
   * antes de `_abortLoading` (que solo retira `<img>` con `complete === false`), y una imagen
   * fallida puede quedar `complete === true` antes de que el navegador entregue el evento `error`
   * — el chofer puede cambiar de zoom en esa ventana. Por eso la implementación real (ver
   * `construirUrlTileZoomExacto` / `CONSTRUIR_URL_TILE_JS_SOURCE` más abajo) NUNCA delega en
   * `tileLayer.getTileUrl(coords)`: arma la URL a mano con `coords.z` EXPLÍCITO y normaliza `x`
   * para el wrap horizontal, así el zoom de la URL es siempre el del momento en que ESE tile
   * falló, sin importar cuándo llegue el evento ni si la capa ya cambió de zoom para entonces. */
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
  /** Decisión del CTO (2026-09-25): al volver la conectividad del teléfono (ver
   * `reconexion-mapa-offline.ts`, que es quien dispara esto desde `route-map-view.tsx` vía
   * `postMessage({ type: 'reconectado' })`), reinicia los contadores de TODOS los tiles
   * pendientes (en backoff, esperando su próximo tick) y abandonados (agotaron `maxIntentos` y
   * quedaban con `errorTileUrl` hasta un pan/zoom) que sigan visibles, y los vuelve a pedir de
   * una — sin esperar a que el chofer mueva el mapa. */
  onConectividadRecuperada: () => void;
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
  // 'opciones.obtenerUrlOriginal' NUNCA debe delegar en 'tileLayer.getTileUrl(coords)' de Leaflet.
  // En Leaflet 1.9.4, esa función arma la URL con el zoom ACTUAL DE LA CAPA (this._getZoomForUrl()),
  // no con 'coords.z' — a pesar de recibir 'coords' como argumento, IGNORA su 'z'. El mecanismo
  // anterior de este controlador guardaba solo '{ tile, coords }' en 'pendientes' y volvía a
  // invocar 'obtenerUrlOriginal(coords)' recién en cada tick de 'reintentarPendientes' (hasta
  // reintentoIntervaloMs = 30s después del fallo). Si el mapa cambiaba de zoom en esa ventana (el
  // chofer hace zoom in/out mientras un tile de otro zoom sigue pendiente), el reintento
  // combinaba las x/y viejas de 'coords' con el zoom NUEVO de la capa — un mosaico de una región
  // distinta a la que se pidió, dibujado como si fuera el tile correcto.
  //
  // PRIMER INTENTO DE SOLUCIÓN (INSUFICIENTE — hallazgo de la verificación 'verify-fix' de Codex
  // sobre esta misma entrega): calcular y guardar la URL completa ('urlBase') UNA sola vez, en
  // onTileError, asumiendo que el zoom de la capa TODAVÍA coincide con 'coords.z' en ese instante.
  // ESO NO ES CIERTO en general: Leaflet actualiza '_tileZoom' (el zoom que 'getTileUrl' usa
  // internamente vía '_getZoomForUrl()') ANTES de '_abortLoading', que solo retira <img> con
  // 'complete === false'. Una imagen fallida puede quedar 'complete === true' ANTES de que el
  // navegador entregue el evento 'error' al <img> — el chofer puede cambiar de zoom en esa misma
  // ventana, así que el PRIMER 'tileerror' de un tile (no solo un reintento tardío) puede llegar
  // después del cambio de zoom. Congelar 'urlBase' en onTileError no alcanza si
  // 'opciones.obtenerUrlOriginal' sigue siendo 'tileLayer.getTileUrl(coords)' (que arma la URL con
  // el zoom de la capa EN EL MOMENTO DE LA LLAMADA, sin importar cuándo se llame).
  //
  // SOLUCIÓN COMPLETA: 'opciones.obtenerUrlOriginal' (ver 'construirUrlTileZoomExacto' /
  // 'CONSTRUIR_URL_TILE_JS_SOURCE' más abajo en route-map-html.ts, y cómo se la pasa
  // 'construirHtml') arma la URL a mano con 'coords.z' EXPLÍCITO — nunca con el zoom de la capa en
  // el momento de la llamada — así que el resultado es correcto sin importar CUÁNDO llegue el
  // evento. Congelar 'urlBase' en onTileError sigue siendo necesario ADEMÁS de eso (evita que un
  // reintento tardío, con la capa ya en otro zoom, vuelva a invocar 'obtenerUrlOriginal' y
  // recalcule con las x/y viejas combinadas con datos de otro momento), pero ahora la URL que se
  // congela ya es correcta desde el primer cálculo. Los reintentos posteriores reusan ese
  // 'urlBase' congelado (solo le agregan el cache-busting), sin importar cuánto tiempo pase ni
  // cuántas veces cambie el zoom mientras el tile sigue pendiente.
  var pendientes = [];
  // Tiles que agotaron 'maxIntentos' (ver más abajo) — decisión del CTO (2026-09-25): antes de
  // esto, un tile abandonado salía de 'pendientes' y no quedaba ninguna referencia a él en ningún
  // lado; la única forma de recuperarlo era un pan/zoom (Leaflet crea un <img> nuevo al volver a
  // traerlo a la vista). Si el corte de red duraba más que la ventana de reintentos (con los
  // defaults, ~15 minutos), el chofer se quedaba sin esas calles hasta mover el mapa a mano,
  // aunque la conexión ya hubiera vuelto. Guardarlos acá (en vez de descartarlos del todo) es lo
  // que permite que 'onConectividadRecuperada' (más abajo) los vuelva a pedir apenas vuelve la
  // red, sin depender de ningún gesto del chofer.
  //
  // Hallazgo del code-review de esta entrega (2026-09-25): esta lista solo se vaciaba en
  // 'onConectividadRecuperada' (la transición offline->online del teléfono). Con OSM bloqueando
  // (403/429) y buena cobertura de red TODO el turno, esa transición nunca llega — 'abandonados'
  // retenía para siempre los <img> que Leaflet ya había podado del DOM tras un pan/zoom, sin
  // límite. 'reintentarPendientes' ahora poda esta lista en CADA pasada (por 'tileSigueEnMapa',
  // igual que hace con 'pendientes') y la acota a 'topeAbandonados' entradas — ver esa función
  // más abajo para el detalle completo.
  var abandonados = [];
  // Un único setInterval compartido para todos los tiles pendientes (no uno por tile): más barato
  // y evita reintentos desincronizados. Solo existe mientras haya al menos un pendiente — arranca
  // en el primer tileerror y se apaga solo cuando la lista queda vacía (ver detenerTimerSiVacio).
  var intervalId = null;
  // Hallazgo del code-review de esta entrega: sin tope, un tile bloqueado (la política de uso de
  // tile.openstreetmap.org no permite consumo intensivo desde apps en producción con flota real —
  // ver el AVISO DE RIESGO en construirHtml más abajo) se re-pedía cada 'reintentoIntervaloMs'
  // PARA SIEMPRE — con todos los tiles visibles reintentando al mismo ritmo, eso agrava el
  // bloqueo en vez de aliviarlo. 'maxIntentos'/'esperaMaximaTicks' acotan eso: cada tile tiene un
  // número finito de intentos, con una espera que se DUPLICA en cada fallo sucesivo (backoff
  // exponencial, en unidades de 'reintentoIntervaloMs') hasta un techo — así el tráfico de
  // reintento se apaga solo mientras el bloqueo persiste, en vez de mantenerse constante.
  var maxIntentos = opciones.maxIntentos || 6;
  var esperaMaximaTicks = opciones.esperaMaximaTicks || 8;
  // Tope defensivo de 'abandonados' — ver el comentario grande sobre esa lista más arriba y sobre
  // 'topeAbandonados' en OpcionesControladorTiles (route-map-html.ts) para el porqué completo.
  var topeAbandonados = opciones.topeAbandonados || 200;

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
    // Recorre una copia porque la lista muta durante el loop (los tiles podados o que agotaron
    // sus intentos se descartan acá mismo, sin esperar a un evento que nunca va a llegar).
    var siguientes = [];
    for (var i = 0; i < pendientes.length; i++) {
      var entrada = pendientes[i];
      // El tile salió de la vista por un pan/zoom (Leaflet lo podó del DOM): reintentar algo que
      // ya no se va a dibujar sería tráfico de red desperdiciado. Se descarta sin reintentar.
      if (!opciones.tileSigueEnMapa(entrada.tile)) continue;

      // Backoff exponencial: 'ticksHastaProximoIntento' es cuántos ticks de este temporizador
      // (cada uno dura 'reintentoIntervaloMs') faltan para que a ESTE tile le toque su próximo
      // reintento — arranca en 1 (reintenta en el primer tick, igual que antes de este fix). Se
      // decrementa acá; 'entrada.esperaTicks' (la duración COMPLETA de la espera actual, separada
      // del contador) es lo que se duplica más abajo tras cada intento — nunca este contador ya
      // decrementado, o la próxima espera saldría de una cuenta ya consumida (0 o negativa) en vez
      // de duplicar la espera real que se usó.
      entrada.ticksHastaProximoIntento -= 1;
      if (entrada.ticksHastaProximoIntento > 0) {
        siguientes.push(entrada);
        continue;
      }

      entrada.intentos += 1;
      if (entrada.intentos > maxIntentos) {
        // Tope alcanzado: se abandona este tile PERO se guarda en 'abandonados' (ver el
        // comentario grande sobre esa lista más arriba) en vez de descartarse del todo — así
        // 'onConectividadRecuperada' puede reintentarlo apenas vuelve la red. Sigue con
        // 'errorTileUrl' (el fondo liso ya cubre el hueco visualmente) hasta entonces o hasta que
        // un pan/zoom lo saque de la vista y Leaflet cree un <img> nuevo al volver a traerlo — ese
        // <img> es una entrada distinta, con sus propios intentos desde cero.
        abandonados.push(entrada);
        continue;
      }

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
      // Espera duplicada para el PRÓXIMO intento de este mismo tile (con techo), a partir de
      // 'esperaTicks' (la duración de espera ya usada), NUNCA del contador ya decrementado de
      // arriba — si esta carga funciona, onTileLoad saca la entrada de la lista antes de que esto
      // importe.
      entrada.esperaTicks = Math.min(entrada.esperaTicks * 2, esperaMaximaTicks);
      entrada.ticksHastaProximoIntento = entrada.esperaTicks;
      siguientes.push(entrada);
    }
    pendientes = siguientes;

    // Poda 'abandonados' en CADA pasada (Hallazgo del code-review de esta entrega, 2026-09-25) —
    // ver el comentario grande sobre esa lista más arriba para el porqué completo. Mismo criterio
    // que arriba con 'pendientes': un tile que salió de la vista por un pan/zoom ya no tiene
    // sentido conservarlo, Leaflet no lo va a volver a mostrar tal cual (si vuelve a la vista,
    // crea un <img> nuevo, una entrada distinta con sus propios intentos desde cero).
    var abandonadosVivos = [];
    for (var j = 0; j < abandonados.length; j++) {
      if (opciones.tileSigueEnMapa(abandonados[j].tile)) {
        abandonadosVivos.push(abandonados[j]);
      }
    }
    // Tope defensivo: la poda de arriba no alcanza sola cuando el chofer NO se mueve (o recorre
    // pocas calles repetidas) durante un bloqueo sostenido de OSM — esos tiles siguen montados de
    // verdad, 'tileSigueEnMapa' no los saca. Se descartan las entradas MÁS VIEJAS primero (las que
    // llevan más tiempo esperando una reconexión) — ver 'topeAbandonados' en
    // OpcionesControladorTiles más arriba en route-map-html.ts.
    if (abandonadosVivos.length > topeAbandonados) {
      abandonadosVivos = abandonadosVivos.slice(abandonadosVivos.length - topeAbandonados);
    }
    abandonados = abandonadosVivos;

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
    // 'intentos'/'esperaTicks'/'ticksHastaProximoIntento' arrancan el backoff exponencial de este
    // tile desde cero — reintenta en el primer tick, igual que el comportamiento previo a este
    // fix ('esperaTicks' = 1 tick de espera inicial).
    pendientes.push({
      tile: tile,
      coords: coords,
      urlBase: opciones.obtenerUrlOriginal(coords),
      intentos: 0,
      esperaTicks: 1,
      ticksHastaProximoIntento: 1
    });
    if (intervalId === null) {
      intervalId = setInterval(reintentarPendientes, opciones.reintentoIntervaloMs);
    }
  }

  // Decisión del CTO (2026-09-25): al volver la conectividad del teléfono (la señal la manda RN,
  // ver 'reconexion-mapa-offline.ts' — este controlador no sabe nada de NetInfo ni de la conexión
  // real del teléfono, solo reacciona cuando le avisan), reinicia los contadores de TODOS los
  // tiles pendientes (en backoff, esperando su próximo tick) Y abandonados (agotaron
  // 'maxIntentos') que sigan visibles, y los vuelve a pedir de una — sin esperar ningún pan/zoom.
  //
  // Deliberadamente NO se reinsertan las entradas reseteadas en 'pendientes': al reasignar
  // 'tile.src' más abajo, Leaflet dispara 'tileload'/'tileerror' sobre ESE MISMO <img> como si
  // fuera una carga real nueva. Si carga bien, no hace falta ninguna entrada pendiente (nunca se
  // creó ninguna acá); si vuelve a fallar, 'onTileError' de arriba arma una entrada NUEVA desde
  // cero (intentos: 0, esperaTicks: 1) — el mismo camino que cualquier tile que falla por primera
  // vez, sin arrastrar el conteo de intentos que tenía antes del corte de red. Por eso también se
  // apaga el temporizador compartido acá: si algún reintento vuelve a fallar, 'onTileError' lo
  // reinicia solo, igual que siempre.
  function onConectividadRecuperada() {
    var candidatos = pendientes.concat(abandonados);
    pendientes = [];
    abandonados = [];
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    for (var i = 0; i < candidatos.length; i++) {
      var entrada = candidatos[i];
      // Solo los que siguen montados en el DOM: uno podado por un pan/zoom mientras estaba
      // pendiente/abandonado ya no se va a dibujar — reintentarlo sería red desperdiciada, igual
      // que en 'reintentarPendientes'.
      if (!opciones.tileSigueEnMapa(entrada.tile)) continue;
      // 'urlBase' ya está congelada desde 'onTileError' (el zoom del momento en que ESE tile
      // falló) — nunca se recalcula acá, mismo motivo que en 'reintentarPendientes'.
      var url = entrada.urlBase;
      url += (url.indexOf('?') === -1 ? '?' : '&') + '_retry=' + Date.now();
      entrada.tile.src = url;
    }
  }

  return {
    onTileLoad: onTileLoad,
    onTileError: onTileError,
    onConectividadRecuperada: onConectividadRecuperada
  };
}
`;

/** Describe la capa de tiles XYZ lo mínimo necesario para reconstruir la URL de un tile a mano —
 * ver `CONSTRUIR_URL_TILE_JS_SOURCE` más abajo. Se arma en `construirHtml` a partir de
 * `tileLayer._url`/`tileLayer.options` (la MISMA capa real de Leaflet, nunca un duplicado
 * hardcodeado), así que si algún día esta capa suma `subdomains`/`zoomOffset`/`zoomReverse`, la
 * reconstrucción los sigue respetando sin tocar este archivo. */
export interface DescripcionCapaTilesXYZ {
  /** Plantilla cruda de la capa, p. ej. `'https://tile.openstreetmap.org/{z}/{x}/{y}.png'` —
   * `tileLayer._url` en Leaflet 1.9.4, la misma que recibió `L.tileLayer(...)`. */
  urlTemplate: string;
  /** `tileLayer.options.zoomOffset` — 0 si la capa no lo define. Esta capa OSM no lo usa hoy. */
  zoomOffset: number;
  /** `tileLayer.options.zoomReverse` — false si la capa no lo define. Esta capa OSM no lo usa hoy. */
  zoomReverse: boolean;
  /** `tileLayer.options.maxZoom` — solo hace falta cuando `zoomReverse` es true. */
  maxZoom: number;
  /** `tileLayer.options.subdomains` ya normalizado a array (Leaflet lo splitea en `initialize` si
   * llegó como string). Vacío si la plantilla no tiene `{s}` — es el caso de esta capa OSM. */
  subdominios: string[];
}

/**
 * Código fuente LITERAL (JS plano, ES5) de `construirUrlTileZoomExacto` — GAP 1 de la
 * verificación `verify-fix` de Codex sobre el commit anterior de esta entrega. Igual que
 * `CONTROLADOR_TILES_JS_SOURCE` (ver el comentario grande sobre por qué NUNCA
 * `Function.prototype.toString()` más arriba), viaja como STRING literal escrito a mano, evaluado
 * tal cual en el `<script>` real y con `new Function` en los tests — nunca una función TS que el
 * bundler pueda renombrar.
 *
 * Por qué existe esta función en vez de seguir usando `tileLayer.getTileUrl(coords)`: esa función
 * de Leaflet arma la URL con `this._getZoomForUrl()` (el zoom ACTUAL de la capa en el momento de
 * la llamada), IGNORANDO el `coords.z` que recibe como argumento. `onTileError` puede recibir un
 * `coords` de un zoom que la capa YA DEJÓ ATRÁS — ver el comentario grande sobre `urlBase` en
 * `CONTROLADOR_TILES_JS_SOURCE` más arriba para el mecanismo exacto (Leaflet actualiza `_tileZoom`
 * antes de que `_abortLoading` pueda descartar la imagen fallida, así que el chofer puede cambiar
 * de zoom antes de que el evento `error` llegue, incluso para el primer `tileerror` de un tile).
 * `construirUrlTileZoomExacto` arma la URL con `coords.z` explícito — replica a mano la fórmula de
 * `_getZoomForUrl` (`zoomReverse ? maxZoom - z : z`, más `zoomOffset`) pero partiendo de `coords.z`
 * en vez de leer el zoom actual de la capa — y normaliza `x` para el wrap horizontal (2^z columnas
 * de tiles por fila), porque el `coords` que llega a `tileerror` es el SIN normalizar: Leaflet
 * normaliza x/y recién dentro de `createTile` (vía `_wrapCoords`), después de haber capturado el
 * `coords` original para el evento — verificado contra el bundle de Leaflet 1.9.4 embebido
 * (`_tileReady` dispara `tileerror` con el `coords` que le pasó `_addTile`, sin pasar por
 * `_wrapCoords`). Sin esta normalización, un tile en el borde del mapa (x fuera de `[0, 2^z)`)
 * reintentaría una URL con una columna de tile que no existe.
 *
 * Deliberadamente NO usa `L.Util.template`/`tileLayer._getSubdomain` de Leaflet: la capa OSM de
 * esta app no tiene `{s}` en su plantilla (un solo host, sin subdominios) ni usa `zoomOffset`/
 * `zoomReverse`, así que un reemplazo de placeholders manual (`formatearPlantillaTile`) alcanza,
 * es trivial de testear sin un `L` falso, y evita depender de un método privado (`_getSubdomain`)
 * de una librería de terceros. Si esta capa alguna vez suma subdominios, la selección de
 * subdominio de acá (hash `x + y` módulo la cantidad de subdominios) replica la de Leaflet.
 */
export const CONSTRUIR_URL_TILE_JS_SOURCE = `
function formatearPlantillaTile(plantilla, datos) {
  var resultado = plantilla;
  for (var clave in datos) {
    if (Object.prototype.hasOwnProperty.call(datos, clave)) {
      resultado = resultado.split('{' + clave + '}').join(String(datos[clave]));
    }
  }
  return resultado;
}

function construirUrlTileZoomExacto(coords, capa) {
  // Zoom EXPLÍCITO a partir de 'coords.z' — nunca del zoom actual de la capa. Replica la fórmula
  // de 'TileLayer.prototype._getZoomForUrl' de Leaflet, pero partiendo de 'coords.z' en vez de
  // 'this._tileZoom' (ver el comentario grande sobre CONSTRUIR_URL_TILE_JS_SOURCE en
  // route-map-html.ts para el porqué completo).
  var zoomUrl = capa.zoomReverse ? capa.maxZoom - coords.z : coords.z;
  zoomUrl = zoomUrl + (capa.zoomOffset || 0);

  // Wrap horizontal: 'coords.x' que llega a 'tileerror' NO está normalizado (Leaflet normaliza
  // recién en 'createTile', después de haber armado el 'coords' del evento) — sin esto, un tile en
  // el borde del mapa reintentaría una columna que no existe. El wrap es sobre 'coords.z' (el
  // zoom del GRID en el que se pidió el tile), no sobre 'zoomUrl' (que ya puede llevar el offset).
  var tilesPorFila = Math.pow(2, coords.z);
  var xNormalizada = ((coords.x % tilesPorFila) + tilesPorFila) % tilesPorFila;

  var subdominio = '';
  if (capa.subdominios && capa.subdominios.length > 0) {
    subdominio = capa.subdominios[Math.abs(xNormalizada + coords.y) % capa.subdominios.length];
  }

  return formatearPlantillaTile(capa.urlTemplate, {
    z: zoomUrl,
    x: xNormalizada,
    y: coords.y,
    s: subdominio
  });
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
    // AVISO DE RIESGO (mitigado parcialmente en esta entrega, ver plan Entrega 25):
    // tile.openstreetmap.org es el servidor de demostración de OSM — su política de uso no
    // permite consumo intensivo desde apps en producción con flota real. Con más de un puñado de
    // vehículos hace falta un proveedor de tiles propio o pago (p. ej. MapTiler, Mapbox, o un tile
    // server propio) — eso sigue sin resolverse acá. Lo que SÍ se resolvió (hallazgo del
    // code-review de esta entrega): las peticiones de tile salían sin ningún header \`Referer\`
    // porque este HTML corría como un string sin \`baseUrl\` en el \`source\` de la WebView — la
    // política de uso de OSM pide un Referer identificable, y sin él, más el reintento sin tope
    // que había antes (ver \`CONTROLADOR_TILES_JS_SOURCE\` más arriba), esto podía agravar un
    // bloqueo en vez de evitarlo. Ahora \`route-map-view.tsx\` pasa \`baseUrl\` en \`source\`, así que el
    // WebView sí manda Referer, y el reintento tiene backoff exponencial + tope de intentos.
    // Pixel transparente 1x1: evita que Android WebView dibuje el ícono de "imagen rota" en
    // cada mosaico que falla mientras no hay red — sin esto, un mapa sin cobertura se llena
    // de cuadrados rotos parpadeando en cada reintento en vez de quedar en el fondo liso.
    var ERROR_TILE_URL =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';
    // Plantilla cruda, en una variable propia — la comparte tileLayer.getTileUrl (la primera
    // carga de cada tile, sin tocar) y construirUrlTileZoomExacto (el reintento manual de acá
    // abajo, que NUNCA pasa por tileLayer.getTileUrl — ver el comentario grande sobre
    // CONSTRUIR_URL_TILE_JS_SOURCE más arriba en route-map-html.ts). Una sola fuente de verdad
    // para el string de la URL evita que la plantilla del reintento se desincronice de la real.
    var TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    var tileLayer = L.tileLayer(TILE_URL_TEMPLATE, {
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

    // CONSTRUIR_URL_TILE_JS_SOURCE / CONTROLADOR_TILES_JS_SOURCE (definidos arriba en
    // route-map-html.ts como STRINGS literales, NO como funciones TS) se interpolan acá tal cual,
    // texto por texto. Son EXACTAMENTE los mismos strings que route-map-html.test.ts evalúa con
    // \`new Function\` para testear el comportamiento. Ver los comentarios largos sobre cada uno
    // más arriba en route-map-html.ts para el motivo completo (minificador de Metro + bytecode de
    // Hermes, y por qué la URL del reintento no puede delegar en tileLayer.getTileUrl).
    ${CONSTRUIR_URL_TILE_JS_SOURCE}
    ${CONTROLADOR_TILES_JS_SOURCE}

    // La capa de tiles queda SIEMPRE montada (ver el comentario grande sobre
    // CONTROLADOR_TILES_JS_SOURCE arriba en route-map-html.ts — una versión anterior la retiraba
    // por ausencia sostenida de éxito y eso rompía el caso normal). Lo único que hace este
    // controlador es reintentar, cada REINTENTO_TILES_INTERVALO_MS, los <img> puntuales que
    // fallaron — sin depender de ningún mensaje de posición, así que un vehículo detenido
    // también recupera sus calles.
    var REINTENTO_TILES_INTERVALO_MS = 30000;
    // Hallazgo del code-review de esta entrega: sin tope, un bloqueo sostenido del servidor de
    // tiles (ver el AVISO DE RIESGO más abajo sobre la política de uso de
    // tile.openstreetmap.org) hacía que CADA tile visible se re-pidiera cada
    // REINTENTO_TILES_INTERVALO_MS para siempre — 6 intentos con backoff exponencial (techo de 8
    // ticks, ~4 minutos entre reintentos sucesivos de un mismo tile) alcanzan para recuperarse de
    // un corte transitorio sin seguir martillando la red indefinidamente durante uno sostenido.
    var REINTENTO_TILES_MAX_INTENTOS = 6;
    var REINTENTO_TILES_ESPERA_MAXIMA_TICKS = 8;
    var controladorTiles = crearControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      reintentoIntervaloMs: REINTENTO_TILES_INTERVALO_MS,
      maxIntentos: REINTENTO_TILES_MAX_INTENTOS,
      esperaMaximaTicks: REINTENTO_TILES_ESPERA_MAXIMA_TICKS,
      // Para cuando llega 'tileerror' Leaflet YA reemplazó tile.src por ERROR_TILE_URL (ver el
      // comentario grande arriba), así que la URL real hay que recalcularla a partir de las
      // coords que el propio evento trae. Deliberadamente NO delega en tileLayer.getTileUrl(coords)
      // — esa función arma la URL con el zoom ACTUAL de la capa, no con coords.z (ver el
      // comentario grande sobre CONSTRUIR_URL_TILE_JS_SOURCE más arriba). construirUrlTileZoomExacto
      // sí usa coords.z explícito; tileLayer.options ya trae zoomOffset/zoomReverse/subdomains
      // resueltos por Leaflet mismo (spliteados/ajustados en su initialize), así que esta capa
      // sigue siendo la única fuente de verdad aunque esos valores cambien.
      obtenerUrlOriginal: function (coords) {
        return construirUrlTileZoomExacto(coords, {
          urlTemplate: TILE_URL_TEMPLATE,
          zoomOffset: tileLayer.options.zoomOffset || 0,
          zoomReverse: !!tileLayer.options.zoomReverse,
          maxZoom: tileLayer.options.maxZoom,
          subdominios: tileLayer.options.subdomains || []
        });
      },
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

    // Hallazgo del code-review de esta entrega: 'map.fitBounds(ruta.getBounds(), ...)' tira
    // ('Bounds are not valid') cuando 'coordenadasRuta' está vacío — un paquete sin geometría de
    // ruta (dato incompleto/corrupto desde el backend) no debería congelar ni crashear el mapa por
    // eso. Los tres call-sites de fitBounds (acá, en 'tracking' y en 'recenter' más abajo) pasan
    // por este helper en vez de llamar a 'ruta.getBounds()' directo. Sin coordenadas, no hay bounds
    // válidos que ajustar: si ya se conoce la posición del vehículo, centra ahí (mejor que nada);
    // si tampoco hay posición, no toca la vista — queda el 'map.setView' inicial de más arriba.
    function ajustarVistaARuta() {
      if (coordenadasRuta.length === 0) {
        if (posicion) {
          map.setView(posicion.getLatLng(), 17);
        }
        return;
      }
      map.fitBounds(ruta.getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 180] });
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
          ajustarVistaARuta();
          return;
        }
        seguimientoActivo = true;
        map.flyTo(posicion.getLatLng(), 17, { duration: 0.6 });
        return;
      }

      if (data.type === 'reconectado') {
        // Decisión del CTO (2026-09-25): 'route-map-view.tsx' manda este mensaje al detectar la
        // transición offline→online del teléfono (ver 'reconexion-mapa-offline.ts') — reinicia
        // los contadores de los tiles pendientes/abandonados y los vuelve a pedir, sin tocar
        // L.map ni redibujar la polyline/los marcadores (mismo criterio que 'proximoPuntoControl'
        // más arriba: un mensaje puntual que solo toca lo que corresponde, nunca recarga nada).
        controladorTiles.onConectividadRecuperada();
        return;
      }

      if (data.type === 'proximoPuntoControl') {
        // Entrega 31b: reestiliza los marcadores de puntos de control (el próximo destacado, el
        // resto en su color normal) SIN tocar L.map ni recrear la polyline/capa de tiles — por
        // eso este mensaje llega solo, separado de 'tracking'. renderizarPuntosControl() ya hacía
        // exactamente este trabajo (remueve y vuelve a crear los markers, no el mapa), así que se
        // reusa tal cual: no hace falta un mecanismo de reestilado nuevo, solo dispararlo desde
        // este tipo de mensaje además de desde 'tracking'.
        //
        // Hallazgo del code-review de esta entrega: 'route-map-view.tsx' manda ESTE mensaje (junto
        // con 'tracking') en CADA cambio de props, incluida cada actualización de posición GPS
        // ('posicionActual' está en las dependencias de ese useEffect) — sin este guard, cada fix
        // de GPS borraba y volvía a crear TODOS los marcadores de puntos de control, dos veces
        // (acá y en 'tracking' más abajo), aunque el próximo punto de control siguiera siendo el
        // mismo. Si el id no cambió, no hay nada que reestilizar: se sale antes de tocar el DOM.
        var nuevoProximoPuntoId = data.id || null;
        if (nuevoProximoPuntoId === proximoPuntoIdActual) return;
        proximoPuntoIdActual = nuevoProximoPuntoId;
        renderizarPuntosControl();
        return;
      }

      if (data.type === 'tracking') {
        var nuevoTracking = data.active === true;
        var didChange = seguimientoActivo !== nuevoTracking;
        seguimientoActivo = nuevoTracking;

        // Color de la ruta en mapa: En espera (#1E1B4B) vs En línea (#FE9B0B)
        ruta.setStyle({
          color: seguimientoActivo ? COLOR_LINEA : COLOR_ESPERA,
          weight: seguimientoActivo ? 5.5 : 4.5
        });

        // Mismo hallazgo que en 'proximoPuntoControl' de arriba: este mensaje también llega en
        // cada fix de GPS con el mismo 'active' de siempre — 'renderizarPuntosControl()' solo
        // hace falta reejecutarla cuando 'seguimientoActivo' de verdad cambió (afecta qué puntos
        // se pintan como "completed", ver 'isPassed' en 'renderizarPuntosControl'), no en cada
        // mensaje 'tracking' idéntico al anterior.
        if (didChange) {
          renderizarPuntosControl();
        }

        if (posicion) {
          posicion.setIcon(getArrowIcon(currentHeading));
        }

        if (seguimientoActivo && posicion) {
          map.flyTo(posicion.getLatLng(), 17, { duration: 0.7 });
        } else if (!seguimientoActivo) {
          ajustarVistaARuta();
        }
        actualizarCaminoAlProximoPunto();
        return;
      }

      if (data.type === 'position') {
        var latlng = [data.lat, data.lng];

        // Fase B (docs/plan-ubicacion-fluida.md): si RN manda un 'heading' numérico (calculado
        // por el núcleo de movimiento — GPS con histéresis, o el fallback por bearing sobre los
        // mismos dos puntos que este 'calcHeading' usaría), se usa tal cual en vez de recalcularlo
        // acá. Con 'heading' ausente o null (emisor viejo, o el núcleo todavía sin rumbo válido)
        // el comportamiento queda IDÉNTICO al de antes de esta entrega.
        if (typeof data.heading === 'number' && data.heading >= 0) {
          currentHeading = data.heading;
        } else if (prevLatLng && (prevLatLng[0] !== latlng[0] || prevLatLng[1] !== latlng[1])) {
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
    // marcadores) — este ajuste solo acomoda esa vista provisoria a los límites reales de la
    // ruta (ver 'ajustarVistaARuta' más arriba: sin coordenadas de ruta, 'fitBounds' tiraría por
    // bounds inválidos). Corre de forma síncrona apenas el script se ejecuta (inmediato: ya no
    // espera ningún <script src> remoto), así que el ajuste es un solo frame de JS local, no una
    // espera de red.
    ajustarVistaARuta();
  </script>
</body>
</html>`;
}
