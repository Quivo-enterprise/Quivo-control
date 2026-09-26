import { describe, expect, it, vi } from 'vitest';
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { ensureDataLayers } from './route-map-impl.js';

// FIX web-design-guidelines (hallazgo ALTA, gate previo al merge de
// feat/web-mapa-todos-vehiculos) — la placa del vehículo quedaba tapada por los POI del mapa
// base (restaurantes, farmacias…) en `/en-vivo`. Causa: `quivo-vehicle-symbols` y
// `quivo-vehicle-labels` tenían `icon-ignore-placement`/`text-ignore-placement` en `true`, así
// que no se insertaban en el índice de colisión de MapLibre y no reservaban su caja — los POI
// del estilo base, que sí compiten por espacio, se dibujaban encima sin saber que el vehículo
// estaba ahí. El fix saca esas dos propiedades (quedan en su default `false`) y confía en
// `icon-allow-overlap`/`text-allow-overlap: true` para que el vehículo mismo nunca se esconda
// por colisión con otra cosa — eso no requiere `ignore-placement`.
//
// Semántica confirmada con context7 (`/maplibre/maplibre-gl-js`, `pauseable_placement.ts`):
// MapLibre procesa el índice de colisión de arriba hacia abajo del stack de capas — las capas
// más altas reservan primero y ganan el conflicto. Como estas capas se agregan con
// `map.addLayer({...})` SIN `beforeId` (quedan arriba de TODO el stack, incluidas las POI del
// estilo base), no hace falta reordenarlas: alcanza con que reserven su caja.
//
// Se mockea `Map` con lo mínimo que usa `ensureDataLayers` (getSource/addSource/getLayer/
// addLayer) — levantar un `Map` real requiere WebGL, no disponible en el entorno de test.
function crearMapaFalso() {
  const capasAgregadas: LayerSpecification[] = [];
  const map = {
    getSource: vi.fn(() => undefined),
    addSource: vi.fn(),
    getLayer: vi.fn(() => undefined),
    addLayer: vi.fn((layer: LayerSpecification) => {
      capasAgregadas.push(layer);
    }),
  } as unknown as MapLibreMap;
  return { map, capasAgregadas };
}

function layout(capa: LayerSpecification | undefined): Record<string, unknown> {
  expect(capa).toBeDefined();
  return (capa as { layout?: Record<string, unknown> }).layout ?? {};
}

describe('ensureDataLayers — capas del vehículo no deben ignorar el índice de colisión', () => {
  it('quivo-vehicle-symbols: sin icon-ignore-placement, con icon-allow-overlap', () => {
    const { map, capasAgregadas } = crearMapaFalso();
    ensureDataLayers(map);

    const capa = capasAgregadas.find((c) => c.id === 'quivo-vehicle-symbols');
    const l = layout(capa);
    expect(l['icon-ignore-placement']).not.toBe(true);
    expect(l['icon-allow-overlap']).toBe(true);
  });

  it('quivo-vehicle-labels: sin text-ignore-placement, con text-allow-overlap', () => {
    const { map, capasAgregadas } = crearMapaFalso();
    ensureDataLayers(map);

    const capa = capasAgregadas.find((c) => c.id === 'quivo-vehicle-labels');
    const l = layout(capa);
    expect(l['text-ignore-placement']).not.toBe(true);
    expect(l['text-allow-overlap']).toBe(true);
  });

  it('quivo-vehicle-fallback (círculo de respaldo) no declara propiedades de ignore-placement — son exclusivas de capas symbol', () => {
    const { map, capasAgregadas } = crearMapaFalso();
    ensureDataLayers(map);

    const capa = capasAgregadas.find((c) => c.id === 'quivo-vehicle-fallback');
    expect(capa).toBeDefined();
    expect(capa?.type).toBe('circle');
    const l = layout(capa) as Record<string, unknown>;
    expect(l['icon-ignore-placement']).toBeUndefined();
    expect(l['text-ignore-placement']).toBeUndefined();
  });

  it('regresión: quivo-marker-points/quivo-marker-labels (paradas y nodos) SIGUEN con ignore-placement — solo el vehículo cambió', () => {
    const { map, capasAgregadas } = crearMapaFalso();
    ensureDataLayers(map);

    const puntos = capasAgregadas.find((c) => c.id === 'quivo-marker-points');
    expect(puntos).toBeDefined(); // capa circle — no tiene ignore-placement, no le aplica

    const labels = capasAgregadas.find((c) => c.id === 'quivo-marker-labels');
    expect(layout(labels)['text-ignore-placement']).toBe(true);
  });

  it('las capas del vehículo se agregan sin beforeId (quedan arriba de todo el stack, incluidas las POI del estilo base)', () => {
    const { map } = crearMapaFalso();
    const addLayerSpy = map.addLayer as unknown as ReturnType<typeof vi.fn>;
    ensureDataLayers(map);

    const llamadaSymbols = addLayerSpy.mock.calls.find(
      (call: unknown[]) => (call[0] as LayerSpecification).id === 'quivo-vehicle-symbols',
    );
    const llamadaLabels = addLayerSpy.mock.calls.find(
      (call: unknown[]) => (call[0] as LayerSpecification).id === 'quivo-vehicle-labels',
    );
    expect(llamadaSymbols).toHaveLength(1); // solo el layer, sin segundo argumento beforeId
    expect(llamadaLabels).toHaveLength(1);
  });
});
