import * as vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import {
  CONSTRUIR_URL_TILE_JS_SOURCE,
  CONTROLADOR_TILES_JS_SOURCE,
  construirHtml,
  convertirGeoJsonALatLng,
} from './route-map-html';
import type {
  ControladorTiles,
  DescripcionCapaTilesXYZ,
  OpcionesControladorTiles,
} from './route-map-html';

/**
 * Evalúa `CONTROLADOR_TILES_JS_SOURCE` con `new Function` y devuelve una instancia real del
 * controlador. Hallazgo 1 del code-review: antes este archivo importaba `crearControladorTiles`
 * como función TypeScript, así que el test ejercitaba una función que vivía en memoria de forma
 * separada del texto que `construirHtml` insertaba en el HTML — en dev funcionan igual porque
 * ahí `.toString()` de esa función devolvía su propio código fuente, pero en un build de release
 * (Metro minifica y renombra, Hermes compila a bytecode) el texto insertado en el HTML terminaba
 * siendo otra cosa. Evaluando `CONTROLADOR_TILES_JS_SOURCE` acá con `new Function` — el MISMO
 * string que `construirHtml` interpola en el `<script>` — el test queda atado por construcción al
 * texto real que corre en el WebView: si alguien vuelve a romper esa igualdad, cualquier test de
 * este describe lo detecta.
 */
function instanciarControladorTiles(opciones: OpcionesControladorTiles): ControladorTiles {
  // eslint-disable-next-line no-new-func -- evaluación intencional del string fuente, ver doc arriba.
  const factory = new Function(`${CONTROLADOR_TILES_JS_SOURCE}\nreturn crearControladorTiles;`) as () => (
    opts: OpcionesControladorTiles,
  ) => ControladorTiles;
  return factory()(opciones);
}

/**
 * Evalúa `CONSTRUIR_URL_TILE_JS_SOURCE` con `new Function` y devuelve `construirUrlTileZoomExacto`
 * real — el MISMO texto que `construirHtml` interpola en el `<script>` (ver el comentario grande
 * sobre `CONSTRUIR_URL_TILE_JS_SOURCE` en route-map-html.ts, GAP 1 de la verificación `verify-fix`
 * de Codex sobre el commit anterior). Igual razón que `instanciarControladorTiles` arriba: testear
 * una reimplementación TS paralela no habría detectado que la producción seguía delegando en
 * `tileLayer.getTileUrl(coords)`.
 */
function instanciarConstructorUrlTile(): (coords: unknown, capa: DescripcionCapaTilesXYZ) => string {
  // eslint-disable-next-line no-new-func -- evaluación intencional del string fuente, ver doc arriba.
  const factory = new Function(
    `${CONSTRUIR_URL_TILE_JS_SOURCE}\nreturn construirUrlTileZoomExacto;`,
  ) as () => (coords: unknown, capa: DescripcionCapaTilesXYZ) => string;
  return factory();
}

/** Tile `<img>` falso mínimo: solo lo que el controlador toca (`.src`, `.parentNode`). No hace
 * falta un DOM real — el controlador nunca asume más que esto de un tile. */
function crearTileFalso(opciones: { montado?: boolean } = {}) {
  return {
    src: '',
    parentNode: opciones.montado === false ? null : ({} as unknown),
  };
}

// Entrega 25 (plan post-piloto 2026-09-09): la navegación en ruta no puede depender de la red.
// Estos tests cubren lo que sí es testeable fuera del WebView: (a) que Leaflet quede embebido
// inline y no se referencie ningún CDN, (b) que exista el fallback "nunca pantalla gris" cuando
// los tiles no cargan, y (c) la conversión de coordenadas GeoJSON [lng,lat] → Leaflet [lat,lng],
// que es exactamente el tipo de bug silencioso que sospechaba el síntoma 10 del piloto.

function paqueteDePrueba(): PaqueteDia {
  return {
    asignacion: {
      id: 'a0000000-0000-4000-8000-000000000001',
      fecha: '2026-09-10',
      horario: 'manana',
      horaSalida: null,
      horaPresentacion: null,
      venceAt: '2026-09-10T23:59:59.000Z',
    },
    ruta: {
      id: 'r0000000-0000-4000-8000-000000000001',
      sentido: 'ida',
      geometria: {
        type: 'LineString',
        // GeoJSON: [lng, lat]. Cochabamba aprox.
        coordinates: [
          [-66.1568, -17.3895],
          [-66.15, -17.38],
          [-66.14, -17.37],
        ],
      },
    },
    linea: {
      id: 'l0000000-0000-4000-8000-000000000001',
      codigo: 'Z12',
      nombre: 'Zona 12',
      color: '#3127B1',
    },
    paradas: [],
    puntosControl: [
      {
        id: 'p0000000-0000-4000-8000-000000000001',
        orden: 0,
        coord: { type: 'Point', coordinates: [-66.155, -17.385] },
        radioToleranciaM: 150,
        obligatorio: true,
      },
      {
        id: 'p0000000-0000-4000-8000-000000000002',
        orden: 1,
        coord: { type: 'Point', coordinates: [-66.145, -17.375] },
        radioToleranciaM: 150,
        obligatorio: true,
      },
    ],
  };
}

const vehiculoDePrueba = { placa: 'TEST-001' } as unknown as ContextoOperativoMovil['vehiculo'];

describe('convertirGeoJsonALatLng', () => {
  it('invierte [lng, lat] (GeoJSON) a [lat, lng] (Leaflet)', () => {
    expect(convertirGeoJsonALatLng([[-66.1568, -17.3895]])).toEqual([[-17.3895, -66.1568]]);
  });

  it('preserva el orden de la lista y convierte cada punto', () => {
    const entrada: [number, number][] = [
      [-66.15, -17.38],
      [-66.14, -17.37],
    ];
    expect(convertirGeoJsonALatLng(entrada)).toEqual([
      [-17.38, -66.15],
      [-17.37, -66.14],
    ]);
  });

  it('no muta el array de entrada', () => {
    const entrada: [number, number][] = [[-66.15, -17.38]];
    const copia = JSON.stringify(entrada);
    convertirGeoJsonALatLng(entrada);
    expect(JSON.stringify(entrada)).toBe(copia);
  });
});

