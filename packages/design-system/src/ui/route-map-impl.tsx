'use client';

// Implementación real de `RouteMap` — vive separada de `./RouteMap.tsx` a propósito. Este
// archivo importa MapLibre GL a nivel de módulo, y MapLibre toca `window`/`document` al crear
// un `Map` (no a nivel de módulo, pero sí en cuanto se usa). Por eso NUNCA se importa de forma
// estática desde una página: `./RouteMap.tsx` (el wrapper que exporta el barrel) lo carga con
// `React.lazy(() => import('./route-map-impl.js'))` solo después de montar en cliente, para
// que Next.js no lo arrastre al bundle de servidor durante el prerender de SSR/SSG.
//
// Motor visual portado de `Quivo-rutas` (`apps/web/src/components/brand-route-map.tsx`):
// mapa vectorial MapLibre GL + estilo gratuito OpenFreeMap "Bright" (sin API key), repintado
// en código con la paleta de marca de QUIVO en vez del tile ráster genérico de CARTO que usaba
// la versión anterior (Leaflet). Se le quitan las capas de edificios (`building`/`building-top`)
// — no hay ninguna capa 3D (`fill-extrusion`) en este estilo, así que no hace falta más que
// filtrarlas del JSON del estilo.
//
// El contrato público (`RouteMapProps`/`MapFitMode`) es el mismo de siempre: Quivo-rutas no
// tiene una pantalla de seguimiento GPS en vivo, así que su versión no necesita `fitMode`,
// `followPoint` ni `onUserPan` — esas tres siguen viviendo acá, reimplementadas sobre la API de
// MapLibre en vez de Leaflet. Tampoco tiene nodos arrastrables del editor de trazado
// (`pinType: 'node'`, `marker.draggable`/`onDragEnd`) — MapLibre no tiene un equivalente nativo
// al `Marker draggable` de Leaflet para capas GeoJSON, así que el arrastre se implementa a mano
// (ver los handlers `mousedown`/`mousemove`/`mouseup` sobre `quivo-marker-points`).

import { useEffect, useRef, useState } from 'react';
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cx } from '../utils.js';
import type { MapPoint, MapRoute, MapZone } from '../types.js';
import { Loader } from './primitives.js';
import { isWithinCentralViewport } from './route-map-geometry.js';

type MapLibreModule = typeof import('maplibre-gl');

// Cochabamba — centro por defecto cuando `RouteMap` se monta sin ningún punto todavía (ej.
// "Nueva ruta" antes del primer clic).
const DEFAULT_CENTER: [number, number] = [-17.3935, -66.157];
const DEFAULT_ZOOM = 13;

const QUIVO_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const MAP_ATTRIBUTION = '© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles';

// Paleta de marca — mismos valores que `tokens.css` (claro/oscuro). `route.color`/`zone.color`
// pueden venir como `var(--qv-color-primary)` literal (ver `rutas/page.tsx`: `lineaSeleccionada
// ?.color || 'var(--qv-color-primary)'`), y esos tokens CSS nunca se resuelven dentro de una
// expresión de paint de MapLibre (mismo problema que tenían los `pathOptions` de Leaflet) — hay
// que traducirlos a un hex real acá.
const TOKEN_COLORS: Record<string, { light: string; dark: string }> = {
  '--qv-color-primary': { light: '#3226b4', dark: '#6672f5' },
  '--qv-color-accent': { light: '#fd9e15', dark: '#feb83e' },
};
const DEFAULT_ROUTE_COLOR_LIGHT = '#3226b4';
const DEFAULT_ROUTE_COLOR_DARK = '#6672f5';

function resolveColor(color: string | undefined, isDark: boolean): string {
  const fallback = isDark ? DEFAULT_ROUTE_COLOR_DARK : DEFAULT_ROUTE_COLOR_LIGHT;
  const value = color?.trim();
  if (!value) return fallback;
  const tokenMatch = value.match(/^var\((--[^)]+)\)$/);
  const tokenName = tokenMatch?.[1];
  if (tokenName) {
    const token = TOKEN_COLORS[tokenName];
    return token ? (isDark ? token.dark : token.light) : fallback;
  }
  return value;
}

