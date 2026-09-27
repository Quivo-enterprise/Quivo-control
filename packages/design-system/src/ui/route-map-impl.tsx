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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Marker as MapLibreMarker,
  MapMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cx } from '../utils.js';
import type { MapPoint, MapRoute, MapZone } from '../types.js';
import { Loader } from './primitives.js';
import { isWithinCentralViewport } from './route-map-geometry.js';
import { diffOverlayMarkers, type MapOverlayMarker } from './route-map-overlay-markers.js';
import {
  avanzarAnimacion,
  encolarNuevosPuntos,
  estadoInicialAnimacion,
  type EstadoAnimacionVehiculo,
  type PuntoAnimable,
} from './vehicle-marker-animation.js';

export type { MapOverlayMarker };

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
  /**
   * Marcador "vivo" cuya posición se anima con una transición suave entre actualizaciones
   * (`requestAnimationFrame`), en vez de saltar de golpe como el resto de `markers`. Pensado
   * para el vehículo de `/en-vivo`. Ver el comentario de cabecera de
   * `vehicle-marker-animation.ts` para la técnica completa y por qué esa es la duración de
   * la animación.
   *
   * - `markerId`: debe coincidir con el `id` (o el id sintético de `resolvePointId`) de un
   *   elemento de `markers` — RouteMap solo le pisa la posición geográfica mientras interpola;
   *   el resto de sus propiedades (color, label, pinType…) las sigue tomando de `markers`.
   * - `resetKey`: identifica al vehículo/sesión seguida (ej. el `sesionId`). Al cambiar,
   *   reinicia la animación por completo (salto directo, sin arrastrar el cursor de la sesión
   *   anterior) — evita animar una transición sin sentido entre dos vehículos distintos.
   * - `points`: el historial COMPLETO y ordenado ascendente por `ts` del recorrido (ej.
   *   `traza.puntos` tal cual lo deja `fusionarTraza`) — no solo los nuevos. RouteMap detecta
   *   por sí solo, comparando contra el último `ts` ya incorporado, cuáles son los puntos
   *   nuevos a animar.
   * - `intervalMs`: cadencia actual de actualización (ej. `intervaloPoll(datos)`) — el
   *   presupuesto de tiempo que se reparte entre los puntos nuevos del lote.
   *
   * `null`/`undefined` desactiva la animación: el marcador correspondiente (si existe en
   * `markers`) se dibuja en su posición tal cual, sin interpolar.
   */
  animatedVehicle?: {
    markerId: string;
    resetKey: string;
    points: PuntoAnimable[];
    intervalMs: number;
  } | null;
  /**
   * Marcadores DOM genéricos superpuestos al mapa (`maplibregl.Marker` real, con el `content`
   * del consumidor montado adentro vía portal) — aditivo y opcional: no pasar la prop deja el
   * comportamiento de `RouteMap` exactamente igual que antes. Pensado para overlays que
   * necesitan interactividad propia (ej. un botón) que las capas GeoJSON de `markers`/`stops`
   * no pueden ofrecer. `RouteMap` no engancha ningún click a estos marcadores — el `content`
   * trae su propio manejo (su propio `<button>`), y un click ahí nunca dispara `onMapClick` ni
   * los handlers de click por feature. Ver `diffOverlayMarkers` en
   * `route-map-overlay-markers.ts` para el criterio de alta/actualización/baja por `id`.
   */
  overlayMarkers?: MapOverlayMarker[];
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
 * objeto original (las funciones `onClick`/`onDragEnd` no viajan dentro del GeoJSON).
 *
 * Exportada (ENTREGA 14) solo para el test `route-map-impl.marker-override.test.ts` — es pura,
 * sin `maplibre-gl`, así que exportarla no cambia el contrato público de `RouteMap`. */
