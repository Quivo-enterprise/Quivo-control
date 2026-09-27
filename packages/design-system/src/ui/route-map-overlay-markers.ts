// Lógica de diffing pura para `overlayMarkers` (`RouteMap`) — separada de `route-map-impl.tsx`
// por el mismo motivo que `route-map-geometry.ts`: se puede testear sin levantar un `Map` de
// MapLibre/WebGL. El propio marcador DOM (`maplibregl.Marker` + `createPortal`) se crea,
// reposiciona y destruye en `route-map-impl.tsx`; este módulo solo decide QUÉ altas/bajas/
// actualizaciones hacen falta dado el set de ids ya montados y el array `overlayMarkers` más
// reciente — sin tocar el DOM ni `maplibre-gl`.

import type { ReactNode } from 'react';

/**
 * Marcador de overlay genérico y aditivo sobre `RouteMap`: a diferencia de `MapPoint` (que se
 * dibuja como feature GeoJSON dentro de una capa `circle`/`symbol` de MapLibre, sin DOM propio),
 * un `MapOverlayMarker` es un `maplibregl.Marker` real con su propio elemento `<div>` — el
 * `content` arbitrario del consumidor (ej. un botón con su propio manejo de click) se monta ahí
 * vía `createPortal`, en vez de tener que expresarse como propiedades planas de un feature
 * GeoJSON. Pensado para overlays que necesitan interactividad propia (botones, badges con
 * acciones) que las capas GeoJSON de `RouteMap` no pueden ofrecer.
 */
export interface MapOverlayMarker {
  id: string;
  lat: number;
  lng: number;
  /** Contenido de React que se renderiza dentro del elemento del marcador vía portal. */
  content: ReactNode;
  /** Ancla del marcador respecto de `lat`/`lng`. Opcional — default `'center'`. */
  anchor?: 'center' | 'bottom';
  /** z-index opcional para apilado (ej. el marcador seleccionado por encima del resto). */
  zIndex?: number;
}

/**
 * Compara el set de ids ya montados (`prevIds`) contra el `overlayMarkers` más reciente
 * (`next`) y devuelve qué marcadores hay que crear (`add`), cuáles ya existen y solo hay que
 * reposicionar/reapilar (`update`), y qué ids sobran y hay que destruir (`remove`).
 *
 * `next` puede traer ids duplicados — no es algo que este módulo deba validar, así que se
 * resuelve con "el último gana": si dos entradas de `next` comparten `id`, solo la última
 * sobrevive en `add`/`update`, exactamente como si el consumidor hubiera pasado un único
 * elemento con ese id. Ninguna de las dos queda "huérfana" creando dos markers para el mismo id.
 */
export function diffOverlayMarkers(
  prevIds: Iterable<string>,
  next: MapOverlayMarker[],
): { add: MapOverlayMarker[]; update: MapOverlayMarker[]; remove: string[] } {
  const prevSet = new Set(prevIds);
  // Dedupe por id conservando la última aparición — un `Map` insertado en orden de `next` y
  // reasignado en cada colisión ya da ese comportamiento sin lógica extra.
  const dedupedById = new Map<string, MapOverlayMarker>();
  for (const marker of next) dedupedById.set(marker.id, marker);

  const add: MapOverlayMarker[] = [];
  const update: MapOverlayMarker[] = [];
  for (const marker of dedupedById.values()) {
    (prevSet.has(marker.id) ? update : add).push(marker);
  }

  const remove: string[] = [];
  for (const id of prevSet) {
    if (!dedupedById.has(id)) remove.push(id);
  }

  return { add, update, remove };
}