function parseHexColor(color: string) {
  const value = color.replace('#', '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function colorLuminance(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return 0.4;
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(rgb.red) * 0.2126 + channel(rgb.green) * 0.7152 + channel(rgb.blue) * 0.0722;
}

function mixHexColor(color: string, target: '#ffffff' | '#000000', amount: number) {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  const targetChannel = target === '#ffffff' ? 255 : 0;
  const mix = (value: number) =>
    Math.round(value + (targetChannel - value) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(rgb.red)}${mix(rgb.green)}${mix(rgb.blue)}`;
}

/** Halo/flecha de contraste para el color de una ruta — mismo cálculo de luminancia relativa
 * que `Quivo-rutas`, para que la línea se lea bien tanto sobre el fondo claro como el oscuro. */
function routeVisuals(color: string, isDark: boolean) {
  const luminance = colorLuminance(color);
  const stroke = isDark && luminance < 0.22 ? mixHexColor(color, '#ffffff', 0.2) : color;
  const strokeLuminance = colorLuminance(stroke);
  return {
    stroke,
    halo: isDark ? '#0b101b' : strokeLuminance > 0.5 ? '#393345' : '#ffffff',
  };
}

/** Estrategia de encuadre automático de `RouteMap`:
 * - `'auto'` (default, comportamiento histórico) — reencuadra cada vez que cambia el conjunto
 *   de puntos visibles. Pensado para el editor de rutas y el detalle de recorridos, donde el
 *   consumidor ya decide qué subconjunto mostrar.
 * - `'once'` — encuadra una sola vez (al montar, o de nuevo cuando cambia `fitKey`) y después
 *   deja la cámara quieta. Pensado para `/en-vivo`: el usuario puede alejarse del vehículo sin
 *   que cada punto GPS nuevo lo vuelva a centrar.
 * - `'off'` — nunca reencuadra automáticamente; el consumidor controla la cámara a mano
 *   (típicamente combinado con `followPoint`). */
export type MapFitMode = 'auto' | 'once' | 'off';

export interface RouteMapProps {
  routes?: MapRoute[];
  markers?: MapPoint[];
  stops?: MapPoint[];
  zones?: MapZone[];
  height?: string;
  className?: string;
  interactive?: boolean;
  loading?: boolean;
  onMapClick?: (point: MapPoint) => void;
  /** Ver `MapFitMode`. Opcional — default `'auto'`. */
  fitMode?: MapFitMode;
  /** Solo relevante con `fitMode='once'`: cuando cambia de valor, vuelve a encuadrar una vez
   * más (ej. pasar el `sesionId` seleccionado en `/en-vivo` al cambiar de sesión). Opcional —
   * sin `fitKey` el encuadre único ocurre solo al montar. */
  fitKey?: string | number;
  /** Punto a seguir con `panTo` (nunca cambia el zoom) mientras el mapa esté montado. Opcional
   * y controlado por el consumidor: no pasar la prop (o pasar `null`/`undefined`) desactiva el
   * seguimiento. */
  followPoint?: { lat: number; lng: number } | null;
  /** Se dispara cuando el usuario mueve el mapa a mano (arrastre o zoom con gesto) — nunca por
   * llamadas programáticas (`fitBounds`/`panTo`/`jumpTo`). Pensado para que el consumidor apague
   * su propio toggle de "seguir" cuando el usuario toma control manual del mapa. */
  onUserPan?: () => void;
  /** Centro por defecto [lat, lng] cuando no hay puntos cargados (o para foco inicial en una ciudad). */
  defaultCenter?: [number, number];
  /** Nivel de zoom inicial por defecto. */
  defaultZoom?: number;
}

type MapDataSnapshot = {
  routes: MapRoute[];
  stops: MapPoint[];
  markers: MapPoint[];
  zones: MapZone[];
};

type PointGeometry = { type: 'Point'; coordinates: [number, number] };
type LineGeometry = { type: 'LineString'; coordinates: Array<[number, number]> };
type PolygonGeometry = { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };
type MapFeature = {
  type: 'Feature';
  properties: Record<string, string | number | boolean>;
  geometry: PointGeometry | LineGeometry | PolygonGeometry;
};
type MapFeatureCollection = { type: 'FeatureCollection'; features: MapFeature[] };

function featureCollection(features: MapFeature[]): MapFeatureCollection {
  return { type: 'FeatureCollection', features };
}

/** Mismo id que ve el consumidor cuando lo pasa explícitamente; si no, un id sintético estable
 * mientras el array no cambie de orden — usado para correlacionar clicks/drags de vuelta al
 * objeto original (las funciones `onClick`/`onDragEnd` no viajan dentro del GeoJSON). */
function resolvePointId(point: { id?: string; lat: number; lng: number }, index: number): string {
  return point.id ?? `${point.lat}:${point.lng}:${index}`;
}

function nodeNumberFromId(id: string): string {
  const match = id.match(/^nodo-(\d+)$/);
  return match ? String(Number(match[1]) + 1) : '';
}

function routeFeatures(routes: MapRoute[], isDark: boolean): MapFeatureCollection {
  const drawable = routes.filter((route) => route.points.length > 1);
  return featureCollection(
    drawable.map((route, index) => {
      const visuals = routeVisuals(resolveColor(route.color, isDark), isDark);
      const offset = drawable.length > 1 ? (index - (drawable.length - 1) / 2) * 4 : 0;
      return {
        type: 'Feature',
        properties: {
          id: route.id,
          color: visuals.stroke,
          haloColor: visuals.halo,
          labelColor: visuals.stroke,
          labelHaloColor: isDark ? '#101522' : '#ffffff',
          offset,
          dashed: Boolean(route.dashed),
          label: route.label?.trim() ?? '',
          clickable: Boolean(route.onClick),
        },
        geometry: {
          type: 'LineString',
          coordinates: route.points.map((point) => [point.lng, point.lat] as [number, number]),
        },
      };
    }),
  );
}

function pointFeatures(points: MapPoint[], isDark: boolean, kind: 'stop' | 'marker'): MapFeatureCollection {
  return featureCollection(
    points.map((point, index) => {
      const id = resolvePointId(point, index);
      const color = resolveColor(point.color, isDark);
      const labelHaloColor = isDark ? '#101522' : '#ffffff';
      const pinType = point.pinType ?? 'pin';
      return {
        type: 'Feature',
        properties: {
          id,
          label: point.label?.trim() ?? '',
          description: point.description ?? '',
          color,
          haloColor: labelHaloColor,
          labelColor: isDark ? '#f4f5fb' : '#332e47',
          labelHaloColor,
          pinType,
          nodeNumber: pinType === 'node' || pinType === 'pulse' ? nodeNumberFromId(id) : '',
          role:
            kind === 'stop'
              ? index === 0
                ? 'start'
                : index === points.length - 1
                  ? 'end'
                  : 'stop'
              : 'marker',
          draggable: Boolean(point.draggable),
          clickable: Boolean(point.onClick),
        },
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
      };
    }),
  );
}

/** Círculo geográfico real (en metros, no píxeles) aproximado con un polígono de 64 lados —
 * mismo criterio que usaba `Circle` de Leaflet, portado de `Quivo-rutas`. */
function zonePolygon(zone: MapZone): Array<[number, number]> {
  const radius = Math.max(zone.radiusMeters, 1);
  const latitudeRadians = (zone.lat * Math.PI) / 180;
  const latitudeDelta = radius / 111_320;
  const longitudeDelta = radius / (111_320 * Math.max(Math.cos(latitudeRadians), 0.2));
  const coordinates: Array<[number, number]> = [];
  for (let index = 0; index <= 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    coordinates.push([
      zone.lng + Math.cos(angle) * longitudeDelta,
      zone.lat + Math.sin(angle) * latitudeDelta,
    ]);
  }
  return coordinates;
}

function zoneFeatures(zones: MapZone[], isDark: boolean): MapFeatureCollection {
  return featureCollection(
    zones.map((zone, index) => ({
      type: 'Feature',
      properties: {
        id: resolvePointId(zone, index),
        label: zone.label ?? '',
        color: resolveColor(zone.color, isDark),
        clickable: Boolean(zone.onClick),
      },
      geometry: { type: 'Polygon', coordinates: [zonePolygon(zone)] },
    })),
  );
}

function setSourceData(map: MapLibreMap, sourceId: string, data: MapFeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data as never);
}

function setPaintIfPresent(map: MapLibreMap, layerId: string, property: string, value: unknown) {
  if (map.getLayer(layerId)) map.setPaintProperty(layerId, property as never, value as never);
}

/**
 * Repinta el estilo base OpenFreeMap "Bright" con la paleta de marca de QUIVO — portado de
 * `Quivo-rutas` (`applyQuivoBaseStyle`). Sin las entradas `building`/`building-top`: esas capas
 * se filtran del estilo antes de llegar acá (ver `fetchQuivoMapStyle`), así que repintarlas
 * sería un no-op inofensivo pero confuso — se sacan del todo.
 */
function applyQuivoBaseStyle(map: MapLibreMap, isDark: boolean) {
  const palette = isDark
    ? {
        background: '#0f1420',
        residential: '#171c28',
        commercial: '#241923',
        industrial: '#242119',
        civic: '#211c2a',
        green: '#17261d',
        greenStrong: '#13231a',
        water: '#123042',
        waterLine: '#34738f',
        roadArea: '#272631',
        roadMinor: '#3d4352',
        roadSecondary: '#625244',
        roadPrimary: '#765445',
        roadTrunk: '#834c45',
        roadMotorway: '#82485b',
        roadCasing: '#151a25',
        railway: '#606675',
        railwayHatching: '#272d3a',
        boundary: '#454b5d',
        label: '#d9d8e7',
        labelMuted: '#a7a5b8',
        labelHalo: '#101520',
        waterLabel: '#88c7df',
      }
    : {
        background: '#f6f4ff',
        residential: '#f0eff8',
        commercial: '#fae9ee',
        industrial: '#f8efd5',
        civic: '#eee6fa',
        green: '#d9efdf',
        greenStrong: '#cfe9d4',
        water: '#c9e9fb',
        waterLine: '#82c9e7',
        roadArea: '#f5eadf',
        roadMinor: '#d3cfdf',
        roadSecondary: '#f2c09e',
        roadPrimary: '#eea77f',
        roadTrunk: '#e99579',
        roadMotorway: '#d97d93',
        roadCasing: '#faf9ff',
        railway: '#aaa5b5',
        railwayHatching: '#f1eef6',
        boundary: '#c4bfd1',
        label: '#514b70',
        labelMuted: '#716b86',
        labelHalo: '#faf9ff',
        waterLabel: '#4386a8',
      };

  setPaintIfPresent(map, 'background', 'background-color', palette.background);

  const fills: Record<string, string> = {
    'landcover-glacier': isDark ? '#293646' : '#e8f4fb',
    'landcover-ice-shelf': isDark ? '#263543' : '#e4f2f9',
    'landcover-sand': isDark ? '#2c291f' : '#f2e9ce',
    'landuse-residential': palette.residential,
    'landuse-suburb': palette.residential,
    'landuse-commercial': palette.commercial,
    'landuse-industrial': palette.industrial,
    'landuse-railway': isDark ? '#22232c' : '#eeeaf2',
    'landuse-cemetery': palette.green,
    'landuse-hospital': isDark ? '#291b21' : '#f7e3e4',
    'landuse-school': palette.civic,
    park: palette.green,
    'landcover-wood': palette.greenStrong,
    'landcover-grass': palette.green,
    'landcover-grass-park': palette.green,
    water: palette.water,
    'water-intermittent': palette.water,
    'aeroway-area': isDark ? '#252630' : '#e9e5ef',
    'highway-area': palette.roadArea,
    road_area_pier: palette.roadArea,
  };
  Object.entries(fills).forEach(([layerId, color]) => setPaintIfPresent(map, layerId, 'fill-color', color));

  [
    'waterway_tunnel',
    'waterway-other',
    'waterway-other-intermittent',
    'waterway-stream-canal',
    'waterway-stream-canal-intermittent',
    'waterway-river',
    'waterway-river-intermittent',
  ].forEach((layerId) => setPaintIfPresent(map, layerId, 'line-color', palette.waterLine));

  const roadGroups = [
    {
      color: palette.roadMinor,
      layers: [
        'tunnel-service-track',
        'tunnel-path',
        'tunnel-minor',
        'tunnel-link',
        'highway-path',
        'highway-minor',
        'highway-link',
        'bridge-path',
        'bridge-minor',
        'bridge-link',
        'road_pier',
        'aeroway-taxiway',
        'aeroway-runway',
      ],
    },
    { color: palette.roadSecondary, layers: ['tunnel-secondary-tertiary', 'highway-secondary-tertiary', 'bridge-secondary-tertiary'] },
    { color: palette.roadPrimary, layers: ['tunnel-trunk-primary', 'highway-primary', 'bridge-trunk-primary'] },
    { color: palette.roadTrunk, layers: ['highway-trunk'] },
    {
      color: palette.roadMotorway,
      layers: ['tunnel-motorway-link', 'tunnel-motorway', 'highway-motorway-link', 'highway-motorway', 'bridge-motorway-link', 'bridge-motorway'],
    },
  ];
  roadGroups.forEach(({ color, layers }) => layers.forEach((layerId) => setPaintIfPresent(map, layerId, 'line-color', color)));

  [
    'tunnel-service-track-casing',
    'tunnel-motorway-link-casing',
    'tunnel-minor-casing',
    'tunnel-link-casing',
    'tunnel-secondary-tertiary-casing',
    'tunnel-trunk-primary-casing',
    'tunnel-motorway-casing',
    'aeroway-taxiway-casing',
    'aeroway-runway-casing',
    'highway-motorway-link-casing',
    'highway-link-casing',
    'highway-minor-casing',
    'highway-secondary-tertiary-casing',
    'highway-primary-casing',
    'highway-trunk-casing',
    'highway-motorway-casing',
    'bridge-motorway-link-casing',
    'bridge-link-casing',
    'bridge-secondary-tertiary-casing',
    'bridge-trunk-primary-casing',
    'bridge-motorway-casing',
    'bridge-minor-casing',
    'bridge-path-casing',
  ].forEach((layerId) => setPaintIfPresent(map, layerId, 'line-color', palette.roadCasing));

  ['tunnel-railway', 'railway-transit', 'railway-service', 'railway', 'bridge-railway', 'cablecar'].forEach((layerId) =>
    setPaintIfPresent(map, layerId, 'line-color', palette.railway),
  );
  ['railway-transit-hatching', 'railway-service-hatching', 'railway-hatching', 'bridge-railway-hatching', 'cablecar-dash'].forEach((layerId) =>
    setPaintIfPresent(map, layerId, 'line-color', palette.railwayHatching),
  );
  ['boundary_3', 'boundary_2', 'boundary_disputed'].forEach((layerId) => setPaintIfPresent(map, layerId, 'line-color', palette.boundary));

  const labelLayers = [
    'waterway_line_label',
    'water_name_point_label',
    'water_name_line_label',
    'highway-name-path',
    'highway-name-minor',
    'highway-name-major',
    'label_other',
    'label_village',
    'label_town',
    'label_state',
    'label_city',
    'label_city_capital',
    'label_country_3',
    'label_country_2',
    'label_country_1',
  ];
  labelLayers.forEach((layerId) => {
    const isWaterLabel = layerId.includes('water');
    const isSecondaryLabel = layerId === 'label_other' || layerId === 'label_village';
    setPaintIfPresent(map, layerId, 'text-color', isWaterLabel ? palette.waterLabel : isSecondaryLabel ? palette.labelMuted : palette.label);
    setPaintIfPresent(map, layerId, 'text-halo-color', palette.labelHalo);
    setPaintIfPresent(map, layerId, 'text-halo-width', isDark ? 1.5 : 1.25);
  });

  ['poi_r20', 'poi_r7', 'poi_r1'].forEach((layerId) => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', layerId === 'poi_r20' ? 'none' : 'visible');
    setPaintIfPresent(map, layerId, 'text-color', palette.labelMuted);
    setPaintIfPresent(map, layerId, 'text-halo-color', palette.labelHalo);
  });
  // Paradas de transporte público de OpenStreetMap (no las de QUIVO — esas son la capa
  // `quivo-stops`, con datos propios). Pedido explícito: el mapa base solo debe mostrar calles,
  // avenidas y lo esencial (agua/verde), sin este ruido visual ajeno a nuestros datos.
  if (map.getLayer('poi_transit')) map.setLayoutProperty('poi_transit', 'visibility', 'none');
}

let quivoMapStylePromise: Promise<StyleSpecification> | null = null;

/** Fetch cacheado (una sola promesa module-level, reusada por todos los mapas montados) del
 * estilo OpenFreeMap "Bright", con: resolución manual del TileJSON de `openmaptiles` (evita que
 * MapLibre se quede esperando un descriptor remoto en navegadores con política de red/caché más
 * estricta), remoción de la fuente `ne2_shaded` (hillshade de Natural Earth, innecesario para un
 * mapa a nivel ciudad) y remoción de las capas `building`/`building-top` — pedido explícito: el
 * mapa de QUIVO no necesita edificios. */
async function fetchQuivoMapStyle(): Promise<StyleSpecification> {
  const style = (await fetch(QUIVO_MAP_STYLE).then((response) => {
    if (!response.ok) throw new Error(`No se pudo cargar el estilo vectorial (${response.status})`);
    return response.json();
  })) as {
    sources?: Record<string, Record<string, unknown>>;
    layers?: Array<{ id?: string; source?: string }>;
  };

  const openMapTilesSource = style.sources?.openmaptiles;
  if (openMapTilesSource && typeof openMapTilesSource.url === 'string') {
    const tileJson = (await fetch(openMapTilesSource.url).then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar el TileJSON (${response.status})`);
      return response.json();
    })) as { tiles?: string[]; minzoom?: number; maxzoom?: number; bounds?: [number, number, number, number] };
    if (tileJson.tiles?.length) {
      openMapTilesSource.tiles = tileJson.tiles;
      if (typeof tileJson.minzoom === 'number') openMapTilesSource.minzoom = tileJson.minzoom;
      if (typeof tileJson.maxzoom === 'number') openMapTilesSource.maxzoom = tileJson.maxzoom;
      if (tileJson.bounds) openMapTilesSource.bounds = tileJson.bounds;
      delete openMapTilesSource.url;
    }
  }

  if (style.sources?.ne2_shaded) {
    delete style.sources.ne2_shaded;
    style.layers = style.layers?.filter((layer) => layer.source !== 'ne2_shaded');
  }

  style.layers = style.layers?.filter((layer) => layer.id !== 'building' && layer.id !== 'building-top');

  return style as StyleSpecification;
}