export function resolvePointId(point: { id?: string; lat: number; lng: number }, index: number): string {
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
      const autoOffset = drawable.length > 1 ? (index - (drawable.length - 1) / 2) * 4 : 0;
      const offset = route.offsetPx ?? autoOffset;
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
          // ENTREGA 14/16 — solo relevantes para `pinType: 'vehicle'` (ver `quivo-vehicle-symbols`/
          // `quivo-vehicle-labels`); en cualquier otro punto viajan vacíos, sin costo.
          estadoFrescura: point.estadoFrescura ?? '',
          placa: point.placa ?? '',
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

/**
 * ENTREGA 14 — sprites del vehículo en `/en-vivo`, uno por `estadoFrescura`. Antes, vehículo
 * (radio 11) y punto de control (radio 7) eran el MISMO círculo con 4 px de diferencia —
 * indistinguibles con 26 puntos de control y varios vehículos en pantalla a la vez. Acá la
 * FORMA cambia, no solo el color, para que un vehículo `perdido` se reconozca sin leer texto:
 *
 * - `reportando` — bus sólido (glifo `mdi:bus`), badge verde relleno.
 * - `detenido`   — bus con reloj (glifo `mdi:bus-clock` — "esperando", no una falla), badge
 *   con contorno PUNTEADO en vez de relleno sólido: la forma del borde ya comunica "distinto
 *   de reportando" antes de leer el color.
 * - `perdido`    — bus con alerta (glifo `mdi:bus-alert`), badge gris y atenuado (opacidad
 *   reducida): "esto no es una posición confiable ahora mismo".
 *
 * `sin_datos` queda afuera a propósito: esa sesión nunca tuvo un fix, así que en
 * `map-builders.ts` ni siquiera llega a ser un marker (`lat`/`lng` `null` ⇒ no se dibuja) —
 * no hace falta un cuarto sprite.
 *
 * Los tres glifos son Material Design Icons (`mdi:bus`, `mdi:bus-clock`, `mdi:bus-alert`,
 * licencia Apache-2.0), resueltos vía el MCP `iconify` — no un SVG inventado a mano.
 */
type EstadoIconoVehiculo = 'reportando' | 'detenido' | 'perdido';

const ICONO_BUS_PATH =
  'M18 11H6V6h12m-1.5 11a1.5 1.5 0 0 1-1.5-1.5a1.5 1.5 0 0 1 1.5-1.5a1.5 1.5 0 0 1 1.5 1.5a1.5 1.5 0 0 1-1.5 1.5m-9 0A1.5 1.5 0 0 1 6 15.5A1.5 1.5 0 0 1 7.5 14A1.5 1.5 0 0 1 9 15.5A1.5 1.5 0 0 1 7.5 17M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4z';
const ICONO_BUS_CLOCK_PATH =
  'M16.5 4v4.25l2.86 1.69l-.75 1.22L15 9V4zm-.5 9c1.36 0 2.54-.5 3.5-1.47c1-.97 1.5-2.14 1.5-3.53c0-1.36-.5-2.54-1.5-3.5c-.96-1-2.14-1.5-3.5-1.5c-1.39 0-2.56.5-3.53 1.5C11.5 5.46 11 6.64 11 8c0 1.39.5 2.56 1.47 3.53S14.61 13 16 13m-2.5 6c.44 0 .8-.16 1.08-.46s.42-.65.42-1.04c0-.42-.14-.77-.42-1.07S13.94 16 13.5 16s-.8.13-1.08.43s-.42.65-.42 1.07c0 .39.14.74.42 1.04s.64.46 1.08.46M3 13h8.11C9.7 11.64 9 10 9 8H3zm1.5 6c.44 0 .8-.16 1.08-.46S6 17.89 6 17.5c0-.42-.14-.77-.42-1.07S4.94 16 4.5 16s-.8.13-1.08.43S3 17.08 3 17.5c0 .39.14.74.42 1.04s.64.46 1.08.46M16 1c1.92 0 3.58.67 4.95 2.05C22.33 4.42 23 6.08 23 8c0 1.77-.56 3.29-1.72 4.59c-1.15 1.29-2.58 2.07-4.28 2.32V18c0 .84-.33 1.58-1 2.2V22c0 .27-.11.5-.3.71c-.2.2-.42.29-.7.29h-1c-.27 0-.5-.09-.71-.29A.98.98 0 0 1 13 22v-1H5v1c0 .27-.09.5-.29.71c-.21.2-.44.29-.71.29H3c-.28 0-.5-.09-.7-.29c-.19-.21-.3-.44-.3-.71v-1.8c-.67-.62-1-1.36-1-2.2V8c0-1.58.67-2.65 2.05-3.2C4.42 4.26 6.41 4 9 4h.61c.28 0 .48.03.61.03C11.63 2 13.55 1 16 1';
const ICONO_BUS_ALERT_PATH =
  'M16 1a7 7 0 0 1 7 7c0 3.53-2.61 6.45-6 6.93V18c0 .84-.35 1.58-1.04 2.2V22c0 .27-.09.5-.28.71c-.18.2-.42.29-.68.29h-1a.98.98 0 0 1-.73-.29a.96.96 0 0 1-.31-.71v-1H5.04v1c0 .27-.1.5-.31.71c-.2.2-.44.29-.73.29H3c-.26 0-.5-.09-.68-.29c-.19-.21-.28-.44-.28-.71v-1.8C1.35 19.58 1 18.84 1 18V8c0-1.58.7-2.65 2.07-3.2C4.44 4.26 6.42 4 9 4l1.23.03A7.01 7.01 0 0 1 16 1m0 2a5 5 0 0 0-5 5a5 5 0 0 0 5 5a5 5 0 0 0 5-5a5 5 0 0 0-5-5m-1 7h2v2h-2zm0-6h2v5h-2zM3 13h8.09A7 7 0 0 1 9 8H3zm1.5 3c-.81 0-1.5.67-1.5 1.5A1.5 1.5 0 0 0 4.5 19c.85 0 1.5-.67 1.5-1.5A1.5 1.5 0 0 0 4.5 16m9 0c-.85 0-1.5.67-1.5 1.5a1.5 1.5 0 0 0 1.5 1.5c.81 0 1.5-.67 1.5-1.5a1.5 1.5 0 0 0-1.5-1.5';

interface VehiculoIconoSpec {
  estado: EstadoIconoVehiculo;
  path: string;
  /** Hex literal, no `var(--qv-color-*)`: la imagen se rasteriza en un `<canvas>` fuera del
   * árbol de React, donde los custom properties del tema no están disponibles — mismo
   * problema que documenta `resolveColor` para `route.color`/`zone.color`. Mismos valores que
   * `tokens.css` (paleta clara): `--qv-color-success`/`--qv-color-info`/`--qv-text-muted`. */
  background: string;
  /** `true` ⇒ contorno punteado con relleno tenue en vez de relleno sólido — la FORMA del
   * badge ya distingue `detenido` de `reportando` antes de leer el color. */
  outline: boolean;
  opacity: number;
}

const VEHICULO_ICONOS: VehiculoIconoSpec[] = [
  { estado: 'reportando', path: ICONO_BUS_PATH, background: '#16a34a', outline: false, opacity: 1 },
  { estado: 'detenido', path: ICONO_BUS_CLOCK_PATH, background: '#0891b2', outline: true, opacity: 1 },
  { estado: 'perdido', path: ICONO_BUS_ALERT_PATH, background: '#94a3b8', outline: false, opacity: 0.72 },
];

const VEHICULO_ICONO_PX = 64;

function vehiculoIconoId(estado: string): string {
  return `quivo-bus-${estado}`;
}

function buildVehiculoIconoSvg(spec: VehiculoIconoSpec): string {
  const size = VEHICULO_ICONO_PX;
  const center = size / 2;
  const radius = center - 4;
  // `detenido` (hueco/punteado) perdía contraste sobre el mapa base: con `fill-opacity: 0.3`
  // y SIN el halo blanco que sí tienen `reportando`/`perdido` (su `stroke="#ffffff"` de abajo),
  // el badge se mezclaba con cualquier fondo claro o cian del estilo (agua, parques) y con el
  // texto de las calles debajo. El fix agrega un disco blanco opaco de respaldo — el mismo
  // halo de contraste que ya usan los otros dos estados, aplicado ANTES del círculo punteado
  // en vez de como `stroke` (un stroke blanco por fuera del punteado rompería el efecto
  // "hueco") — y sube el relleno cian de 0.3 a 0.55: visible sobre el blanco sin taparlo, la
  // forma sigue siendo la que distingue a `detenido` (punteada) de `reportando` (sólida).
  const badge = spec.outline
    ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="#ffffff"/>` +
      `<circle cx="${center}" cy="${center}" r="${radius}" fill="${spec.background}" fill-opacity="0.55" stroke="${spec.background}" stroke-width="4" stroke-dasharray="7 4"/>`
    : `<circle cx="${center}" cy="${center}" r="${radius}" fill="${spec.background}" stroke="#ffffff" stroke-width="3"/>`;
  // El glifo MDI vive en un viewBox de 24×24 — se centra y escala al ~58% del badge.
  const glyphSize = size * 0.58;
  const glyphOffset = (size - glyphSize) / 2;
  const scale = glyphSize / 24;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" opacity="${spec.opacity}">${badge}` +
    `<g transform="translate(${glyphOffset} ${glyphOffset}) scale(${scale})">` +
    `<path fill="#ffffff" d="${spec.path}"/></g></svg>`
  );
}