// Decisión del chairman (2026-09-11), a partir de un code-review posterior a la Entrega 25: el
// mecanismo anterior (retirar la capa de tiles completa a los 4s de fallos sostenidos tras un
// `tileerror`) EMPEORABA el caso normal. Con cobertura completa, si fallaba el último tile
// pendiente (un timeout suelto, un 429 del servidor de demo de OSM), a los 4s se borraban TODOS
// los tiles que sí habían cargado — pantalla lisa con la red funcionando. El requisito real ("sin
// red, nunca pantalla gris") ya lo cumplían el `errorTileUrl`, el fondo liso y la
// polyline/puntos de control/posición, que se dibujan siempre — retirar la capa no sumaba nada.
// Ahora la capa queda SIEMPRE montada y `crearControladorTiles` solo reintenta, tile por tile, los
// que fallaron — ver el comentario grande sobre `CONTROLADOR_TILES_JS_SOURCE` en route-map-html.ts.
// Estos tests ejercitan `crearControladorTiles` vía `instanciarControladorTiles` (ver arriba) —
// evaluando el MISMO string `CONTROLADOR_TILES_JS_SOURCE` que `construirHtml` embebe tal cual en
// el `<script>` del WebView, así que cubren el comportamiento real y el texto real, no una función
// TS paralela que podría divergir del bundle de release.
describe('crearControladorTiles — reintento de tiles fallidos (la capa nunca se retira)', () => {
  const ERROR_TILE_URL = 'data:image/gif;base64,ERROR';
  const REINTENTO_INTERVALO_MS = 30000;
  const URL_ORIGINAL = 'https://tile.openstreetmap.org/10/512/512.png';
  const COORDS = { x: 512, y: 512, z: 10 };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Instancia el controlador con defaults razonables para estos tests — `tileSigueEnMapa`
   * devuelve `true` salvo que el test la pise (simula un tile podado por pan/zoom). */
  function crearControlador(overrides: Partial<OpcionesControladorTiles> = {}): ControladorTiles {
    return instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      reintentoIntervaloMs: REINTENTO_INTERVALO_MS,
      obtenerUrlOriginal: () => URL_ORIGINAL,
      tileSigueEnMapa: () => true,
      ...overrides,
    });
  }

  it('un tile falla y, pasados 30s sin ningún mensaje de posición de por medio, se reintenta solo; si carga, sale de la lista y el temporizador se detiene', () => {
    const tile = crearTileFalso();
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    const controlador = crearControlador({ obtenerUrlOriginal });

    controlador.onTileError(tile, COORDS);
    // `obtenerUrlOriginal` se invoca UNA sola vez, apenas falla el tile — no en cada reintento
    // (ver el comentario grande sobre 'urlBase' en route-map-html.ts: recalcularla más tarde
    // podría mezclar el zoom actual con las x/y viejas de `coords`).
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
    // Pero el reintento en sí es PURAMENTE por el temporizador — no depende de que llegue ningún
    // mensaje 'position' (a diferencia del mecanismo viejo). tile.src no se toca hasta el tick.
    expect(tile.src).toBe('');

    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    // Se reasignó tile.src con la URL original + cache-busting, para forzar una carga real nueva
    // — reusando la URL ya calculada, sin volver a invocar obtenerUrlOriginal.
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
    expect(tile.src).toContain(URL_ORIGINAL);
    expect(tile.src).not.toBe(URL_ORIGINAL); // trae el parámetro de cache-busting agregado

    // Leaflet dispara su propio 'tileload' sobre ESE <img> cuando la nueva carga funciona.
    controlador.onTileLoad(tile, tile.src);

    // Salió de la lista de pendientes: el temporizador se apaga y ya no se lo vuelve a tocar.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS * 3);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
  });

  it('sin ningún tile fallido no arranca ningún temporizador', () => {
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    crearControlador({ obtenerUrlOriginal });

    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS * 5);
    expect(obtenerUrlOriginal).not.toHaveBeenCalled();
  });

  it('un tile que sigue fallando se reintenta con backoff exponencial, sin duplicar la entrada pendiente ni recalcular la URL', () => {
    const tile = crearTileFalso();
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    const controlador = crearControlador({ obtenerUrlOriginal });

    controlador.onTileError(tile, COORDS);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    const primerSrc = tile.src;
    expect(primerSrc).toContain(URL_ORIGINAL);

    // El reintento del tick anterior volvió a fallar: Leaflet dispara tileerror otra vez sobre
    // el MISMO <img>. No debe armar una segunda entrada/temporizador en paralelo, y como sigue
    // siendo el MISMO tile pendiente, tampoco vuelve a invocar obtenerUrlOriginal (la URL base ya
    // quedó congelada en el primer onTileError — ver el comentario sobre 'urlBase').
    controlador.onTileError(tile, COORDS);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);

    // Backoff exponencial (Hallazgo del code-review de esta entrega): tras el primer reintento la
    // espera para el SEGUNDO se duplicó a 2 ticks — un solo tick más todavía no le toca.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
    expect(tile.src).toBe(primerSrc);

    // Al segundo tick de espera (2 en total desde el primer reintento) sí le toca de nuevo.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
    // El segundo reintento SÍ vuelve a reasignar tile.src (con un cache-busting distinto), aunque
    // la URL base sea la misma — el reintento en sí no se salteó.
    expect(tile.src).toContain(URL_ORIGINAL);
    expect(tile.src).not.toBe(primerSrc);
  });

  // Bug real reportado por la verificación de esta entrega (Codex, verify-fix): Leaflet 1.9.4
  // arma `tileLayer.getTileUrl(coords)` con el zoom ACTUAL de la capa, no con `coords.z`. El
  // mecanismo viejo invocaba `obtenerUrlOriginal(coords)` de nuevo en cada tick de reintento — si
  // el chofer cambiaba de zoom en la ventana de 30s entre el fallo y el reintento, el tile se
  // reintentaba con las x/y del zoom viejo pero la URL armada al zoom NUEVO: un mosaico de una
  // región distinta a la pedida. Este test simula ese `obtenerUrlOriginal` "a la Leaflet"
  // (ignora `coords.z`, usa una variable de zoom mutable que representa el zoom actual de la
  // capa) para probar que el controlador ya NO se deja engañar: congela la URL en el momento del
  // fallo y la reusa en todos los reintentos futuros, sin importar que el zoom haya cambiado.
  it('un tile pendiente conserva la URL (y el zoom) del momento en que falló, aunque el zoom de la capa cambie antes del reintento', () => {
    const tile = crearTileFalso();
    let zoomActualDeLaCapa = 10;
    // Réplica deliberada del comportamiento real de Leaflet 1.9.4: ignora coords.z y arma la URL
    // con el zoom "actual" de la capa en el momento de la llamada.
    const obtenerUrlOriginalComoLeaflet = vi.fn(
      (coords: unknown) =>
        `https://tile.openstreetmap.org/${zoomActualDeLaCapa}/${(coords as { x: number }).x}/${(coords as { y: number }).y}.png`,
    );
    const controlador = crearControlador({ obtenerUrlOriginal: obtenerUrlOriginalComoLeaflet });

    // El tile falla a zoom 10 — la URL base se calcula y congela ACÁ, con zoomActualDeLaCapa = 10.
    controlador.onTileError(tile, COORDS);
    expect(obtenerUrlOriginalComoLeaflet).toHaveBeenCalledTimes(1);

    // El chofer hace zoom in ANTES de que se cumpla el intervalo de reintento.
    zoomActualDeLaCapa = 16;

    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);

    // Si el controlador hubiera vuelto a invocar obtenerUrlOriginal acá, tile.src tendría '/16/'
    // (el bug real). Con la URL congelada, el reintento sigue siendo al zoom correcto (10), el
    // mismo en el que el tile falló — nunca se volvió a invocar obtenerUrlOriginal.
    expect(obtenerUrlOriginalComoLeaflet).toHaveBeenCalledTimes(1);
    expect(tile.src).toContain(`/10/${COORDS.x}/${COORDS.y}.png`);
    expect(tile.src).not.toContain('/16/');
  });

  // Hallazgo del code-review de esta entrega: Leaflet dispara `tileload` también para el GIF de
  // `errorTileUrl` (no solo para tiles reales) — sin este chequeo, ese `tileload` sacaría al tile
  // de la lista de pendientes como si hubiera cargado de verdad.
  it('el GIF de errorTileUrl dispara tileload pero NO cuenta como carga real ni saca al tile de la lista', () => {
    const tile = crearTileFalso();
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    const controlador = crearControlador({ obtenerUrlOriginal });

    controlador.onTileError(tile, COORDS);
    // Este es exactamente el evento que Leaflet 1.9.4 dispara para el placeholder de error: un
    // tileload cuyo tile.src es el errorTileUrl, no un tile real.
    controlador.onTileLoad(tile, ERROR_TILE_URL);

    // Sigue pendiente: el temporizador lo reintenta igual, el GIF no lo sacó de la lista.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);
  });

  it('un tile podado del mapa (pan/zoom) se descarta sin reintentar (nunca le toca tile.src) y el temporizador se apaga si era el único pendiente', () => {
    const tilePodado = crearTileFalso({ montado: false });
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    const controlador = crearControlador({
      obtenerUrlOriginal,
      tileSigueEnMapa: (tile) => tile !== tilePodado,
    });

    controlador.onTileError(tilePodado, COORDS);
    // `obtenerUrlOriginal` sí se invoca en `onTileError` (calcula y congela 'urlBase' apenas
    // falla, ver el comentario grande en route-map-html.ts) — eso es solo construir un string, sin
    // ningún costo de red. Lo que nunca pasa para un tile podado es la reasignación de `tile.src`
    // en el tick de reintento, que sí dispararía una descarga real.
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    // Se descartó sin reintentar de verdad — ya no está en el mapa, reintentarlo sería red
    // desperdiciada. `tile.src` queda intacto (nunca se le asignó nada).
    expect(tilePodado.src).toBe('');
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(1); // sin una segunda invocación en el tick

    // Era el único pendiente: el temporizador se apagó solo. Confirmarlo agregando un tile nuevo
    // y viendo que el próximo tick vuelve a arrancar desde cero (si el timer hubiera seguido
    // corriendo con un intervalo desalineado, este tile se reintentaría antes de tiempo).
    const tileNuevo = crearTileFalso();
    controlador.onTileError(tileNuevo, COORDS);
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(2); // urlBase del tile nuevo, calculada ahora
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS - 1);
    expect(tileNuevo.src).toBe('');
    vi.advanceTimersByTime(1);
    expect(tileNuevo.src).toContain(URL_ORIGINAL);
    // El tick de retry reusa la urlBase ya calculada — no vuelve a invocar obtenerUrlOriginal.
    expect(obtenerUrlOriginal).toHaveBeenCalledTimes(2);
  });

  // Hallazgo del code-review de esta entrega: OSM tile.openstreetmap.org es el servidor de
  // demostración de OSM (ver el AVISO DE RIESGO en route-map-html.ts) — sin ningún tope, un
  // bloqueo sostenido hacía que CADA tile visible se re-pidiera cada `reintentoIntervaloMs` PARA
  // SIEMPRE, agravando el bloqueo. Estos dos tests cubren el tope: backoff exponencial (la espera
  // entre reintentos sucesivos del MISMO tile se duplica) y abandono definitivo tras
  // `maxIntentos`.
  it('duplica la espera entre reintentos sucesivos del mismo tile (backoff exponencial)', () => {
    const tile = crearTileFalso();
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    const controlador = crearControlador({ obtenerUrlOriginal });

    controlador.onTileError(tile, COORDS);

    // Tick 1: primer reintento — igual que antes de este fix, no espera más de un tick.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    const srcTrasIntento1 = tile.src;
    expect(srcTrasIntento1).toContain(URL_ORIGINAL);

    // Tick 2: la espera para el SEGUNDO intento se duplicó a 2 ticks — todavía no le toca, no se
    // vuelve a tocar tile.src en este tick.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    expect(tile.src).toBe(srcTrasIntento1);

    // Tick 3: se cumplieron los 2 ticks de espera del segundo intento — reintenta de nuevo.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    expect(tile.src).not.toBe(srcTrasIntento1);
    expect(tile.src).toContain(URL_ORIGINAL);
  });

  it('abandona un tile tras agotar maxIntentos — deja de reintentarlo aunque la falla persista, y el temporizador se apaga', () => {
    const tile = crearTileFalso();
    const obtenerUrlOriginal = vi.fn(() => URL_ORIGINAL);
    // esperaMaximaTicks: 1 anula el backoff (siempre 1 tick de espera) para poder agotar
    // maxIntentos en pocos ticks, sin que el crecimiento del backoff complique el cálculo.
    const controlador = crearControlador({ obtenerUrlOriginal, maxIntentos: 2, esperaMaximaTicks: 1 });

    controlador.onTileError(tile, COORDS);

    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS); // intento 1 de 2
    const srcTrasIntento1 = tile.src;
    expect(srcTrasIntento1).toContain(URL_ORIGINAL);

    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS); // intento 2 de 2 (llega al tope)
    const srcTrasIntento2 = tile.src;
    expect(srcTrasIntento2).not.toBe(srcTrasIntento1);

    // Se agotaron los 2 intentos permitidos: el próximo tick abandona el tile en vez de
    // reintentarlo — tile.src queda como estaba tras el segundo intento, sin importar cuántos
    // ticks más pasen.
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS * 10);
    expect(tile.src).toBe(srcTrasIntento2);

    // Al abandonarlo, la lista de pendientes queda vacía y el temporizador se apaga — un tile
    // NUEVO que falla arranca su propio contador de intentos desde cero, sin heredar nada del
    // anterior.
    const tileNuevo = crearTileFalso();
    controlador.onTileError(tileNuevo, COORDS);
    vi.advanceTimersByTime(REINTENTO_INTERVALO_MS);
    expect(tileNuevo.src).toContain(URL_ORIGINAL);
  });
});

