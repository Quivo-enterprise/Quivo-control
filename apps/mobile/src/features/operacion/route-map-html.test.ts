import { describe, expect, it } from 'vitest';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { construirHtml, convertirGeoJsonALatLng } from './route-map-html';

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

  it('la polyline de la ruta usa coordenadas ya convertidas a [lat, lng]', () => {
    // El primer punto de la ruta de prueba es GeoJSON [-66.1568, -17.3895] → Leaflet
    // [-17.3895, -66.1568]. Si hubiera un cruce de formato, este valor aparecería invertido.
    expect(html).toContain('[-17.3895,-66.1568]');
  });
});
