import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { construirHtml, convertirGeoJsonALatLng, crearControladorTiles } from './route-map-html';

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

// Code-review de la Entrega 25 (2026-09-10) — hallazgo 1: el fallback documentado de tiles
// ("sin cobertura a los 4s se remueve la capa") no se ejecutaba nunca, porque Leaflet dispara
// `tileload` también para el GIF de `errorTileUrl` (no solo para tiles reales), y el handler
// viejo no distinguía uno del otro. Estos tests ejercitan `crearControladorTiles` directamente
// —la MISMA función pura que `construirHtml` serializa con `.toString()` y embebe en el
// `<script>` del WebView (ver `route-map-html.ts`)—, así que cubren el comportamiento real, no
// solo que cierto texto aparezca en el HTML.
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
    const controlador = crearControladorTiles({
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
    const controlador = crearControladorTiles({
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
    const controlador = crearControladorTiles({
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
    const controlador = crearControladorTiles({
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
    const controlador = crearControladorTiles({
      errorTileUrl: ERROR_TILE_URL,
      timeoutMs: TIMEOUT_MS,
      onRemoverCapa,
    });

    controlador.onTileError();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(controlador.estaRemovida()).toBe(true);

    controlador.reintentar();
    expect(controlador.estaRemovida()).toBe(false);

    // Esta vez sí hay señal: no debe volver a removerse.
    controlador.onTileLoad('https://tile.openstreetmap.org/10/512/512.png');
    controlador.onTileError();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(onRemoverCapa).toHaveBeenCalledTimes(1); // solo la primera vez, no de nuevo
    expect(controlador.estaRemovida()).toBe(false);
  });
});

describe('construirHtml — cero dependencia de red para inicializar el mapa', () => {
  const html = construirHtml(
    paqueteDePrueba(),
    vehiculoDePrueba,
    'p0000000-0000-4000-8000-000000000002',
  );

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
});