// GAP 1 de la verificación `verify-fix` de Codex sobre el commit anterior de esta entrega:
// congelar 'urlBase' en onTileError (describe de arriba) no alcanza si la función que arma esa
// URL sigue delegando en `tileLayer.getTileUrl(coords)` — esa función de Leaflet 1.9.4 usa el
// zoom ACTUAL de la capa (`this._getZoomForUrl()`), no `coords.z`, y ese zoom puede haber
// cambiado YA para cuando llega el PRIMER `tileerror` de un tile (Leaflet actualiza `_tileZoom`
// antes de que `_abortLoading` pueda descartar la imagen fallida). Este describe ejercita
// `construirUrlTileZoomExacto` — la función real que reemplaza a `tileLayer.getTileUrl` en
// `obtenerUrlOriginal` (ver el comentario grande sobre `CONSTRUIR_URL_TILE_JS_SOURCE` en
// route-map-html.ts) — evaluando el MISMO string que `construirHtml` interpola, nunca una
// reimplementación TS paralela.
describe('construirUrlTileZoomExacto — arma la URL del reintento con coords.z explícito (GAP 1 de verify-fix)', () => {
  const CAPA_OSM: DescripcionCapaTilesXYZ = {
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    zoomOffset: 0,
    zoomReverse: false,
    maxZoom: 19,
    subdominios: [],
  };

  it('arma la URL con coords.x/y/z tal cual, sin subdominios ni offset', () => {
    const construirUrlTile = instanciarConstructorUrlTile();
    expect(construirUrlTile({ x: 300, y: 400, z: 10 }, CAPA_OSM)).toBe(
      'https://tile.openstreetmap.org/10/300/400.png',
    );
  });

  it('respeta zoomOffset y zoomReverse cuando la capa los define', () => {
    const construirUrlTile = instanciarConstructorUrlTile();
    const capaConOffset: DescripcionCapaTilesXYZ = { ...CAPA_OSM, zoomOffset: 1 };
    expect(construirUrlTile({ x: 1, y: 2, z: 10 }, capaConOffset)).toBe(
      'https://tile.openstreetmap.org/11/1/2.png',
    );

    const capaConReverse: DescripcionCapaTilesXYZ = {
      ...CAPA_OSM,
      zoomReverse: true,
      maxZoom: 19,
    };
    // zoomReverse: z_url = maxZoom - coords.z = 19 - 10 = 9.
    expect(construirUrlTile({ x: 1, y: 2, z: 10 }, capaConReverse)).toBe(
      'https://tile.openstreetmap.org/9/1/2.png',
    );
  });

  it('normaliza x fuera de rango [0, 2^z) para el wrap horizontal', () => {
    const construirUrlTile = instanciarConstructorUrlTile();
    // z = 3 → 8 columnas de tiles (0..7). x = -1 envuelve a 7; x = 8 envuelve a 0.
    expect(construirUrlTile({ x: -1, y: 5, z: 3 }, CAPA_OSM)).toBe(
      'https://tile.openstreetmap.org/3/7/5.png',
    );
    expect(construirUrlTile({ x: 8, y: 5, z: 3 }, CAPA_OSM)).toBe(
      'https://tile.openstreetmap.org/3/0/5.png',
    );
    // y NUNCA se normaliza (esta capa no tiene wrap vertical) — el x fuera de rango no debe
    // tocarlo.
    expect(construirUrlTile({ x: 8, y: -3, z: 3 }, CAPA_OSM)).toBe(
      'https://tile.openstreetmap.org/3/0/-3.png',
    );
  });

  it('selecciona un subdominio de la capa cuando la plantilla tiene {s}', () => {
    const construirUrlTile = instanciarConstructorUrlTile();
    const capaConSubdominios: DescripcionCapaTilesXYZ = {
      urlTemplate: 'https://{s}.tile.example.com/{z}/{x}/{y}.png',
      zoomOffset: 0,
      zoomReverse: false,
      maxZoom: 19,
      subdominios: ['a', 'b', 'c'],
    };
    const url = construirUrlTile({ x: 300, y: 400, z: 10 }, capaConSubdominios);
    expect(url).toMatch(/^https:\/\/[abc]\.tile\.example\.com\/10\/300\/400\.png$/);
  });

  // Bug real, GAP 1 del verify-fix: este es el escenario exacto que congelar 'urlBase' en
  // onTileError (por sí solo) NO cubre. El tile se pidió y falló a zoom 10; el chofer hace zoom
  // in a 16 ANTES de que Leaflet entregue el evento 'tileerror' para ESE tile (el `_tileZoom` de
  // la capa ya cambió). Con `tileLayer.getTileUrl(coords)` la URL armada en el propio onTileError
  // ya habría salido mal (con '/16/'), porque esa función ignora coords.z y usa el zoom actual de
  // la capa. `construirUrlTileZoomExacto`, en cambio, nunca lee ningún "zoom actual" — arma la URL
  // solo a partir de `coords.z` y de la descripción ESTÁTICA de la capa, así que el resultado es
  // correcto sin importar cuándo llegue el evento.
  it('el tile se pidió y falló a zoom 10, la capa ya está en zoom 16 cuando llega el PRIMER tileerror: el reintento conserva z=10', () => {
    vi.useFakeTimers();
    try {
      const construirUrlTile = instanciarConstructorUrlTile();
      const tile = crearTileFalso();
      // Exactamente como lo arma construirHtml: obtenerUrlOriginal delega en
      // construirUrlTileZoomExacto, nunca en tileLayer.getTileUrl — no hay ninguna variable de
      // "zoom actual de la capa" de la que depender acá, ni siquiera en el primer tileerror.
      const controlador = instanciarControladorTiles({
        errorTileUrl: 'data:image/gif;base64,ERROR',
        reintentoIntervaloMs: 30000,
        obtenerUrlOriginal: (coords) => construirUrlTile(coords, CAPA_OSM),
        tileSigueEnMapa: () => true,
      });

      // El tile falla a zoom 10 — sin importar que, para cuando Leaflet dispara este evento, el
      // mapa ya haya cambiado de zoom (eso es justamente lo que este test simula: la llamada a
      // onTileError llega "tarde", después del cambio de zoom, pero coords.z sigue siendo 10, el
      // zoom real al que se pidió este tile).
      controlador.onTileError(tile, { x: 300, y: 400, z: 10 });
      vi.advanceTimersByTime(30000);

      expect(tile.src).toContain('/10/300/400.png');
      expect(tile.src).not.toContain('/16/');
    } finally {
      vi.useRealTimers();
    }
  });

  // Complementa el test de "tile podado" del describe de crearControladorTiles (misma mecánica),
  // pero acá con construirUrlTileZoomExacto real de por medio: un tile que salió del DOM entre el
  // fallo y el tick de reintento no debe tocar tile.src ni tirar, aunque la URL congelada ya esté
  // calculada.
  it('un tile desmontado del DOM antes del tick de reintento no rompe y no le toca tile.src', () => {
    vi.useFakeTimers();
    try {
      const construirUrlTile = instanciarConstructorUrlTile();
      const tile = crearTileFalso({ montado: false });
      const controlador = instanciarControladorTiles({
        errorTileUrl: 'data:image/gif;base64,ERROR',
        reintentoIntervaloMs: 30000,
        obtenerUrlOriginal: (coords) => construirUrlTile(coords, CAPA_OSM),
        tileSigueEnMapa: () => false,
      });

      expect(() => controlador.onTileError(tile, { x: 300, y: 400, z: 10 })).not.toThrow();
      expect(() => vi.advanceTimersByTime(30000)).not.toThrow();
      expect(tile.src).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('construirHtml — cero dependencia de red para inicializar el mapa', () => {
  const html = construirHtml(paqueteDePrueba(), vehiculoDePrueba);

  it('no referencia ningún <script src="https://..."> (Leaflet ya no viene de unpkg)', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc\s*=\s*["']https?:/i);
  });

  it('no referencia ningún <link ... href="https://..."> (leaflet.css ya no viene de unpkg)', () => {
    expect(html).not.toMatch(/<link[^>]*\shref\s*=\s*["']https?:/i);
  });

  it('no queda ninguna referencia a unpkg.com', () => {
    expect(html).not.toContain('unpkg.com');
  });

  it('embebe el fuente de Leaflet inline dentro de un <script> sin src', () => {
    // El comentario "@preserve" con la licencia solo puede estar ahí si el .js completo de
    // Leaflet quedó inyectado como texto dentro del documento.
    expect(html).toContain('Leaflet 1.9.4');
    expect(html).toContain('@preserve');
  });

  it('conserva el aviso de copyright BSD-2-Clause de Leaflet', () => {
    expect(html).toMatch(/\(c\)\s*2010-2023\s*Vladimir Agafonkin/);
  });

  it('embebe el CSS de Leaflet inline (clases base .leaflet-pane / .leaflet-container)', () => {
    expect(html).toContain('.leaflet-pane');
    expect(html).toContain('.leaflet-container');
  });

  it('los tiles remotos de OpenStreetMap SÍ pueden quedar (son opcionales, con fallback)', () => {
    expect(html).toContain('tile.openstreetmap.org');
  });

  it('tiene el fondo liso de fallback (#F4F6F8) para cuando no hay tiles', () => {
    expect(html).toContain('#F4F6F8');
  });

  it('maneja tileerror para reintentar tiles fallidos, sin retirar nunca la capa completa', () => {
    expect(html).toContain("tileLayer.on('tileerror'");
    expect(html).toContain('controladorTiles.onTileError');
    // Guarda mecánica del hallazgo del code-review: la capa de tiles jamás se retira del mapa —
    // si alguien reintrodujera la lógica de remoción, este assert lo detecta.
    expect(html).not.toContain('map.removeLayer(tileLayer)');
  });

  it('deja el punto de extensión comentado para el cache de tiles de la Entrega 27', () => {
    expect(html).toContain('Entrega 27');
  });

  it('fija un view inicial (map.setView) antes de agregar tiles/polyline/marcadores', () => {
    // Hallazgo 2 del code-review: el comentario decía que esto existía y no era cierto. Ahora
    // sí hay un setView real, antes de tileLayer.addTo/L.polyline — ver el comentario en
    // route-map-html.ts para el mecanismo (capas agregadas sin view definido se posicionan mal
    // hasta el próximo viewreset).
    const idxSetView = html.indexOf('map.setView(');
    const idxTileLayerAddTo = html.indexOf('tileLayer.addTo(map)');
    expect(idxSetView).toBeGreaterThan(-1);
    expect(idxTileLayerAddTo).toBeGreaterThan(-1);
    expect(idxSetView).toBeLessThan(idxTileLayerAddTo);
  });

  it('embebe crearControladorTiles (el reintento de tiles fallidos) dentro del script', () => {
    expect(html).toContain('function crearControladorTiles');
    expect(html).toContain('controladorTiles.onTileLoad');
    expect(html).toContain('controladorTiles.onTileError');
  });

  it('la polyline de la ruta usa coordenadas ya convertidas a [lat, lng]', () => {
    // El primer punto de la ruta de prueba es GeoJSON [-66.1568, -17.3895] → Leaflet
    // [-17.3895, -66.1568]. Si hubiera un cruce de formato, este valor aparecería invertido.
    expect(html).toContain('[-17.3895,-66.1568]');
  });

  // Hallazgo 1 del code-review (crítico): el HTML nunca puede depender de
  // `Function.prototype.toString()` para inyectar código en el WebView — ver el comentario largo
  // sobre `CONTROLADOR_TILES_JS_SOURCE` en route-map-html.ts para el porqué completo (minificador
  // de Metro renombra símbolos, Hermes compila a bytecode). Este test es la guarda mecánica: si
  // alguien vuelve a escribir `${algo.toString()}` en el HTML, esto lo detecta sin necesidad de
  // exportar un bundle de release.
  it('el HTML generado no contiene .toString() de ninguna función del bundle', () => {
    expect(html).not.toContain('.toString()');
  });

  // Entrega 31b (defecto post-piloto): construirHtml YA NO recibe proximoPuntoControlId — ver el
  // comentario grande sobre esta función en route-map-html.ts. Este test es la guarda: el próximo
  // punto de control arranca SIEMPRE en null dentro del script (nunca horneado), y se entera del
  // valor real por postMessage. Si alguien reintrodujera un tercer parámetro y volviera a
  // hornearlo acá, este test lo detecta.
  it('nunca hornea el próximo punto de control — el script arranca con proximoPuntoIdActual = null', () => {
    expect(html).toContain('var proximoPuntoIdActual = null;');
  });

  // Corolario directo de lo anterior: dado que el HTML ya no depende de qué punto de control es
  // el próximo, dos llamadas a construirHtml con el mismo paquete/vehículo producen EXACTAMENTE
  // el mismo string — la propiedad que el useMemo de route-map-view.tsx necesita para no
  // recalcular (y por lo tanto no recargar la WebView) cuando lo único que cambió fue el próximo
  // punto de control.
  it('es determinístico para el mismo paquete y vehículo (dos llamadas producen el mismo HTML)', () => {
    const htmlA = construirHtml(paqueteDePrueba(), vehiculoDePrueba);
    const htmlB = construirHtml(paqueteDePrueba(), vehiculoDePrueba);
    expect(htmlA).toBe(htmlB);
  });

  // Entrega 25/31b (handshake mapa-listo): guarda mecánica del texto — el comportamiento real
  // (que se manda DESPUÉS de registrar los listeners) lo cubre el test end-to-end con `vm` más
  // abajo en este archivo.
  it('emite el handshake mapa-listo por ReactNativeWebView.postMessage', () => {
    expect(html).toContain("window.ReactNativeWebView");
    expect(html).toContain("type: 'mapa-listo'");
  });

  it('el handshake mapa-listo aparece en el texto DESPUÉS de registrar los listeners de message', () => {
    const idxListenerMessage = html.indexOf("window.addEventListener('message'");
    const idxMapaListo = html.indexOf("type: 'mapa-listo'");
    expect(idxListenerMessage).toBeGreaterThan(-1);
    expect(idxMapaListo).toBeGreaterThan(-1);
    expect(idxMapaListo).toBeGreaterThan(idxListenerMessage);
  });
});

/**
 * Hallazgo 1 del code-review (crítico) — EL TEST QUE HABRÍA DETECTADO EL BUG DE RELEASE.
 *
 * Antes, `construirHtml` embebía `crearControladorTiles` con `${crearControladorTiles
 * .toString()}`. Ningún test corría ese `<script>` de verdad — solo se buscaba el texto
 * `'function crearControladorTiles'` en el HTML (ver el test de arriba "embebe
 * crearControladorTiles..."), y ESE texto seguía apareciendo bien en vitest porque vitest no
 * minifica ni compila a bytecode. El bug (Metro renombra la función en release; el HTML la sigue
 * llamando por su nombre viejo → `ReferenceError` que corta TODO el `<script>`) era invisible
 * para cualquier test que solo mirara el string del HTML sin ejecutarlo.
 *
 * Este describe cierra ese agujero: toma el `<script>` de aplicación tal cual lo genera
 * `construirHtml` (el HTML real, no una reimplementación) y lo corre de punta a punta con
 * `node:vm`, con un `L` (Leaflet) falso mínimo y un `document`/`window` falsos. Si el HTML
 * tuviera hoy el bug de `.toString()` — o cualquier otro `ReferenceError`/`TypeError` al cargar
 * — este test tiraría al ejecutar `vm.runInContext`. No necesita jsdom (no está instalado en
 * este monorepo): un `L` falso a mano alcanza porque lo único que hace falta comprobar es que el
 * script CORRE sin tirar y llega a dibujar la polyline, los marcadores y a llamar `fitBounds` —
 * no el renderizado visual real de Leaflet (eso ya lo cubre Leaflet mismo, es una librería de
 * terceros con sus propios tests).
 */
describe('construirHtml — el <script> generado corre de punta a punta sin tirar (Hallazgo 1)', () => {
  /** Extrae el texto entre el ÚLTIMO `<script>` y su `</script>` — el HTML tiene exactamente dos
   * `<script>`: el primero es LEAFLET_JS_INLINE (Leaflet real, no lo corremos acá porque necesita
   * un DOM completo de verdad, eso ya lo prueba la librería); el segundo es el código propio de
   * la app, el que este describe ejercita. Se ubica por posición (el último) en vez de por un
   * marcador de texto para no depender de comentarios que puedan cambiar de redacción. */
  function extraerScriptDeAplicacion(htmlGenerado: string): string {
    const inicio = htmlGenerado.lastIndexOf('<script>');
    const fin = htmlGenerado.indexOf('</script>', inicio);
    if (inicio === -1 || fin === -1) {
      throw new Error('No se encontró el <script> de la aplicación en el HTML generado.');
    }
    return htmlGenerado.slice(inicio + '<script>'.length, fin);
  }

  /** Fábrica de capas Leaflet falsas (tileLayer/polyline/marker/divIcon): todas soportan
   * `.addTo(mapa)` (se registran en `mapa.capas`), `.on(evento, cb)` — guardando el callback en
   * `capa.callbacks[evento]` para poder disparar `tileload`/`tileerror` a mano en los tests de
   * integración del reintento de tiles — y los demás métodos/propiedades que `route-map-html.ts`
   * invoca sobre ellas (`setStyle`, `setIcon`, `setLatLng`, `getLatLng`, `getBounds`,
   * `bringToFront`, `options`) — sin implementar nada de geometría real, solo lo mínimo para que
   * el script corra sin `TypeError: x is not a function`.
   *
   * `capa.options` replica lo que Leaflet real deja en `layer.options` tras `initialize` (el
   * `opts` con el que se llamó al constructor) — desde el GAP 1 de la verificación `verify-fix`
   * de Codex, `route-map-html.ts` lee `tileLayer.options.zoomOffset/zoomReverse/maxZoom/
   * subdomains` para reconstruir la URL de un tile a mano (`construirUrlTileZoomExacto`), en vez
   * de `tileLayer.getTileUrl(coords)` — ver el comentario grande sobre
   * `CONSTRUIR_URL_TILE_JS_SOURCE` en route-map-html.ts para el porqué completo. Ya NO se
   * implementa `getTileUrl` acá: la producción no la llama más para el reintento. */
  function crearCapaLeafletFalsa(tipo: string, args: unknown) {
    const callbacks: Record<string, (evento: unknown) => void> = {};
    const capa: Record<string, unknown> = {
      tipo,
      args,
      handlersRegistrados: [] as string[],
      callbacks,
      options: (args as { opts?: Record<string, unknown> } | undefined)?.opts ?? {},
    };
    capa.addTo = (mapaFalso: { capas: unknown[] }) => {
      mapaFalso.capas.push(capa);
      return capa;
    };
    capa.on = (evento: string, cb: (evento: unknown) => void) => {
      (capa.handlersRegistrados as string[]).push(evento);
      callbacks[evento] = cb;
      return capa;
    };
    capa.setStyle = () => capa;
    capa.setIcon = () => capa;
    capa.setLatLng = () => capa;
    capa.getLatLng = () => ({ lat: -17.38, lng: -66.15 });
    capa.getBounds = () => 'bounds-falso';
    capa.bringToFront = () => capa;
    return capa;
  }

  /** Fábrica de `L` (Leaflet) falso — ver doc del describe para por qué no hace falta jsdom ni
   * el Leaflet real acá. */
  function crearLFalso() {
    return {
      map: () => {
        const mapaFalso = {
          capas: [] as unknown[],
          fitBoundsLlamadas: 0,
          flyToLlamadas: 0,
          setViewLlamadas: 0,
          setView() {
            mapaFalso.setViewLlamadas += 1;
            return mapaFalso;
          },
          on() {
            return mapaFalso;
          },
          flyTo() {
            mapaFalso.flyToLlamadas += 1;
            return mapaFalso;
          },
          fitBounds() {
            mapaFalso.fitBoundsLlamadas += 1;
            return mapaFalso;
          },
          removeLayer(capa: unknown) {
            mapaFalso.capas = mapaFalso.capas.filter((c) => c !== capa);
            return mapaFalso;
          },
        };
        return mapaFalso;
      },
      tileLayer: (url: string, opts: unknown) => crearCapaLeafletFalsa('tileLayer', { url, opts }),
      polyline: (coords: unknown, opts: unknown) => crearCapaLeafletFalsa('polyline', { coords, opts }),
      marker: (latlng: unknown, opts: unknown) => crearCapaLeafletFalsa('marker', { latlng, opts }),
      divIcon: (opts: unknown) => ({ tipo: 'divIcon', opts }),
    };
  }

  it('corre sin tirar y dibuja la polyline, los puntos de control y llama fitBounds', () => {
    const html = construirHtml(paqueteDePrueba(), vehiculoDePrueba);
    const scriptAplicacion = extraerScriptDeAplicacion(html);

    // Orden de eventos compartido entre el registro de listeners y el postMessage de mapa-listo —
    // sirve para el aserto de la Entrega 25/31b más abajo: mapa-listo tiene que salir DESPUÉS de
    // que los listeners de 'message' ya estén registrados, nunca antes.
    const ordenDeEventos: string[] = [];
    const listenersRegistrados: Array<{ objeto: string; evento: string }> = [];
    const mensajesAReactNative: string[] = [];
    const sandbox: Record<string, unknown> = {
      L: crearLFalso(),
      document: {
        addEventListener: (evento: string) => {
          listenersRegistrados.push({ objeto: 'document', evento });
          ordenDeEventos.push('listener:document:' + evento);
        },
      },
      window: {
        addEventListener: (evento: string) => {
          listenersRegistrados.push({ objeto: 'window', evento });
          ordenDeEventos.push('listener:window:' + evento);
        },
        ReactNativeWebView: {
          postMessage: (data: string) => {
            mensajesAReactNative.push(data);
            ordenDeEventos.push('postMessage:' + data);
          },
        },
      },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };
    vm.createContext(sandbox);

    // ESTE es el test que habría detectado el bug de release: si `construirHtml` volviera a
    // depender de `.toString()` sobre una función renombrada por un minificador (no es el caso
    // acá, vitest no minifica — pero cualquier otro `ReferenceError` real del script, como el
    // que causaba el bug en producción, tira acá igual).
    expect(() => {
      vm.runInContext(scriptAplicacion, sandbox);
    }).not.toThrow();

    const mapaFalso = sandbox.map as {
      capas: Array<{ tipo: string }>;
      fitBoundsLlamadas: number;
    };

    // Polyline de la ruta: dibujada y agregada al mapa.
    expect(mapaFalso.capas.some((c) => c.tipo === 'polyline')).toBe(true);
    // Puntos de control de la ruta de prueba (2): cada uno es un marker agregado al mapa.
    expect(mapaFalso.capas.filter((c) => c.tipo === 'marker')).toHaveLength(2);
    // fitBounds corre síncronamente al final del script (ajusta el view inicial provisorio).
    expect(mapaFalso.fitBoundsLlamadas).toBeGreaterThanOrEqual(1);
    // Los listeners de mensajes del WebView (por donde llegan las posiciones GPS) quedaron
    // registrados — si el script se hubiera cortado antes por un throw, esto nunca pasaría.
    expect(listenersRegistrados).toEqual(
      expect.arrayContaining([
        { objeto: 'document', evento: 'message' },
        { objeto: 'window', evento: 'message' },
      ]),
    );

    // Entrega 25/31b (handshake mapa-listo): el script manda mapa-listo por
    // window.ReactNativeWebView.postMessage — la señal real que RN escucha en `onMessage`
    // (route-map-view.tsx) para recién ahí mandar el estado completo, sin depender de un
    // `onLoadEnd` que podría llegar antes de que estos listeners existieran.
    expect(mensajesAReactNative).toContain(JSON.stringify({ type: 'mapa-listo' }));
    // Y el orden importa: el handshake se manda DESPUÉS de registrar los listeners de 'message',
    // nunca antes — si se mandara antes, RN podría responder con el estado completo antes de que
    // el script esté listo para procesarlo (aunque en este mock no hay una race real, el orden en
    // el texto/ejecución es lo que garantiza que en el WebView real no la haya).
    const idxListenerWindowMessage = ordenDeEventos.indexOf('listener:window:message');
    const idxMapaListo = ordenDeEventos.indexOf('postMessage:' + JSON.stringify({ type: 'mapa-listo' }));
    expect(idxListenerWindowMessage).toBeGreaterThan(-1);
    expect(idxMapaListo).toBeGreaterThan(-1);
    expect(idxMapaListo).toBeGreaterThan(idxListenerWindowMessage);
  });

  // Decisión del chairman (2026-09-11): el mecanismo anterior retiraba la capa COMPLETA de tiles
  // a los 4s de un tileerror sin tileload real después — con cobertura completa, si el ÚLTIMO
  // tile pendiente fallaba (timeout suelto, 429 del servidor de demo de OSM), eso borraba los
  // tiles que sí habían cargado, dejando el mapa liso con la red funcionando. Este test corre el
  // `<script>` real de `construirHtml` (no una reimplementación) y dispara los callbacks
  // 'tileload'/'tileerror' que el propio script registró sobre `tileLayer` — si alguien
  // reintrodujera `map.removeLayer(tileLayer)`, este test lo detecta.
  it('N tiles cargan y el último falla: la capa de tiles nunca se retira, sea cual sea el resultado del último tile', () => {
    vi.useFakeTimers();
    try {
      const html = construirHtml(paqueteDePrueba(), vehiculoDePrueba);
      const scriptAplicacion = extraerScriptDeAplicacion(html);

      const sandbox: Record<string, unknown> = {
        L: crearLFalso(),
        document: { addEventListener: () => {} },
        window: { addEventListener: () => {} },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
      };
      vm.createContext(sandbox);
      vm.runInContext(scriptAplicacion, sandbox);

      type CapaFalsa = { tipo: string; callbacks: Record<string, (evento: unknown) => void> };
      const mapaFalso = sandbox.map as { capas: CapaFalsa[] };
      const tileLayerCapa = mapaFalso.capas.find((c) => c.tipo === 'tileLayer');
      expect(tileLayerCapa).toBeDefined();

      // 11 tiles reales cargan — cobertura completa salvo por el último tile pendiente.
      for (let i = 0; i < 11; i++) {
        tileLayerCapa!.callbacks.tileload!({ tile: { src: `https://tile.openstreetmap.org/10/${i}/1.png` } });
      }
      // El último tile pendiente falla.
      tileLayerCapa!.callbacks.tileerror!({ tile: { src: '' }, coords: { x: 11, y: 1, z: 10 } });
      // Le da tiempo de sobra a cualquier temporizador de remoción que pudiera haber quedado (la
      // versión anterior removía a los 4s) — con el mecanismo actual no debería pasar nada.
      vi.advanceTimersByTime(60000);

      // La capa sigue montada en el mapa — nunca se llamó map.removeLayer(tileLayer).
      expect(mapaFalso.capas).toContain(tileLayerCapa);
    } finally {
      vi.useRealTimers();
    }
  });

  // GAP 1 del verify-fix de Codex, ejercitado de punta a punta con el <script> real (no una
  // reimplementación): antes de este fix, `obtenerUrlOriginal` llamaba `tileLayer.getTileUrl
  // (coords)`; el mock de este describe ni siquiera exponía `tileLayer.options`
  // (zoomOffset/zoomReverse/maxZoom/subdomains), así que si la producción hubiera seguido
  // dependiendo de eso sin `construirUrlTileZoomExacto`, este test habría tirado
  // `TypeError: Cannot read properties of undefined` al leer `tileLayer.options.zoomOffset`. Este
  // test corre el <script> real, dispara un `tileerror` con `coords.z = 10` y confirma que la URL
  // reintentada conserva ese `10` — armada por `construirUrlTileZoomExacto` a partir de
  // `tileLayer.options` (ver `crearCapaLeafletFalsa`), nunca de un "zoom actual" que este mock no
  // modela (el mismo motivo por el que `tileLayer.getTileUrl` ya no se usa en producción).
  it('el reintento de un tile fallido arma la URL con coords.z explícito, vía tileLayer.options (no tileLayer.getTileUrl)', () => {
    vi.useFakeTimers();
    try {
      const html = construirHtml(paqueteDePrueba(), vehiculoDePrueba);
      const scriptAplicacion = extraerScriptDeAplicacion(html);

      const sandbox: Record<string, unknown> = {
        L: crearLFalso(),
        document: { addEventListener: () => {} },
        window: { addEventListener: () => {} },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
      };
      vm.createContext(sandbox);
      vm.runInContext(scriptAplicacion, sandbox);

      type CapaFalsa = { tipo: string; callbacks: Record<string, (evento: unknown) => void> };
      const mapaFalso = sandbox.map as { capas: CapaFalsa[] };
      const tileLayerCapa = mapaFalso.capas.find((c) => c.tipo === 'tileLayer');
      expect(tileLayerCapa).toBeDefined();

      const tileFalso = { src: '', parentNode: {} };
      tileLayerCapa!.callbacks.tileerror!({ tile: tileFalso, coords: { x: 300, y: 400, z: 10 } });
      vi.advanceTimersByTime(30000);

      expect(tileFalso.src).toContain('/10/300/400.png');

      // Guarda mecánica del hallazgo: si alguien reintrodujera la delegación en
      // tileLayer.getTileUrl(coords) como código real (no en un comentario explicativo), este
      // assert lo detecta sin depender de que el mock rompa.
      expect(scriptAplicacion).not.toContain('return tileLayer.getTileUrl(coords)');
    } finally {
      vi.useRealTimers();
    }
  });

  // Entrega 31b (defecto post-piloto) — el test central del fix: el mensaje 'proximoPuntoControl'
  // tiene que reestilizar el marcador correcto (el punto que quedó atrás pasa a "completed") SIN
  // volver a llamar L.map en ningún momento. Antes de este fix, cambiar el próximo punto de
  // control recargaba TODO el HTML de la WebView — lo que en este arnés equivaldría a que
  // `construirHtml` generara un `<script>` distinto y, si lo corriéramos de nuevo, L.map se
  // llamara una segunda vez. Acá se corre el `<script>` UNA sola vez y se le mandan mensajes
  // postMessage sucesivos, tal como pasa en la WebView real durante toda la vida del componente.
  it('el mensaje proximoPuntoControl reestiliza el marcador correcto y no vuelve a crear el mapa (L.map una sola vez)', () => {
    const paquete = paqueteDePrueba();
    const idPrimerPunto = paquete.puntosControl[0]!.id;
    const idSegundoPunto = paquete.puntosControl[1]!.id;
    const html = construirHtml(paquete, vehiculoDePrueba);
    const scriptAplicacion = extraerScriptDeAplicacion(html);

    const lFalso = crearLFalso();
    let mapCalls = 0;
    const mapOriginal = lFalso.map;
    // crearLFalso().map no usa sus argumentos (el script real le pasa ('map', opts), pero la
    // fábrica los ignora) — el wrapper tampoco necesita reenviarlos, solo contar invocaciones.
    lFalso.map = () => {
      mapCalls += 1;
      return mapOriginal();
    };

    let handlerMensajeWindow: ((event: { data: string }) => void) | undefined;
    const sandbox: Record<string, unknown> = {
      L: lFalso,
      document: { addEventListener: () => {} },
      window: {
        addEventListener: (evento: string, cb: (event: { data: string }) => void) => {
          if (evento === 'message') handlerMensajeWindow = cb;
        },
      },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptAplicacion, sandbox);

    expect(mapCalls).toBe(1);
    expect(handlerMensajeWindow).toBeTypeOf('function');

    // seguimientoActivo = true: necesario para que "isPassed" (renderizarPuntosControl) tenga
    // algo que distinguir — sin tracking activo ningún punto se marca "completed" nunca, por
    // diseño (ver el comentario de renderizarPuntosControl en route-map-html.ts).
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'tracking', active: true }) });
    // El próximo punto de control pasa a ser el segundo: el primero queda "atrás" (completed).
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'proximoPuntoControl', id: idSegundoPunto }) });

    // La aserción central del fix: seguimos en el mismo mapa, nunca se reinicializó Leaflet.
    expect(mapCalls).toBe(1);

    type MarkerFalso = { tipo: string; args: { opts: { icon: { opts: { html: string } } } } };
    const mapaFalso = sandbox.map as { capas: MarkerFalso[] };
    const markers = mapaFalso.capas.filter((c) => c.tipo === 'marker');
    expect(markers).toHaveLength(2);

    const htmlPrimerMarker = markers[0]!.args.opts.icon.opts.html;
    const htmlSegundoMarker = markers[1]!.args.opts.icon.opts.html;
    expect(htmlPrimerMarker).toContain('completed');
    expect(htmlSegundoMarker).not.toContain('completed');

    // Y al revés: si el próximo vuelve a ser el primer punto (p. ej. la app se reconstruyó el
    // estado), el reestilizado responde igual, sin recrear el mapa.
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'proximoPuntoControl', id: idPrimerPunto }) });
    expect(mapCalls).toBe(1);
    const markersTrasSegundoMensaje = mapaFalso.capas.filter((c) => c.tipo === 'marker');
    expect(markersTrasSegundoMensaje).toHaveLength(2);
    expect(markersTrasSegundoMensaje[0]!.args.opts.icon.opts.html).not.toContain('completed');
  });

  // Hallazgo del code-review de esta entrega: `route-map-view.tsx` manda 'tracking' Y
  // 'proximoPuntoControl' juntos en CADA cambio de props — incluida cada actualización de
  // posición GPS, porque `posicionActual` está en las dependencias del `useEffect` que dispara el
  // envío (ver `enviarEstadoCompleto` en route-map-view.tsx). Antes de este fix, cada mensaje
  // 'tracking'/'proximoPuntoControl' llamaba `renderizarPuntosControl()` incondicionalmente —
  // aunque ni el estado de seguimiento ni el próximo punto de control hubieran cambiado — así que
  // un solo fix de GPS reconstruía TODOS los marcadores de puntos de control dos veces (borra y
  // vuelve a crear con `map.removeLayer`/`L.marker`). Este test corre el `<script>` real y manda
  // la secuencia exacta que produce un fix de GPS (tracking + proximoPuntoControl + position, en
  // ese orden — el mismo de `construirMensajesEstadoMapa`), repetida varias veces con los mismos
  // valores de tracking/próximo punto, y confirma que `L.marker` NUNCA se vuelve a invocar para
  // los puntos de control — solo una vez para el marcador de posición (que sí debe actualizarse).
  it('una actualización de posición (tracking + proximoPuntoControl sin cambios + position) no reconstruye los marcadores de puntos de control', () => {
    const paquete = paqueteDePrueba();
    const html = construirHtml(paquete, vehiculoDePrueba);
    const scriptAplicacion = extraerScriptDeAplicacion(html);

    const lFalso = crearLFalso();
    let markerCalls = 0;
    const markerOriginal = lFalso.marker;
    lFalso.marker = (latlng: unknown, opts: unknown) => {
      markerCalls += 1;
      return markerOriginal(latlng, opts);
    };

    let handlerMensajeWindow: ((event: { data: string }) => void) | undefined;
    const sandbox: Record<string, unknown> = {
      L: lFalso,
      document: { addEventListener: () => {} },
      window: {
        addEventListener: (evento: string, cb: (event: { data: string }) => void) => {
          if (evento === 'message') handlerMensajeWindow = cb;
        },
      },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptAplicacion, sandbox);

    // Los 2 puntos de control de la ruta de prueba se crean al montar el script.
    expect(markerCalls).toBe(2);
    expect(handlerMensajeWindow).toBeTypeOf('function');

    // Primer "fix de GPS": tracking (false, el default, sin cambio), proximoPuntoControl (null,
    // sin cambio) y position — exactamente el orden de `construirMensajesEstadoMapa`.
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'tracking', active: false }) });
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'proximoPuntoControl', id: null }) });
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'position', lat: -17.38, lng: -66.15 }) });

    // +1 por el marcador de POSICIÓN, nuevo (primera vez que se conoce la posición del vehículo)
    // — los de puntos de control no se tocaron.
    expect(markerCalls).toBe(3);

    // Varios fixes de GPS más, todos con el mismo tracking/próximo punto de control: el marcador
    // de posición ya existe (se actualiza con setLatLng, no se vuelve a crear) y los puntos de
    // control tampoco deberían volver a crearse.
    for (let i = 0; i < 5; i++) {
      handlerMensajeWindow!({ data: JSON.stringify({ type: 'tracking', active: false }) });
      handlerMensajeWindow!({ data: JSON.stringify({ type: 'proximoPuntoControl', id: null }) });
      handlerMensajeWindow!({
        data: JSON.stringify({ type: 'position', lat: -17.38 + i * 0.001, lng: -66.15 }),
      });
    }
    expect(markerCalls).toBe(3);
  });
});