function loadQuivoMapStyle(): Promise<StyleSpecification> {
  if (!quivoMapStylePromise) {
    quivoMapStylePromise = fetchQuivoMapStyle().catch((error: unknown) => {
      quivoMapStylePromise = null;
      throw error;
    });
  }
  return quivoMapStylePromise;
}

/** Fuentes/capas GeoJSON propias de QUIVO, agregadas encima del estilo base — portado de
 * `Quivo-rutas` (`ensureDataLayers`), con dos agregados propios de Quivo-control: la capa de
 * radio mayor para `pinType: 'node'` (nodos del trazado en edición) y `quivo-marker-labels`
 * (el número de nodo, ver `nodeNumberFromId`). */
function ensureDataLayers(map: MapLibreMap) {
  if (!map.getSource('quivo-routes')) map.addSource('quivo-routes', { type: 'geojson', data: featureCollection([]) as never });
  if (!map.getSource('quivo-stops')) map.addSource('quivo-stops', { type: 'geojson', data: featureCollection([]) as never });
  if (!map.getSource('quivo-markers')) map.addSource('quivo-markers', { type: 'geojson', data: featureCollection([]) as never });
  if (!map.getSource('quivo-zones')) map.addSource('quivo-zones', { type: 'geojson', data: featureCollection([]) as never });

  if (!map.getLayer('quivo-route-casing')) {
    map.addLayer({
      id: 'quivo-route-casing',
      type: 'line',
      source: 'quivo-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'haloColor'], 'line-width': 10, 'line-opacity': 0.96, 'line-offset': ['get', 'offset'] },
    });
  }
  if (!map.getLayer('quivo-route-line')) {
    map.addLayer({
      id: 'quivo-route-line',
      type: 'line',
      source: 'quivo-routes',
      filter: ['==', ['get', 'dashed'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 5.5, 'line-opacity': 0.98, 'line-offset': ['get', 'offset'] },
    });
  }
  if (!map.getLayer('quivo-route-dashed')) {
    map.addLayer({
      id: 'quivo-route-dashed',
      type: 'line',
      source: 'quivo-routes',
      filter: ['==', ['get', 'dashed'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5.5,
        'line-opacity': 0.98,
        'line-offset': ['get', 'offset'],
        'line-dasharray': [1, 1.6],
      },
    });
  }
  if (!map.getLayer('quivo-route-labels')) {
    map.addLayer({
      id: 'quivo-route-labels',
      type: 'symbol',
      source: 'quivo-routes',
      minzoom: 12,
      filter: ['!=', ['get', 'label'], ''],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 620,
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 12],
        'text-rotation-alignment': 'map',
        'text-keep-upright': false,
        'text-max-angle': 35,
        'text-max-width': 10,
        'text-padding': 6,
        'text-allow-overlap': false,
      },
      paint: { 'text-color': ['get', 'labelColor'], 'text-halo-color': ['get', 'labelHaloColor'], 'text-halo-width': 2, 'text-halo-blur': 0.15 },
    });
  }
  if (!map.getLayer('quivo-zone-fill')) {
    map.addLayer({ id: 'quivo-zone-fill', type: 'fill', source: 'quivo-zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
  }
  if (!map.getLayer('quivo-zone-outline')) {
    map.addLayer({
      id: 'quivo-zone-outline',
      type: 'line',
      source: 'quivo-zones',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.45 },
    });
  }
  if (!map.getLayer('quivo-stop-endpoint-halo')) {
    map.addLayer({
      id: 'quivo-stop-endpoint-halo',
      type: 'circle',
      source: 'quivo-stops',
      minzoom: 10,
      filter: ['any', ['==', ['get', 'role'], 'start'], ['==', ['get', 'role'], 'end']],
      paint: {
        'circle-radius': 13,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.18,
        'circle-blur': 0.35,
        'circle-stroke-color': ['get', 'haloColor'],
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.85,
      },
    });
  }
  if (!map.getLayer('quivo-stop-points')) {
    map.addLayer({
      id: 'quivo-stop-points',
      type: 'circle',
      source: 'quivo-stops',
      paint: {
        'circle-radius': ['match', ['get', 'role'], 'start', 8, 'end', 8, 5.5],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.98,
        'circle-stroke-color': ['get', 'haloColor'],
        'circle-stroke-width': 2,
      },
    });
  }
  if (!map.getLayer('quivo-stop-labels')) {
    map.addLayer({
      id: 'quivo-stop-labels',
      type: 'symbol',
      source: 'quivo-stops',
      minzoom: 11.5,
      filter: ['!=', ['get', 'label'], ''],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-padding': 5,
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: { 'text-color': ['get', 'labelColor'], 'text-halo-color': ['get', 'labelHaloColor'], 'text-halo-width': 2, 'text-halo-blur': 0.15 },
    });
  }
  if (!map.getLayer('quivo-marker-pulse')) {
    map.addLayer({
      id: 'quivo-marker-pulse',
      type: 'circle',
      source: 'quivo-markers',
      filter: ['==', ['get', 'pinType'], 'pulse'],
      paint: { 'circle-radius': 16, 'circle-color': ['get', 'color'], 'circle-opacity': 0.18, 'circle-stroke-width': 0 },
    });
  }
  if (!map.getLayer('quivo-marker-points')) {
    map.addLayer({
      id: 'quivo-marker-points',
      type: 'circle',
      source: 'quivo-markers',
      paint: {
        'circle-radius': ['match', ['get', 'pinType'], 'node', 11, 'pulse', 11, 'stop', 7, 8],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.98,
        'circle-stroke-color': ['get', 'haloColor'],
        'circle-stroke-width': 2,
      },
    });
  }
  if (!map.getLayer('quivo-marker-labels')) {
    map.addLayer({
      id: 'quivo-marker-labels',
      type: 'symbol',
      source: 'quivo-markers',
      filter: ['!=', ['get', 'nodeNumber'], ''],
      layout: {
        'text-field': ['get', 'nodeNumber'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.35)', 'text-halo-width': 1 },
    });
  }
  if (!map.getLayer('quivo-marker-popup-anchor')) {
    map.addLayer({
      id: 'quivo-marker-popup-anchor',
      type: 'symbol',
      source: 'quivo-markers',
      filter: ['!=', ['get', 'label'], ''],
      minzoom: 13,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: { 'text-color': ['get', 'labelColor'], 'text-halo-color': ['get', 'labelHaloColor'], 'text-halo-width': 1.5 },
    });
  }
}

const ROUTE_CLICK_LAYERS = ['quivo-route-casing'];
const STOP_CLICK_LAYERS = ['quivo-stop-points'];
const ZONE_CLICK_LAYERS = ['quivo-zone-fill'];
const MARKER_CLICK_LAYERS = ['quivo-marker-points'];

/**
 * Mapa interactivo (MapLibre GL) para trazado y visualización de rutas — RF-24..33 (QUI-229) y
 * el detalle de recorridos (QUI-247). Motor visual portado de `Quivo-rutas`; ver el comentario
 * de cabecera del archivo para el porqué de las diferencias de API.
 */
export function RouteMap({
  routes = [],
  markers = [],
  stops = [],
  zones = [],
  interactive = false,
  onMapClick,
  fitMode = 'auto',
  fitKey,
  followPoint,
  onUserPan,
  loading = false,
  className,
  height = '100%',
  defaultCenter,
  defaultZoom,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MapLibreModule | null>(null);
  const mapReadyRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const isDarkRef = useRef(false);
  const dataRef = useRef<MapDataSnapshot>({ routes, stops, markers, zones });
  dataRef.current = { routes, stops, markers, zones };
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const onUserPanRef = useRef(onUserPan);
  onUserPanRef.current = onUserPan;

  const dragIdRef = useRef<string | null>(null);
  const fitOnceStateRef = useRef<{ key: string | number | undefined; fired: boolean }>({ key: fitKey, fired: false });

  // Creación del mapa — una sola vez por montaje real. A diferencia de `<MapContainer>` de
  // react-leaflet, MapLibre no deja un id "sucio" en el contenedor al desmontar bajo Strict
  // Mode (`map.remove()` limpia de verdad), así que un `useEffect` simple con su cleanup real
  // alcanza — sin el `MapCanvas`/`LeafletProvider` a medida que hacía falta con Leaflet.
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (!containerRef.current || mapRef.current) return;
      setInitError(null);

      const [maplibre, style] = await Promise.all([import('maplibre-gl'), loadQuivoMapStyle()]);
      if (cancelled || !containerRef.current) return;

      maplibreRef.current = maplibre;
      isDarkRef.current =
        typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : false;

      const initialCenter = defaultCenter ?? DEFAULT_CENTER;
      const map = new maplibre.Map({
        container: containerRef.current,
        style,
        center: [initialCenter[1], initialCenter[0]],
        zoom: defaultZoom ?? DEFAULT_ZOOM,
        attributionControl: { compact: true, customAttribution: MAP_ATTRIBUTION },
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
        renderWorldCopies: false,
      });
      mapRef.current = map;
      // Sin controles de zoom en pantalla (+/-) a propósito — el scroll/pellizco ya alcanza y
      // es más limpio visualmente. La atribución (OpenStreetMap/OpenFreeMap/OpenMapTiles) sí
      // se mantiene: es requisito de licencia de las tiles gratuitas, no un adorno.

      map.on('load', () => {
        if (cancelled) return;
        applyQuivoBaseStyle(map, isDarkRef.current);
        ensureDataLayers(map);
        const current = dataRef.current;
        setSourceData(map, 'quivo-routes', routeFeatures(current.routes, isDarkRef.current));
        setSourceData(map, 'quivo-stops', pointFeatures(current.stops, isDarkRef.current, 'stop'));
        setSourceData(map, 'quivo-markers', pointFeatures(current.markers, isDarkRef.current, 'marker'));
        setSourceData(map, 'quivo-zones', zoneFeatures(current.zones, isDarkRef.current));
        mapReadyRef.current = true;
        setMapReady(true);
        map.resize();
      });

      map.on('error', () => {
        if (!mapReadyRef.current) setInitError('No se pudo cargar el mapa.');
      });

      // Click general del mapa (dibujo de trazado / marcar ubicación) — igual que antes, el
      // guard de `interactive` vive dentro del handler, no en si el listener está registrado.
      map.on('click', (event: MapMouseEvent) => {
        if (!interactiveRef.current || !onMapClickRef.current) return;
        onMapClickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });

      // Click por feature (rutas/paradas/zonas/markers con `onClick` propio) — se resuelve
      // contra `dataRef.current` en el momento del evento, así siempre corre el callback
      // vigente sin tener que re-registrar listeners cuando cambian los props.
      function wireFeatureClicks(layers: string[], resolve: (id: string) => (() => void) | undefined) {
        map.on('click', layers, (event: MapLayerMouseEvent) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id !== 'string') return;
          resolve(id)?.();
        });
        map.on('mouseenter', layers, (event: MapLayerMouseEvent) => {
          const clickable = event.features?.[0]?.properties?.clickable;
          const draggable = event.features?.[0]?.properties?.draggable;
          map.getCanvas().style.cursor = draggable ? 'grab' : clickable ? 'pointer' : '';
        });
        map.on('mouseleave', layers, () => {
          if (!dragIdRef.current) map.getCanvas().style.cursor = '';
        });
      }
      wireFeatureClicks(ROUTE_CLICK_LAYERS, (id) => dataRef.current.routes.find((r) => r.id === id)?.onClick);
      wireFeatureClicks(STOP_CLICK_LAYERS, (id) => dataRef.current.stops.find((p, i) => resolvePointId(p, i) === id)?.onClick);
      wireFeatureClicks(ZONE_CLICK_LAYERS, (id) => dataRef.current.zones.find((z, i) => resolvePointId(z, i) === id)?.onClick);
      wireFeatureClicks(MARKER_CLICK_LAYERS, (id) => dataRef.current.markers.find((m, i) => resolvePointId(m, i) === id)?.onClick);

      // Drag de markers (`draggable: true`, ej. nodos del trazado en edición o el punto
      // pendiente de parada/punto de control): sin equivalente nativo en MapLibre para capas
      // GeoJSON (a diferencia del `Marker draggable` de Leaflet), se implementa a mano —
      // deshabilitar `dragPan` mientras se arrastra, mover la feature en vivo, y al soltar
      // invocar el `onDragEnd` del marker original.
      map.on('mousedown', MARKER_CLICK_LAYERS, (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature?.properties?.draggable) return;
        event.preventDefault();
        dragIdRef.current = String(feature.properties.id);
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
      });
      map.on('mousemove', (event: MapMouseEvent) => {
        const id = dragIdRef.current;
        if (!id) return;
        const current = dataRef.current.markers;
        const index = current.findIndex((m, i) => resolvePointId(m, i) === id);
        if (index === -1) return;
        const updated = current.slice();
        updated[index] = { ...updated[index], lat: event.lngLat.lat, lng: event.lngLat.lng };
        dataRef.current = { ...dataRef.current, markers: updated };
        setSourceData(map, 'quivo-markers', pointFeatures(updated, isDarkRef.current, 'marker'));
      });
      function endDrag() {
        const id = dragIdRef.current;
        if (!id) return;
        dragIdRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        const current = dataRef.current.markers;
        const index = current.findIndex((m, i) => resolvePointId(m, i) === id);
        const marker = index === -1 ? undefined : current[index];
        marker?.onDragEnd?.({ lat: marker.lat, lng: marker.lng });
      }
      map.on('mouseup', endDrag);
      map.on('mouseleave', endDrag);

      map.on('dragstart', () => onUserPanRef.current?.());
      map.on('zoomstart', (event) => {
        if ('originalEvent' in event && event.originalEvent) onUserPanRef.current?.();
      });
    }

    void initialize().catch(() => {
      if (!cancelled) setInitError('No se pudo cargar el mapa.');
    });

    return () => {
      cancelled = true;
      mapReadyRef.current = false;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
    // El mapa se crea una sola vez; los cambios de viewport/datos se aplican en los efectos
    // de abajo, todos escritos para leer el estado más reciente vía refs.
  }, []);

  // Redimensiona cuando el contenedor cambia de tamaño (paneles/drawers que se abren después
  // de montar el mapa) — MapLibre no lo detecta solo.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Sigue el tema claro/oscuro del sistema operativo (mismo criterio que `tokens.css`/
  // `BrandLogo`) y vuelve a repintar el estilo base cuando cambia.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      isDarkRef.current = media.matches;
      const map = mapRef.current;
      if (map && mapReadyRef.current) {
        applyQuivoBaseStyle(map, media.matches);
        const current = dataRef.current;
        setSourceData(map, 'quivo-routes', routeFeatures(current.routes, media.matches));
        setSourceData(map, 'quivo-stops', pointFeatures(current.stops, media.matches, 'stop'));
        setSourceData(map, 'quivo-markers', pointFeatures(current.markers, media.matches, 'marker'));
        setSourceData(map, 'quivo-zones', zoneFeatures(current.zones, media.matches));
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Sincroniza las fuentes GeoJSON cada vez que cambian los datos.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    setSourceData(map, 'quivo-routes', routeFeatures(routes, isDarkRef.current));
    setSourceData(map, 'quivo-stops', pointFeatures(stops, isDarkRef.current, 'stop'));
    setSourceData(map, 'quivo-markers', pointFeatures(markers, isDarkRef.current, 'marker'));
    setSourceData(map, 'quivo-zones', zoneFeatures(zones, isDarkRef.current));
  }, [routes, stops, markers, zones, mapReady]);

  const boundsSignature = [
    ...routes.flatMap((route) => route.points),
    ...markers,
    ...stops,
    ...zones,
  ]
    .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
    .join('|');

  function fitToBounds(maplibre: MapLibreModule, map: MapLibreMap) {
    const points = [...routes.flatMap((route) => route.points), ...markers, ...stops, ...zones];
    const [first] = points;
    if (points.length === 0 || !first) return;
    if (points.length === 1) {
      map.easeTo({ center: [first.lng, first.lat], zoom: Math.max(map.getZoom(), 14), duration: 0 });
      return;
    }
    const bounds = new maplibre.LngLatBounds();
    points.forEach((point) => bounds.extend([point.lng, point.lat]));
    map.fitBounds(bounds, { padding: 32, maxZoom: 17, duration: 0 });
  }

  // `fitMode='auto'` — reencuadra cada vez que cambia el conjunto de puntos visibles.
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReadyRef.current || fitMode !== 'auto') return;
    fitToBounds(maplibre, map);
  }, [boundsSignature, fitMode, mapReady]);

  // `fitMode='once'` + `fitKey` — encuadra una sola vez (al montar, o de nuevo si cambia
  // `fitKey`), con el guard en un ref porque el efecto sigue corriendo mientras no hay puntos
  // todavía (la traza puede llegar después) y necesita poder disparar en cuanto aparezcan.
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReadyRef.current || fitMode !== 'once') return;
    if (fitOnceStateRef.current.key !== fitKey) fitOnceStateRef.current = { key: fitKey, fired: false };
    if (fitOnceStateRef.current.fired) return;
    const hasPoints = routes.some((r) => r.points.length > 0) || markers.length > 0 || stops.length > 0 || zones.length > 0;
    if (!hasPoints) return;
    fitOnceStateRef.current.fired = true;
    fitToBounds(maplibre, map);
  }, [boundsSignature, fitKey, fitMode, mapReady]);

  // Centra en `defaultCenter`/`defaultZoom` solo mientras no hay ningún punto todavía.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !defaultCenter) return;
    const hasPoints = routes.some((r) => r.points.length > 0) || markers.length > 0 || stops.length > 0 || zones.length > 0;
    if (hasPoints) return;
    map.jumpTo({ center: [defaultCenter[1], defaultCenter[0]], zoom: defaultZoom ?? DEFAULT_ZOOM });
  }, [defaultCenter?.[0], defaultCenter?.[1], defaultZoom, mapReady]);

  // Sigue `followPoint` con `panTo` (nunca cambia zoom), solo cuando salió del 60% central del
  // viewport — mismo umbral que antes (`isWithinCentralViewport`, sin cambios: es código puro,
  // no dependía de Leaflet).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !followPoint) return;
    const projected = map.project([followPoint.lng, followPoint.lat]);
    const canvas = map.getCanvas();
    const size = { x: canvas.clientWidth, y: canvas.clientHeight };
    if (isWithinCentralViewport({ x: projected.x, y: projected.y }, size)) return;
    map.panTo([followPoint.lng, followPoint.lat]);
  }, [followPoint?.lat, followPoint?.lng, mapReady]);

  const showLoading = loading || (!initError && !mapReady);

  return (
    <div className={cx('qv-route-map', className)} style={{ height }}>
      <div ref={containerRef} className="qv-route-map__canvas" style={{ height: '100%', width: '100%' }} />
      {showLoading && (
        <div className="qv-route-map__loading">
          <Loader label="Cargando mapa..." />
        </div>
      )}
      {initError && !showLoading && (
        <div className="qv-route-map__loading">
          <span>{initError}</span>
        </div>
      )}
    </div>
  );
}
