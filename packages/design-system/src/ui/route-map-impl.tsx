'use client';

// Implementación real de `RouteMap` — vive separada de `./RouteMap.tsx` a propósito. Este
// archivo importa Leaflet/`react-leaflet` a nivel de módulo, y Leaflet toca `window` en
// import-time (`L.Browser` hace feature-detection al cargar). Por eso NUNCA se importa de
// forma estática: `./RouteMap.tsx` (el wrapper que exporta el barrel) lo carga con
// `React.lazy(() => import('./route-map-impl.js'))` solo después de montar en cliente, para
// que Next.js no lo arrastre al bundle de servidor durante el prerender de SSR/SSG.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  LeafletProvider,
  createLeafletContext,
  type LeafletContextInterface,
} from '@react-leaflet/core';
import {
  Circle,
  CircleMarker,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { cx } from '../utils.js';
import type { MapPoint, MapRoute, MapZone } from '../types.js';
import { Loader } from './primitives.js';

// La Paz — centro por defecto cuando `RouteMap` se monta sin ningún punto todavía (ej.
// "Nueva ruta" antes del primer clic). QUIVO opera transporte urbano en Bolivia; no hay una
// ciudad "correcta" documentada para este fallback — es una decisión a revisar.
const DEFAULT_CENTER: [number, number] = [-16.5, -68.15];
const DEFAULT_ZOOM = 13;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Fallback para `pathOptions.color`/`fillColor` de Leaflet (Polyline/Circle/CircleMarker):
// esos valores terminan en atributos de presentación SVG (`stroke`/`fill`), donde `var()`
// nunca se resuelve — a diferencia de `buildDivIcon`, que sí escribe una custom property CSS
// de verdad en un `style` inline. Literal hexadecimal, igual al `--qv-color-primary` claro de
// `tokens.css`. Se usa `||` (no `??`) a propósito: un `color` de string vacío (ColorPicker sin
// tocar, ver `form.tsx`) también debe caer acá, no solo `undefined`.
const DEFAULT_ROUTE_COLOR = '#4338ca';

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
}

function buildDivIcon(point: MapPoint): L.DivIcon {
  const color = point.color ?? 'var(--qv-color-primary)';
  if (point.pinType === 'stop') {
    return L.divIcon({
      html: `<span class="qv-map-pin qv-map-pin--stop" style="--qv-map-pin-color:${color}"></span>`,
      className: 'qv-map-pin-wrapper',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }
  const pulse = point.pinType === 'pulse';
  return L.divIcon({
    html: `<span class="qv-map-pin qv-map-pin--pin${pulse ? ' qv-map-pin--pulse' : ''}" style="--qv-map-pin-color:${color}"></span>`,
    className: 'qv-map-pin-wrapper',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
  });
}

/**
 * Contenedor del mapa. Reemplaza a `<MapContainer>` de `react-leaflet@4.2.1`, que **no
 * sobrevive el doble montaje de React Strict Mode** (`reactStrictMode: true` en
 * `apps/web/next.config.ts`, y el App Router de Next 15 corre su propio React 19, donde el
 * doble-invoke DESATA y REATA los refs además de los efectos).
 *
 * Por qué falla el de la librería: crea el `L.Map` dentro de un *ref callback*
 * (`useCallback(..., [])`, ver `react-leaflet/lib/MapContainer.js`) y lo destruye en un
 * `useEffect(..., [context])`. En el primer commit `context` todavía vale `null`, así que
 * cuando Strict Mode simula el desmontaje ese cleanup es un no-op: el mapa nunca se destruye
 * y el `<div>` conserva su `_leaflet_id`. Al reatar el ref, el callback —cuyo `context`
 * capturado sigue siendo `null` por las deps vacías— vuelve a hacer `new L.Map(node)` sobre
 * un nodo sucio y Leaflet tira "Map container is already initialized".
 *
 * Acá el ciclo de vida del mapa vive en un `useEffect` con su cleanup real: Strict Mode
 * ejecuta crear → destruir → crear, y `Map.remove()` de Leaflet borra `_leaflet_id` del
 * contenedor (leaflet-src.js:3865), así que el segundo montaje encuentra el nodo limpio. Es
 * el mismo camino en dev y en producción — no hay rama condicional por entorno — y arregla
 * de paso la fuga de la versión original (el mapa fantasma que nunca se destruía).
 *
 * El contexto se publica con `LeafletProvider`/`createLeafletContext` de `@react-leaflet/core`
 * (API pública del paquete, la misma instancia física que resuelve `react-leaflet`), así que
 * los hijos —`TileLayer`, `Polyline`, `Marker`, `useMap`, `useMapEvents`…— siguen funcionando
 * sin cambios. Igual que `MapContainer`, los hijos solo se montan cuando el mapa ya existe.
 */
function MapCanvas({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [context, setContext] = useState<LeafletContextInterface | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    const map = new L.Map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: true,
    });
    setContext(createLeafletContext(map));

    return () => {
      // Deja el nodo reutilizable: `remove()` borra `container._leaflet_id` y desmonta los
      // panes que Leaflet había agregado adentro del `<div>`.
      map.remove();
      setContext(null);
    };
    // Una sola instancia por montaje: `center`/`zoom` son constantes de módulo y solo fijan
    // la vista inicial (`FitBounds` se encarga del encuadre posterior). Es el mismo contrato
    // que `MapContainer`, que tampoco reacciona a cambios de esas props.
  }, []);

  return (
    <div ref={containerRef} className={className} style={style}>
      {context === null ? null : <LeafletProvider value={context}>{children}</LeafletProvider>}
    </div>
  );
}