// Hallazgo 2 del code-review de esta entrega: `map.fitBounds(ruta.getBounds(), ...)` tira
// ('Bounds are not valid') cuando la ruta no tiene coordenadas — un paquete con geometría vacía
// (dato incompleto/corrupto desde el backend) no debería congelar ni crashear el mapa. Estos tests
// corren el `<script>` real (no una reimplementación) contra un paquete sin coordenadas de ruta,
// ejercitando los 3 call-sites de `ajustarVistaARuta` (el fitBounds inicial, 'tracking' con
// seguimiento apagado, y 'recenter' sin posición conocida).
describe('ajustarVistaARuta — guarda contra fitBounds con una ruta sin coordenadas (Hallazgo 2)', () => {
  function extraerScriptDeAplicacion(htmlGenerado: string): string {
    const inicio = htmlGenerado.lastIndexOf('<script>');
    const fin = htmlGenerado.indexOf('</script>', inicio);
    if (inicio === -1 || fin === -1) {
      throw new Error('No se encontró el <script> de la aplicación en el HTML generado.');
    }
    return htmlGenerado.slice(inicio + '<script>'.length, fin);
  }

  function crearCapaLeafletFalsa(tipo: string, args: unknown) {
    const callbacks: Record<string, (evento: unknown) => void> = {};
    const capa: Record<string, unknown> = {
      tipo,
      args,
      callbacks,
      options: (args as { opts?: Record<string, unknown> } | undefined)?.opts ?? {},
    };
    capa.addTo = (mapaFalso: { capas: unknown[] }) => {
      mapaFalso.capas.push(capa);
      return capa;
    };
    capa.on = (evento: string, cb: (evento: unknown) => void) => {
      callbacks[evento] = cb;
      return capa;
    };
    capa.setStyle = () => capa;
    capa.setIcon = () => capa;
    capa.setLatLng = () => capa;
    capa.getLatLng = () => ({ lat: -17.38, lng: -66.15 });
    capa.getBounds = () => 'bounds-falso';
    capa.bringToFront = () => capa;
    return capa;
  }

  function crearLFalso() {
    return {
      map: () => {
        const mapaFalso = {
          capas: [] as unknown[],
          fitBoundsLlamadas: 0,
          flyToLlamadas: 0,
          setViewLlamadas: 0,
          setView() {
            mapaFalso.setViewLlamadas += 1;
            return mapaFalso;
          },
          on() {
            return mapaFalso;
          },
          flyTo() {
            mapaFalso.flyToLlamadas += 1;
            return mapaFalso;
          },
          fitBounds() {
            mapaFalso.fitBoundsLlamadas += 1;
            return mapaFalso;
          },
          removeLayer(capa: unknown) {
            mapaFalso.capas = mapaFalso.capas.filter((c) => c !== capa);
            return mapaFalso;
          },
        };
        return mapaFalso;
      },
      tileLayer: (url: string, opts: unknown) => crearCapaLeafletFalsa('tileLayer', { url, opts }),
      polyline: (coords: unknown, opts: unknown) => crearCapaLeafletFalsa('polyline', { coords, opts }),
      marker: (latlng: unknown, opts: unknown) => crearCapaLeafletFalsa('marker', { latlng, opts }),
      divIcon: (opts: unknown) => ({ tipo: 'divIcon', opts }),
    };
  }

  function paqueteConRutaVacia(): PaqueteDia {
    const base = paqueteDePrueba();
    return { ...base, ruta: { ...base.ruta, geometria: { type: 'LineString', coordinates: [] } } };
  }

  it('con ruta vacía y sin posición conocida: el fitBounds inicial se salta (no tira) y no toca la vista', () => {
    const html = construirHtml(paqueteConRutaVacia(), vehiculoDePrueba);
    const scriptAplicacion = extraerScriptDeAplicacion(html);

    const sandbox: Record<string, unknown> = {
      L: crearLFalso(),
      document: { addEventListener: () => {} },
      window: { addEventListener: () => {} },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };
    vm.createContext(sandbox);

    expect(() => {
      vm.runInContext(scriptAplicacion, sandbox);
    }).not.toThrow();

    const mapaFalso = sandbox.map as { fitBoundsLlamadas: number; setViewLlamadas: number };
    // El fitBounds del final de construirHtml (ver `ajustarVistaARuta`) nunca se llama sin
    // coordenadas de ruta.
    expect(mapaFalso.fitBoundsLlamadas).toBe(0);
    // setView SÍ se llama una vez — el view inicial de arranque (`map.setView(... : [0,0], 15)`),
    // no un segundo llamado desde `ajustarVistaARuta` (no hay posición conocida todavía).
    expect(mapaFalso.setViewLlamadas).toBe(1);
  });

  it('con ruta vacía pero con posición ya conocida: "tracking" con seguimiento apagado centra en la posición actual en vez de tirar', () => {
    const html = construirHtml(paqueteConRutaVacia(), vehiculoDePrueba);
    const scriptAplicacion = extraerScriptDeAplicacion(html);

    let handlerMensajeWindow: ((event: { data: string }) => void) | undefined;
    const sandbox: Record<string, unknown> = {
      L: crearLFalso(),
      document: { addEventListener: () => {} },
      window: {
        addEventListener: (evento: string, cb: (event: { data: string }) => void) => {
          if (evento === 'message') handlerMensajeWindow = cb;
        },
      },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptAplicacion, sandbox);

    const mapaFalso = sandbox.map as { fitBoundsLlamadas: number; setViewLlamadas: number };
    expect(mapaFalso.setViewLlamadas).toBe(1); // el view inicial de arranque

    // Se conoce una posición (primer fix de GPS) y luego se apaga el seguimiento.
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'position', lat: -17.38, lng: -66.15 }) });
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'tracking', active: true }) });
    handlerMensajeWindow!({ data: JSON.stringify({ type: 'tracking', active: false }) });

    // 'tracking' con active:false, ruta vacía, pero posición SÍ conocida: ajustarVistaARuta debe
    // centrar en la posición actual (map.setView) en vez de llamar fitBounds con un bounds
    // inválido.
    expect(mapaFalso.fitBoundsLlamadas).toBe(0);
    expect(mapaFalso.setViewLlamadas).toBe(2);
  });

  it('con ruta vacía: el mensaje "recenter" sin posición conocida no llama fitBounds', () => {
    const html = construirHtml(paqueteConRutaVacia(), vehiculoDePrueba);
    const scriptAplicacion = extraerScriptDeAplicacion(html);

    let handlerMensajeWindow: ((event: { data: string }) => void) | undefined;
    const sandbox: Record<string, unknown> = {
      L: crearLFalso(),
      document: { addEventListener: () => {} },
      window: {
        addEventListener: (evento: string, cb: (event: { data: string }) => void) => {
          if (evento === 'message') handlerMensajeWindow = cb;
        },
      },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptAplicacion, sandbox);

    expect(() => {
      handlerMensajeWindow!({ data: JSON.stringify({ type: 'recenter' }) });
    }).not.toThrow();

    const mapaFalso = sandbox.map as { fitBoundsLlamadas: number };
    expect(mapaFalso.fitBoundsLlamadas).toBe(0);
  });
});