function loadImageElement(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo decodificar el ícono del vehículo'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Registra (`map.addImage`) los tres sprites de vehículo antes de activar la capa
 * `quivo-vehicle-symbols`. Devuelve `false` si CUALQUIERA falla (red, CSP, decode) — el
 * llamador usa eso para quedarse en el fallback de círculo (`quivo-vehicle-fallback`, ya
 * dibujado y visible por defecto) en vez de activar una capa `symbol` que apunta a una
 * imagen inexistente: MapLibre simplemente no dibuja nada ahí, y el vehículo desaparecería
 * del mapa — justo lo que el plan prohíbe ("nunca desaparecer vehículos").
 */
async function ensureVehiculoIconos(map: MapLibreMap): Promise<boolean> {
  try {
    await Promise.all(
      VEHICULO_ICONOS.map(async (spec) => {
        const id = vehiculoIconoId(spec.estado);
        if (map.hasImage(id)) return;
        const image = await loadImageElement(buildVehiculoIconoSvg(spec));
        if (!map.hasImage(id)) map.addImage(id, image);
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Alterna entre el sprite del bus (`quivo-vehicle-symbols`) y el círculo de respaldo
 * (`quivo-vehicle-fallback`) — nunca los dos a la vez, y nunca ninguno de los dos (por eso el
 * fallback arranca VISIBLE por default en `ensureDataLayers`, antes de que las imágenes
 * terminen de cargar). */
function setVehiculoIconoDisponible(map: MapLibreMap, disponible: boolean) {
  if (!map.getLayer('quivo-vehicle-symbols') || !map.getLayer('quivo-vehicle-fallback')) return;
  map.setLayoutProperty('quivo-vehicle-symbols', 'visibility', disponible ? 'visible' : 'none');
  map.setLayoutProperty('quivo-vehicle-fallback', 'visibility', disponible ? 'none' : 'visible');
}

/**
 * Si hay una animación de vehículo activa (`anim.current` no `null`), pisa la posición del
 * marker que matchea `markerId` con la posición VISUAL actual de la animación — el resto de
 * sus propiedades (color, label, pinType…) se dejan intactas. Sin animación (`anim.current`
 * es `null`, o no hay ningún `markerId` que buscar) devuelve `markers` tal cual: éste es el
 * ÚNICO lugar donde se decide qué posición dibujar para el marker animado, para que los tres
 * sitios que escriben la fuente `quivo-markers` (la carga inicial, el cambio de tema y el
 * loop de `requestAnimationFrame`) nunca se pisen entre sí con posiciones distintas — ver el
 * comentario de cabecera de `vehicle-marker-animation.ts`.
 *
 * Exportada (ENTREGA 14) por el mismo motivo que `resolvePointId`: con N vehículos dibujados
 * a la vez, la prueba de que la animación pisa EXACTAMENTE el marker de `markerId` — y deja
 * los demás intactos — vive en `route-map-impl.marker-override.test.ts`.
 */
export function markersWithVehicleOverride(
  markers: MapPoint[],
  anim: EstadoAnimacionVehiculo,
  markerId: string | undefined,
): MapPoint[] {
  if (!markerId || !anim.current) return markers;
  const { lat, lng } = anim.current;
  return markers.map((marker, index) => (resolvePointId(marker, index) === markerId ? { ...marker, lat, lng } : marker));
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

// ENTREGA 16 — filtros de las capas `quivo-marker-*`/`quivo-vehicle-*`, extraídos a constantes
// EXPORTADAS (en vez de vivir inline dentro de cada `map.addLayer`) por dos motivos: (1) el
// mismo filtro de vehículo (`pinType === 'vehicle'`) lo usan tres capas distintas
// (`quivo-vehicle-fallback`/`quivo-vehicle-symbols`/`quivo-vehicle-labels`) — antes vivía
// duplicado en cada una, con el riesgo de que un fix tocara una copia y se olvidara de la otra
// (exactamente el bug que este fix corrige: la Entrega 14 le sacó `'pulse'` a
// `quivo-marker-points`/`quivo-marker-popup-anchor` para dárselo a los vehículos, rompiendo a
// los consumidores no vehiculares de `'pulse'` — el punto pendiente/nodo seleccionado del
// editor de trazado en `rutas/page.tsx` y el demo de la landing, `FleetPanelPreview.tsx`); y
// (2) exportarlos permite testear la EXPRESIÓN real que evalúa MapLibre (`route-map-impl.
// layer-filters.test.ts`) sin levantar un `Map` con WebGL.
//
// `'pulse'` es el pinType genérico de "marcador que pulsa" — nodos del editor de trazado y el
// demo de la landing lo usan igual que antes de la Entrega 14. `'vehicle'` es el pinType
// EXCLUSIVO de los vehículos reales de `/en-vivo` (`construirMarcadoresVehiculos` en
// `apps/web/app/(dashboard)/en-vivo/map-builders.ts`) — nunca lo usa nada más.
export const MARKER_PULSE_FILTER: FilterSpecification = [
  'any',
  ['==', ['get', 'pinType'], 'pulse'],
  ['all', ['==', ['get', 'pinType'], 'vehicle'], ['==', ['get', 'estadoFrescura'], 'reportando']],
];
export const MARKER_POINTS_FILTER: FilterSpecification = ['!=', ['get', 'pinType'], 'vehicle'];
export const VEHICLE_BODY_FILTER: FilterSpecification = ['==', ['get', 'pinType'], 'vehicle'];
export const VEHICLE_LABELS_FILTER: FilterSpecification = [
  'all',
  ['==', ['get', 'pinType'], 'vehicle'],
  ['!=', ['get', 'placa'], ''],
];
export const MARKER_POPUP_ANCHOR_FILTER: FilterSpecification = [
  'all',
  ['!=', ['get', 'label'], ''],
  ['!=', ['get', 'pinType'], 'vehicle'],
];

/** Fuentes/capas GeoJSON propias de QUIVO, agregadas encima del estilo base — portado de
 * `Quivo-rutas` (`ensureDataLayers`), con dos agregados propios de Quivo-control: la capa de
 * radio mayor para `pinType: 'node'` (nodos del trazado en edición) y `quivo-marker-labels`
 * (el número de nodo, ver `nodeNumberFromId`).
 *
 * Exportada (mismo motivo que los filtros de arriba) para poder testear, sin levantar un `Map`
 * con WebGL, que las capas del vehículo (`quivo-vehicle-symbols`/`quivo-vehicle-labels`) no
 * usan `*-ignore-placement: true` — ver `route-map-impl.vehicle-layers.test.ts`. */
export function ensureDataLayers(map: MapLibreMap) {
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
      // ENTREGA 14 — un vehículo `perdido`/`detenido` NO pulsa: el halo animado ("estoy vivo y
      // en movimiento AHORA") solo tiene sentido para `reportando`. Antes solo filtraba por
      // `pinType`, así que un vehículo sin señal pulsaba igual que uno reportando — la
      // animación mentía justo en el caso que más importa detectar.
      // ENTREGA 16 — `pinType: 'pulse'` (nodos del editor/demo de landing) sigue pulsando
      // siempre, como antes de la Entrega 14 — ver `MARKER_PULSE_FILTER`.
      filter: MARKER_PULSE_FILTER,
      paint: { 'circle-radius': 16, 'circle-color': ['get', 'color'], 'circle-opacity': 0.18, 'circle-stroke-width': 0 },
    });
  }
  if (!map.getLayer('quivo-marker-points')) {
    map.addLayer({
      id: 'quivo-marker-points',
      type: 'circle',
      source: 'quivo-markers',
      // ENTREGA 14 — `vehicle` sale de acá: antes era el MISMO círculo que un punto de control
      // con 4 px de diferencia de radio. Ahora un vehículo se dibuja con `quivo-vehicle-symbols`
      // (ícono) o `quivo-vehicle-fallback` (círculo grande, ver abajo) — nunca con esta capa
      // genérica. `pulse` (nodos del editor/demo de landing, ENTREGA 16) SÍ sigue acá — nunca
      // tuvo capas propias, solo un radio distinto (ver `match` de abajo).
      filter: MARKER_POINTS_FILTER,
      paint: {
        'circle-radius': ['match', ['get', 'pinType'], 'node', 11, 'pulse', 11, 'stop', 7, 8],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.98,
        'circle-stroke-color': ['get', 'haloColor'],
        'circle-stroke-width': 2,
      },
    });
  }
  // ENTREGA 14 — círculo de RESPALDO del vehículo. Arranca VISIBLE por default (antes de que
  // `ensureVehiculoIconos` termine de registrar los sprites, o si falla) para que un vehículo
  // nunca desaparezca del mapa mientras el ícono no está listo — ver
  // `setVehiculoIconoDisponible`, que lo apaga apenas el sprite real está disponible.
  // ENTREGA 15 — `circle-radius: 14→17` (+21%), en la misma proporción que el `icon-size` de
  // abajo (0.5→0.62, +24%): el fallback es lo que el usuario ve mientras el sprite carga (o si
  // falla), así que tiene que quedar del mismo orden de tamaño que el ícono real — si no,
  // "flashea" un cambio de tamaño visible apenas termina `ensureVehiculoIconos`.
  if (!map.getLayer('quivo-vehicle-fallback')) {
    map.addLayer({
      id: 'quivo-vehicle-fallback',
      type: 'circle',
      source: 'quivo-markers',
      filter: VEHICLE_BODY_FILTER,
      layout: { visibility: 'visible' },
      paint: {
        'circle-radius': 17,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.98,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 4,
      },
    });
  }
  // ENTREGA 14 — el sprite real del vehículo (`quivo-bus-${estadoFrescura}`, registrado por
  // `ensureVehiculoIconos`). Arranca OCULTO — `setVehiculoIconoDisponible` lo prende recién
  // cuando confirma que los tres sprites cargaron. `icon-allow-overlap: true`: con N vehículos
  // cerca uno del otro (terminal, semáforo) no queremos que MapLibre esconda uno por colisión —
  // los puntos de control sí pueden colisionar entre sí, los vehículos nunca.
  // FIX web-design-guidelines (hallazgo ALTA) — `icon-ignore-placement` se saca (default
  // `false`): con `true` el ícono NO se insertaba en el índice de colisión, así que no
  // reservaba su caja y los POI del estilo base (restaurantes, farmacias…) se dibujaban
  // encima. `icon-allow-overlap: true` ya garantiza que el vehículo mismo nunca se esconda
  // por colisión — no hace falta `ignore-placement` para eso. Como esta capa se agrega SIN
  // `beforeId` (queda arriba de todo el stack, incluidas las POI del estilo base), y MapLibre
  // procesa el índice de colisión de arriba hacia abajo (las capas más altas reservan primero),
  // el vehículo sigue ganando el conflicto — ahora además esconde al POI que colisiona con él
  // en vez de quedar tapado (confirmado con context7 `/maplibre/maplibre-gl-js`,
  // `pauseable_placement.ts`: "later style layers are placed first into the collision grid…
  // higher visual layers win collision conflicts against lower ones").
  // ENTREGA 15 — `icon-size: 0.5→0.62`. A 0.5 el sprite (rasterizado a `VEHICULO_ICONO_PX: 64`)
  // se dibuja a 32 px, el mismo orden de magnitud que los íconos de POI del estilo base
  // (restaurantes, farmacias…) — un vehículo, que es la capa de información PRINCIPAL de
  // `/en-vivo`, no puede leerse "igual de importante" que un ícono decorativo del mapa. 0.62
  // (~40 px) es un salto moderado — no duplica el tamaño ni lo lleva a competir con los labels
  // de calle — pero alcanza para que el bus se distinga del ruido del mapa base de un vistazo.
  if (!map.getLayer('quivo-vehicle-symbols')) {
    map.addLayer({
      id: 'quivo-vehicle-symbols',
      type: 'symbol',
      source: 'quivo-markers',
      filter: VEHICLE_BODY_FILTER,
      layout: {
        visibility: 'none',
        // ENTREGA 16 — `case` de respaldo: un `pinType: 'vehicle'` sin `estadoFrescura` (nunca
        // pasa desde `/en-vivo`, que siempre lo setea — ver `construirMarcadoresVehiculos` —
        // pero SÍ puede pasar en un consumidor futuro del design system) cae al sprite
        // `reportando` en vez de pedirle a MapLibre la imagen inexistente `quivo-bus-`
        // (`estadoFrescura` vacío concatenado) — eso dejaría al vehículo sin ícono ni fallback
        // visible (`quivo-vehicle-fallback` ya está oculto en cuanto los sprites cargan).
        'icon-image': ['concat', 'quivo-bus-', ['case', ['==', ['get', 'estadoFrescura'], ''], 'reportando', ['get', 'estadoFrescura']]],
        'icon-size': 0.62,
        'icon-allow-overlap': true,
      },
    });
  }
  // Placa del vehículo, debajo del ícono/fallback — capa propia (en vez de reusar
  // `quivo-marker-popup-anchor`, ver su filtro más abajo) porque tiene que verse SIEMPRE
  // (`text-allow-overlap`) y en cualquier zoom, a diferencia del label genérico de paradas
  // (que recién aparece en `minzoom: 13` y puede ocultarse por colisión).
  // FIX web-design-guidelines (hallazgo ALTA) — mismo motivo que `quivo-vehicle-symbols`:
  // sin `text-ignore-placement` la placa reserva su caja en el índice de colisión y los POI
  // del mapa base dejan de dibujarse encima.
  if (!map.getLayer('quivo-vehicle-labels')) {
    map.addLayer({
      id: 'quivo-vehicle-labels',
      type: 'symbol',
      source: 'quivo-markers',
      filter: VEHICLE_LABELS_FILTER,
      layout: {
        'text-field': ['get', 'placa'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        // ENTREGA 15 — `1.7em→2em`: con el ícono más grande (ver `icon-size` arriba) el borde
        // inferior del bus queda más abajo; sin este ajuste la placa arrancaba pegada (o
        // superpuesta) al ícono en vez de debajo de él.
        'text-offset': [0, 2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(15,17,26,0.85)', 'text-halo-width': 1.6 },
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
      // ENTREGA 14 — `vehicle` queda afuera: ya tiene su propio label SIEMPRE visible
      // (`quivo-vehicle-labels`, sin `minzoom` ni límite de colisión). Sin este filtro, un
      // vehículo mostraría la placa DOS veces superpuestas a partir de zoom 13. `pulse` (nodos
      // del editor/demo de landing, ENTREGA 16) SÍ sigue acá — el punto pendiente ("Punto
      // marcado") y el nodo seleccionado dependen de este label genérico para su texto.
      filter: MARKER_POPUP_ANCHOR_FILTER,
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
// ENTREGA 15 — arreglo del bug de la Entrega 13/14: tocar un vehículo no abría su detalle. La
// Entrega 14 sacó a los vehículos de `quivo-marker-points` (ver `MARKER_POINTS_FILTER` más
// arriba — `pinType: 'vehicle'` desde la Entrega 16) y los movió a tres capas propias, pero
// nadie enganchó click/hover a esas capas
// nuevas — `wireFeatureClicks`/el `mousedown` de drag seguían escuchando solo
// `quivo-marker-points`, así que un click sobre un vehículo nunca generaba ni un
// `queryRenderedFeatures` hit ahí. Se agregan las tres:
// - `quivo-vehicle-symbols` / `quivo-vehicle-fallback`: el cuerpo del vehículo (ícono real o
//   círculo de respaldo) — nunca están las dos visibles a la vez (`setVehiculoIconoDisponible`),
//   pero como MapLibre tolera de sobra escuchar una capa oculta u opcionalmente inexistente en
//   el momento del registro (ver comentario de `resolveMarkerClick` más abajo), alcanza con
//   incluir ambas siempre en vez de alternar el listener según cuál está activa.
// - `quivo-vehicle-labels`: la placa. SÍ se suma como clickeable — es el label que se dibuja
//   siempre (`text-allow-overlap`, sin `minzoom`), a diferencia de los labels genéricos de
//   parada/nodo que nunca son clickeables por su cuenta. En zoom bajo el ícono del bus mide
//   pocos píxeles y la placa (más ancha, en `Noto Sans Bold`) es a menudo el blanco de toque
//   más grande y más fácil de acertar con el dedo — dejarla afuera haría que "tocar la placa"
//   (un gesto natural: es lo que identifica al vehículo) no hiciera nada.
// Drag (`mousedown` más abajo) reutiliza esta misma constante sin riesgo: los vehículos nunca
// traen `draggable: true` (`construirMarcadoresVehiculos` en `map-builders.ts` no lo setea), así
// que el handler de drag los descarta en su primer `if` sin efecto secundario.
const MARKER_CLICK_LAYERS = ['quivo-marker-points', 'quivo-vehicle-symbols', 'quivo-vehicle-fallback', 'quivo-vehicle-labels'];

/**
 * Resuelve el `onClick` de un marcador (punto de control o vehículo) para un click que
 * MapLibre ya resolvió contra una de las capas de `MARKER_CLICK_LAYERS` — extraída como
 * función PURA (ENTREGA 15, sin `Map` de MapLibre/WebGL de por medio) para poder testear el
 * enganche capa→feature→`onClick` sin levantar un mapa real, que es justamente lo que el bug
 * original no tenía cubierto: los tests existentes probaban `markersWithVehicleOverride` y el
 * `onClick` de `map-builders`, pero ninguno verificaba que la capa donde MapLibre dispara el
 * evento estuviera efectivamente escuchada. Antes del fix, llamar a esto con
 * `layerId: 'quivo-vehicle-symbols'` devolvía `undefined` aunque el vehículo tuviera `onClick`
 * — el chequeo de membership de acá abajo es deliberadamente redundante con el filtro que ya
 * aplica `map.on('click', layers, …)` (MapLibre filtra `layers` contra las capas que existen al
 * momento del evento, no al momento del registro — ver nota en `wireFeatureClicks`), pero hace
 * que la función sea auto-contenida y testeable sin simular ese filtrado interno de MapLibre.
 */
export function resolveMarkerClick(
  layerId: string,
  featureId: string,
  markers: MapPoint[],
): (() => void) | undefined {
  if (!MARKER_CLICK_LAYERS.includes(layerId)) return undefined;
  return markers.find((m, i) => resolvePointId(m, i) === featureId)?.onClick;
}

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
  animatedVehicle,
  overlayMarkers,
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
  const animatedVehicleRef = useRef(animatedVehicle);
  animatedVehicleRef.current = animatedVehicle;

  const dragIdRef = useRef<string | null>(null);
  const fitOnceStateRef = useRef<{ key: string | number | undefined; fired: boolean }>({ key: fitKey, fired: false });

  // Estado (mutable, fuera de React) de la animación del marcador de vehículo — ver
  // `vehicle-marker-animation.ts`. `vehicleAnimRef` es la posición visual vigente,
  // `vehicleResetKeyRef` es el último `animatedVehicle.resetKey` visto (para saber cuándo
  // reiniciar de cero, ej. cambio de sesión) y `vehicleRafRef` el frame de
  // `requestAnimationFrame` en vuelo, si hay alguno — `null` significa "no hay loop
  // corriendo", que es la condición de reposo (nada consumiendo CPU) que pide el criterio de
  // "sin sesión activa, sin animación".
  const vehicleAnimRef = useRef<EstadoAnimacionVehiculo>(estadoInicialAnimacion());
  const vehicleResetKeyRef = useRef<string | null>(null);
  const vehicleRafRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  // `overlayMarkers` (aditivo, ver JSDoc en `RouteMapProps`) — un `maplibregl.Marker` real por
  // id, fuera de React (igual que `mapRef`/`vehicleAnimRef`), más el elemento DOM que le pasamos
  // como `element` para poder montar `content` adentro vía `createPortal`. `overlayPortals`
  // (estado, sí en React) es la proyección de ese `Map` que necesita el JSX de abajo para
  // renderizar los portales — se recalcula cada vez que el efecto de sincronización cambia el
  // `Map`, nunca se deriva directo del ref (React no re-renderiza por mutaciones a un ref).
  const overlayMarkersRef = useRef<
    Map<string, { marker: MapLibreMarker; el: HTMLDivElement; anchor: 'center' | 'bottom' }>
  >(new Map());
  const [overlayPortals, setOverlayPortals] = useState<Array<{ id: string; el: HTMLDivElement }>>([]);

  // Creación del mapa — una sola vez por montaje real. A diferencia de `<MapContainer>` de
  // react-leaflet, MapLibre no deja un id "sucio" en el contenedor al desmontar bajo Strict
  // Mode (`map.remove()` limpia de verdad), así que un `useEffect` simple con su cleanup real
  // alcanza — sin el `MapCanvas`/`LeafletProvider` a medida que hacía falta con Leaflet.
  useEffect(() => {
    let cancelled = false;
    // Capturado ACÁ (no dentro del cleanup de más abajo) — el mismo `Map` vive durante todo
    // este efecto (nunca se reasigna `overlayMarkersRef.current`), pero el lint de
    // `react-hooks/exhaustive-deps` pide leer `.current` fuera de la función de cleanup para
    // no depender de qué haya en el ref en el momento en que React la ejecute.
    const overlayMarkersOfThisMount = overlayMarkersRef.current;

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
      reducedMotionRef.current =
        typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
        setSourceData(
          map,
          'quivo-markers',
          pointFeatures(
            markersWithVehicleOverride(current.markers, vehicleAnimRef.current, animatedVehicleRef.current?.markerId),
            isDarkRef.current,
            'marker',
          ),
        );
        setSourceData(map, 'quivo-zones', zoneFeatures(current.zones, isDarkRef.current));
        mapReadyRef.current = true;
        setMapReady(true);
        map.resize();

        // ENTREGA 14 — registro asíncrono de los sprites del vehículo. Corre DESPUÉS de
        // marcar el mapa listo (no bloquea el primer render): el fallback de círculo
        // (`quivo-vehicle-fallback`) ya está visible desde `ensureDataLayers`, así que los
        // vehículos se ven de inmediato aunque esto tarde o falle.
        void ensureVehiculoIconos(map).then((disponible) => {
          if (cancelled || mapRef.current !== map) return;
          setVehiculoIconoDisponible(map, disponible);
        });
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
      // `layers` puede incluir ids que todavía no existen en el estilo al momento de este
      // `map.on(...)` (pasa con los cuatro `wireFeatureClicks` de acá abajo: se registran de
      // forma síncrona en `initialize()`, ANTES de que dispare `map.on('load', …)` — que es
      // donde `ensureDataLayers` recién agrega las capas reales). No es un problema: MapLibre
      // resuelve el listener delegado evaluando `layers` contra `this.getLayer(id)` en cada
      // evento (no al registrarlo), así que una capa ausente en ese instante simplemente no
      // aporta features a ese click — nunca lanza ni deja el listener a medio registrar. Por
      // eso agregar capas nuevas a un array de arriba (como se hizo con `MARKER_CLICK_LAYERS`)
      // no necesita reordenar nada ni esperar a que el mapa cargue.
      function wireFeatureClicks(layers: string[], resolve: (id: string, layerId: string) => (() => void) | undefined) {
        map.on('click', layers, (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id;
          const layerId = feature?.layer?.id;
          if (typeof id !== 'string' || typeof layerId !== 'string') return;
          resolve(id, layerId)?.();
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
      wireFeatureClicks(MARKER_CLICK_LAYERS, (id, layerId) => resolveMarkerClick(layerId, id, dataRef.current.markers));

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
      // El mapa se destruye — sacar los `overlayMarkers` ANTES (cada `marker.remove()` todavía
      // necesita a `this._map` vivo para desenganchar sus propios listeners de `move`/`click`),
      // no después de `mapRef.current?.remove()`.
      overlayMarkersOfThisMount.forEach((entry) => entry.marker.remove());
      overlayMarkersOfThisMount.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
      // El mapa se destruye — cortar cualquier loop de animación del marcador de vehículo
      // que siguiera en vuelo, si no quedaría pidiendo frames sobre un mapa ya desmontado.
      if (vehicleRafRef.current !== null) {
        cancelAnimationFrame(vehicleRafRef.current);
        vehicleRafRef.current = null;
      }
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

  // `prefers-reduced-motion`: si el usuario lo tiene activo, `encolarNuevosPuntos` salta
  // siempre directo al último punto (ver `vehicle-marker-animation.ts`) — acá solo se
  // mantiene el ref al día, tanto en la carga inicial como si el usuario lo cambia en vivo
  // desde el sistema operativo mientras la pestaña sigue abierta.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = media.matches;
    const onChange = () => {
      reducedMotionRef.current = media.matches;
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
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
        setSourceData(
          map,
          'quivo-markers',
          pointFeatures(
            markersWithVehicleOverride(current.markers, vehicleAnimRef.current, animatedVehicleRef.current?.markerId),
            media.matches,
            'marker',
          ),
        );
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
    setSourceData(
      map,
      'quivo-markers',
      pointFeatures(
        markersWithVehicleOverride(markers, vehicleAnimRef.current, animatedVehicle?.markerId),
        isDarkRef.current,
        'marker',
      ),
    );
    setSourceData(map, 'quivo-zones', zoneFeatures(zones, isDarkRef.current));
  }, [routes, stops, markers, zones, mapReady, animatedVehicle?.markerId]);

  // Sincroniza `overlayMarkers` (aditivo, ver JSDoc en `RouteMapProps`) contra el `Map` de
  // markers montados en `overlayMarkersRef` — altas/actualizaciones/bajas por `id`, resueltas
  // por la función pura `diffOverlayMarkers` (ver `route-map-overlay-markers.ts` para el
  // criterio de dedupe). Nada de esto corre mientras el consumidor no pasa la prop: con
  // `overlayMarkers` ausente y sin nada montado todavía, el diff da siempre `{add: [],
  // update: [], remove: []}` — el guard de abajo evita incluso ese cálculo y el `setState` de
  // `overlayPortals` de más, así que el comportamiento previo (sin esta prop) queda intacto.
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    const mounted = overlayMarkersRef.current;
    const next = overlayMarkers ?? [];
    if (!map || !maplibre || !mapReadyRef.current) return;
    if (next.length === 0 && mounted.size === 0) return;

    const { add, update, remove } = diffOverlayMarkers(mounted.keys(), next);

    remove.forEach((id) => {
      mounted.get(id)?.marker.remove();
      mounted.delete(id);
    });

    add.forEach((overlayMarker) => {
      const el = document.createElement('div');
      el.className = 'qv-route-map__overlay-marker';
      if (overlayMarker.zIndex !== undefined) el.style.zIndex = String(overlayMarker.zIndex);
      // El `content` del consumidor trae su propio manejo de click (su propio `<button>`) —
      // sin estos `stopPropagation`, MapLibre engancha estos mismos eventos a nivel del
      // contenedor del canvas (`map.getCanvasContainer()`, donde `Marker.addTo` cuelga este
      // mismo `el`), así que interactuar con el marker burbujearía hasta disparar el
      // `onMapClick` general, los handlers de click por feature (`wireFeatureClicks`) y los
      // gestos de mapa (paneo/doble-click-zoom) como si fuera una interacción suelta sobre el
      // mapa. `wheel` queda afuera a propósito: el usuario tiene que poder hacer zoom con la
      // rueda aunque el cursor esté sobre un marker.
      el.addEventListener('click', (event) => event.stopPropagation());
      el.addEventListener('mousedown', (event) => event.stopPropagation());
      el.addEventListener('dblclick', (event) => event.stopPropagation());
      el.addEventListener('touchstart', (event) => event.stopPropagation());
      el.addEventListener('pointerdown', (event) => event.stopPropagation());
      const anchor = overlayMarker.anchor ?? 'center';
      const marker = new maplibre.Marker({ element: el, anchor })
        .setLngLat([overlayMarker.lng, overlayMarker.lat])
        .addTo(map);
      mounted.set(overlayMarker.id, { marker, el, anchor });
    });

    update.forEach((overlayMarker) => {
      const entry = mounted.get(overlayMarker.id);
      if (!entry) return;
      const nextAnchor = overlayMarker.anchor ?? 'center';
      if (entry.anchor !== nextAnchor) {
        // MapLibre no permite reconfigurar el `anchor` de un `Marker` ya creado — se recrea
        // el marker reusando el MISMO `el` (el portal de `content` montado ahí sigue vivo, ver
        // el JSDoc de `overlayPortals` más abajo) en vez de perder su estado de React de
        // vuelta a un alta/baja completa.
        entry.marker.remove();
        const marker = new maplibre.Marker({ element: entry.el, anchor: nextAnchor })
          .setLngLat([overlayMarker.lng, overlayMarker.lat])
          .addTo(map);
        mounted.set(overlayMarker.id, { marker, el: entry.el, anchor: nextAnchor });
      } else {
        entry.marker.setLngLat([overlayMarker.lng, overlayMarker.lat]);
      }
      entry.el.style.zIndex = overlayMarker.zIndex !== undefined ? String(overlayMarker.zIndex) : '';
    });

    if (add.length > 0 || remove.length > 0) {
      setOverlayPortals(Array.from(mounted.entries()).map(([id, entry]) => ({ id, el: entry.el })));
    }
  }, [overlayMarkers, mapReady]);

  // Animación del marcador de vehículo (ver `vehicle-marker-animation.ts` para la técnica y
  // la duración). Se dispara cuando llega un lote nuevo de posiciones (`animatedVehicle.points`
  // cambia de referencia — una vez por poll, no por frame) o cuando cambia el vehículo seguido
  // (`resetKey`). El propio loop de `requestAnimationFrame` es lo único que corre a ~60 fps, y
  // solo mientras hay una animación en curso — se autodetiene apenas la cola se vacía (ver
  // `enMovimiento` en `avanzarAnimacion`), así que una sesión inactiva o sin vehículo seguido
  // no deja nada consumiendo CPU en segundo plano.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    if (!animatedVehicle || animatedVehicle.points.length === 0) {
      vehicleAnimRef.current = estadoInicialAnimacion();
      vehicleResetKeyRef.current = null;
      if (vehicleRafRef.current !== null) {
        cancelAnimationFrame(vehicleRafRef.current);
        vehicleRafRef.current = null;
      }
      return;
    }

    if (vehicleResetKeyRef.current !== animatedVehicle.resetKey) {
      // Cambió el vehículo/sesión seguida (ej. el usuario eligió otro vehículo en el
      // selector) — arranca de cero: salto directo, sin animar una transición sin sentido
      // entre dos recorridos no relacionados.
      vehicleResetKeyRef.current = animatedVehicle.resetKey;
      vehicleAnimRef.current = estadoInicialAnimacion();
    }

    vehicleAnimRef.current = encolarNuevosPuntos(
      vehicleAnimRef.current,
      animatedVehicle.points,
      animatedVehicle.intervalMs,
      { reducirMovimiento: reducedMotionRef.current },
    );
    // Refleja el salto (o el arranque de una cola nueva, que todavía no mueve la posición
    // visual) de inmediato, sin esperar al próximo frame.
    setSourceData(
      map,
      'quivo-markers',
      pointFeatures(
        markersWithVehicleOverride(dataRef.current.markers, vehicleAnimRef.current, animatedVehicle.markerId),
        isDarkRef.current,
        'marker',
      ),
    );

    const hayAnimacionPendiente = vehicleAnimRef.current.segment !== null || vehicleAnimRef.current.queue.length > 0;
    if (vehicleRafRef.current === null && hayAnimacionPendiente) {
      const markerId = animatedVehicle.markerId;
      const tick = (timestamp: number) => {
        const currentMap = mapRef.current;
        if (!currentMap) {
          vehicleRafRef.current = null;
          return;
        }
        const resultado = avanzarAnimacion(vehicleAnimRef.current, timestamp);
        vehicleAnimRef.current = resultado.estado;
        setSourceData(
          currentMap,
          'quivo-markers',
          pointFeatures(
            markersWithVehicleOverride(dataRef.current.markers, vehicleAnimRef.current, markerId),
            isDarkRef.current,
            'marker',
          ),
        );
        vehicleRafRef.current = resultado.enMovimiento ? requestAnimationFrame(tick) : null;
      };
      vehicleRafRef.current = requestAnimationFrame(tick);
    }
  }, [animatedVehicle?.resetKey, animatedVehicle?.points, animatedVehicle?.intervalMs, animatedVehicle?.markerId, mapReady]);

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

  // `content` por id, para el `.map()` de portales de abajo — evita el `.find()` lineal por
  // portal montado (O(n²) con N overlays: N portales × un `.find()` de N en cada uno) que
  // había antes. Se recalcula solo cuando cambia la referencia de `overlayMarkers`.
  const overlayContentById = useMemo(() => {
    const contenidoPorId = new Map<string, ReactNode>();
    for (const marker of overlayMarkers ?? []) {
      contenidoPorId.set(marker.id, marker.content);
    }
    return contenidoPorId;
  }, [overlayMarkers]);

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
      {/* `overlayMarkers` (aditivo) — cada `content` se monta vía portal dentro del `<div>`
          que `maplibregl.Marker` ya posiciona sobre el mapa (ver el efecto de sincronización
          más arriba). `overlayPortals` guarda los pares `{id, el}` montados; el `content` se
          resuelve acá, en cada render, contra `overlayContentById` (memo del `overlayMarkers`
          más reciente) — así una actualización de contenido (sin alta/baja de ids) se refleja
          sin depender de que el efecto de arriba vuelva a tocar `overlayPortals`. Vacío
          mientras la prop no se use, así que esto no agrega nada al árbol cuando `RouteMap`
          no la recibe. */}
      {overlayPortals.map(({ id, el }) => createPortal(overlayContentById.get(id), el, id))}
    </div>
  );
}