function ClickHandler({
  interactive,
  onMapClick,
}: {
  interactive: boolean;
  onMapClick?: (point: MapPoint) => void;
}) {
  useMapEvents({
    click(event) {
      if (!interactive || !onMapClick) return;
      onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** Ajusta el encuadre del mapa a los puntos visibles cada vez que cambian — `apps/web` ya
 * decide qué subconjunto mostrar (ej. solo el tramo alrededor del nodo que se está moviendo),
 * así que seguir ese conjunto con `fitBounds` es el comportamiento esperado, no un efecto
 * secundario a evitar. */
function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  const signature = points.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join('|');

  useEffect(() => {
    const [first] = points;
    if (points.length === 0 || !first) return;
    if (points.length === 1) {
      map.setView([first.lat, first.lng], Math.max(map.getZoom(), 14));
      return;
    }
    const bounds = L.latLngBounds(points.map((point): [number, number] => [point.lat, point.lng]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
    // El efecto solo debe reaccionar a un cambio real de coordenadas — `signature` ya las
    // resume; `points` cambia de referencia en cada render aunque el contenido sea el mismo.
  }, [signature, map]);

  return null;
}

/**
 * Mapa interactivo (Leaflet) para trazado y visualización de rutas — RF-24..33 (QUI-229) y
 * el detalle de recorridos (QUI-247). Reconstruye el componente perdido del repo hermano
 * (ver `docs/handoff.md`), incluyendo la prop `zones` que documentaba como agregada ahí.
 */
export function RouteMap({
  routes = [],
  markers = [],
  stops = [],
  zones = [],
  height = '420px',
  className,
  interactive = false,
  loading = false,
  onMapClick,
}: RouteMapProps) {
  const boundsPoints = useMemo(() => {
    const collected: { lat: number; lng: number }[] = [];
    for (const route of routes) collected.push(...route.points);
    for (const marker of markers) collected.push({ lat: marker.lat, lng: marker.lng });
    for (const stop of stops) collected.push({ lat: stop.lat, lng: stop.lng });
    for (const zone of zones) collected.push({ lat: zone.lat, lng: zone.lng });
    return collected;
  }, [routes, markers, stops, zones]);

  return (
    <div className={cx('qv-route-map', className)} style={{ height }}>
      <MapCanvas className="qv-route-map__canvas" style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ClickHandler interactive={interactive} onMapClick={onMapClick} />
        <FitBounds points={boundsPoints} />

        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points.map((point): [number, number] => [point.lat, point.lng])}
            pathOptions={{
              color: route.color || DEFAULT_ROUTE_COLOR,
              weight: 4,
              dashArray: route.dashed ? '6 10' : undefined,
            }}
          >
            {route.label && <Tooltip sticky>{route.label}</Tooltip>}
          </Polyline>
        ))}

        {zones.map((zone, index) => (
          <Circle
            key={`zone-${index}`}
            center={[zone.lat, zone.lng]}
            radius={zone.radiusMeters}
            pathOptions={{
              color: zone.color || DEFAULT_ROUTE_COLOR,
              fillColor: zone.color || DEFAULT_ROUTE_COLOR,
              fillOpacity: 0.14,
              weight: 2,
            }}
          >
            {zone.label && <Tooltip>{zone.label}</Tooltip>}
          </Circle>
        ))}

        {stops.map((stop, index) => (
          <CircleMarker
            key={`stop-${index}`}
            center={[stop.lat, stop.lng]}
            radius={6}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: stop.color || DEFAULT_ROUTE_COLOR,
              fillOpacity: 1,
            }}
          >
            {(stop.label || stop.description) && (
              <Tooltip>
                {stop.label}
                {stop.description ? <div>{stop.description}</div> : null}
              </Tooltip>
            )}
          </CircleMarker>
        ))}

        {markers.map((marker, index) => (
          <Marker key={`marker-${index}`} position={[marker.lat, marker.lng]} icon={buildDivIcon(marker)}>
            {(marker.label || marker.description) && (
              <Popup>
                {marker.label && <strong>{marker.label}</strong>}
                {marker.description ? <div>{marker.description}</div> : null}
              </Popup>
            )}
          </Marker>
        ))}
      </MapCanvas>
      {loading && (
        <div className="qv-route-map__loading">
          <Loader label="Cargando mapa..." />
        </div>
      )}
    </div>
  );
}
