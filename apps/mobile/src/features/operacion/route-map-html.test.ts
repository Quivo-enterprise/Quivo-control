import * as vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import {
  CONTROLADOR_TILES_JS_SOURCE,
  construirHtml,
  convertirGeoJsonALatLng,
} from './route-map-html';
import type { ControladorTiles, OpcionesControladorTiles } from './route-map-html';

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

// Code-review de la Entrega 25 (2026-09-10) — hallazgo 1 (de esa ronda, ya corregido antes de
// esta): el fallback documentado de tiles ("sin cobertura a los 4s se remueve la capa") no se
// ejecutaba nunca, porque Leaflet dispara `tileload` también para el GIF de `errorTileUrl` (no
// solo para tiles reales), y el handler viejo no distinguía uno del otro. Estos tests ejercitan
// `crearControladorTiles` vía `instanciarControladorTiles` (ver arriba) — evaluando el MISMO
// string `CONTROLADOR_TILES_JS_SOURCE` que `construirHtml` embebe tal cual en el `<script>` del
// WebView (ver `route-map-html.ts`), así que cubren el comportamiento real y el texto real, no
// una función TS paralela que podría divergir del bundle de release.
describe('crearControladorTiles — máquina de estados de la capa de tiles', () => {
  var ERROR_TILE_URL = 'data:image/gif;base64,ERROR';
  var TIMEOUT_MS = 4000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sin ningún tile real: a los 4s remueve la capa', () => {
    const onRemoverCapa = vi.fn();
    const controlador = instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    controlador.onTileError();
    expect(onRemoverCapa).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(onRemoverCapa).toHaveBeenCalledTimes(1);
    expect(controlador.estaRemovida()).toBe(true);
  });

  it('el GIF de errorTileUrl dispara tileload pero NO cuenta como tile real — sigue removiendo', () => {
    const onRemoverCapa = vi.fn();
    const controlador = instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    controlador.onTileError();
    // Este es exactamente el evento que Leaflet 1.9.4 dispara para el placeholder de error:
    // un tileload cuyo e.tile.src es el errorTileUrl, no un tile real.
    controlador.onTileLoad(ERROR_TILE_URL);
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(onRemoverCapa).toHaveBeenCalledTimes(1);
    expect(controlador.estaRemovida()).toBe(true);
  });

  it('un tile real cancela el timeout — nunca remueve la capa', () => {
    const onRemoverCapa = vi.fn();
    const controlador = instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    controlador.onTileError();
    controlador.onTileLoad('https://tile.openstreetmap.org/10/512/512.png');
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(onRemoverCapa).not.toHaveBeenCalled();
    expect(controlador.estaRemovida()).toBe(false);
  });

  it('un tileerror aislado con red intermitente no remueve nada si después carga un tile real', () => {
    const onRemoverCapa = vi.fn();
    const controlador = instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    controlador.onTileError();
    vi.advanceTimersByTime(TIMEOUT_MS / 2);
    controlador.onTileLoad('https://tile.openstreetmap.org/10/512/512.png');
    vi.advanceTimersByTime(TIMEOUT_MS);

    expect(onRemoverCapa).not.toHaveBeenCalled();
    expect(controlador.estaRemovida()).toBe(false);
  });

  it('reintentar() resetea el estado para volver a evaluar cobertura desde cero', () => {
    const onRemoverCapa = vi.fn();
    const controlador = instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    controlador.onTileError();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(controlador.estaRemovida()).toBe(true);

    controlador.reintentar();
    expect(controlador.estaRemovida()).toBe(false);

    // Esta vez sí hay señal DURANTE la ventana de espera del nuevo timeout que arma este
    // onTileError (por eso el orden es error → load, no load → error): el tile real cancela
    // ESE timeout puntual, igual que en el resto de los tests de este describe. No debe volver
    // a removerse.
    controlador.onTileError();
    controlador.onTileLoad('https://tile.openstreetmap.org/10/512/512.png');
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(onRemoverCapa).toHaveBeenCalledTimes(1); // solo la primera vez, no de nuevo
    expect(controlador.estaRemovida()).toBe(false);
  });

  // Hallazgo 2 del code-review de esta entrega (medio): la versión anterior de
  // `crearControladorTiles` marcaba un flag `cargoTileReal = true` PERMANENTE apenas cargaba un
  // tile real, y ese flag bloqueaba para siempre volver a armar el timeout de remoción — sin
  // importar cuánto tiempo pasara ni cuántos tileerror llegaran después. Escenario real: el
  // chofer sale de la terminal con señal (carga un tile real) y más tarde, ya en ruta, entra a
  // una zona sin cobertura — con el bug, la capa de tiles NUNCA se removía ahí, porque el flag
  // de "alguna vez cargó un tile real" seguía en true desde la terminal. Esta es la secuencia
  // inversa pedida por el code-review: carga real → (silencio, pasa el tiempo) → pérdida de
  // red → errores sostenidos → SÍ se remueve la capa → vuelve la red → se reintegra.
  it('una carga real vieja no inmuniza para siempre: errores sostenidos después SÍ remueven la capa', () => {
    const onRemoverCapa = vi.fn();
    const controlador = instanciarControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    // El chofer arranca en la terminal, con señal: carga un tile real.
    controlador.onTileLoad('https://tile.openstreetmap.org/10/512/512.png');
    expect(controlador.estaRemovida()).toBe(false);

    // Viaja un rato largo sin que se pida ningún tile nuevo (sin pan/zoom de por medio).
    vi.advanceTimersByTime(TIMEOUT_MS * 10);
    expect(onRemoverCapa).not.toHaveBeenCalled();

    // Entra a una zona sin cobertura: los tiles empiezan a fallar y ya no hay ninguna carga
    // real más — exactamente el escenario que el flag permanente del bug ignoraba para siempre.
    controlador.onTileError();
    expect(onRemoverCapa).not.toHaveBeenCalled(); // todavía dentro del colchón de TIMEOUT_MS

    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(onRemoverCapa).toHaveBeenCalledTimes(1);
    expect(controlador.estaRemovida()).toBe(true);

    // Vuelve la red: reintentar() + un tile real reintegra la capa al mapa.
    controlador.reintentar();
    controlador.onTileLoad('https://tile.openstreetmap.org/10/512/512.png');
    expect(controlador.estaRemovida()).toBe(false);
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

  it('maneja tileerror para nunca dejar mosaicos rotos parpadeando sin red', () => {
    expect(html).toContain("tileLayer.on('tileerror'");
    expect(html).toContain('map.removeLayer(tileLayer)');
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

  it('embebe crearControladorTiles (la máquina de estados de tiles) dentro del script', () => {
    expect(html).toContain('function crearControladorTiles');
    expect(html).toContain('controladorTiles.onTileLoad');
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
   * `.addTo(mapa)` (se registran en `mapa.capas`), `.on(evento, cb)` y los demás métodos que
   * `route-map-html.ts` invoca sobre ellas (`setStyle`, `setIcon`, `setLatLng`, `getLatLng`,
   * `getBounds`, `bringToFront`) — sin implementar nada de geometría real, solo lo mínimo para
   * que el script corra sin `TypeError: x is not a function`. */
  function crearCapaLeafletFalsa(tipo: string, args: unknown) {
    const capa: Record<string, unknown> = { tipo, args, handlersRegistrados: [] as string[] };
    capa.addTo = (mapaFalso: { capas: unknown[] }) => {
      mapaFalso.capas.push(capa);
      return capa;
    };
    capa.on = (evento: string) => {
      (capa.handlersRegistrados as string[]).push(evento);
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
          setView() {
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

    const listenersRegistrados: Array<{ objeto: string; evento: string }> = [];
    const sandbox: Record<string, unknown> = {
      L: crearLFalso(),
      document: {
        addEventListener: (evento: string) => {
          listenersRegistrados.push({ objeto: 'document', evento });
        },
      },
      window: {
        addEventListener: (evento: string) => {
          listenersRegistrados.push({ objeto: 'window', evento });
        },
      },
      console,
      setTimeout,
      clearTimeout,
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
});
