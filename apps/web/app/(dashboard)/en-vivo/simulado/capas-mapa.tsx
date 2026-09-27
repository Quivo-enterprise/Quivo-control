'use client';

import type { MapOverlayMarker, MapRoute, MapZone } from '@quivo/design-system';
import {
  demandaDe,
  paradasConAltaDemanda,
  type EstadoFlotaMock,
  type EstadoTrufi,
  type LineaMock,
  type LineaMockId,
  type TrufiMock,
} from '../../../../src/lib/mock-flota';

/**
 * Capas EXTRA del mapa para el guion del delegado (E07 04:32, E08) — todo construido sobre
 * props que ya existen en `RouteMap` (`routes`/`overlayMarkers`/`zones`), sin tocar
 * `packages/design-system`. Archivo `.tsx` (no `.ts`, aunque el plan lo nombra `capas-mapa.ts`
 * como ejemplo): el overlay de alta demanda necesita devolver JSX en `content`.
 */

const COLOR_ATASCO = '#dc2626';
const COLOR_DESVIO = '#f97316';

/**
 * Rutas EXTRA de escenario sobre los trufis VISIBLES (respeta el filtro de línea porque solo
 * itera `trufisVisibles`, ya filtrados por el caller): tramo atascado (rojo punteado), traza
 * del desvío ya recorrido (naranja punteado) y — solo para el trufi con la ficha abierta — su
 * traza de la vuelta actual, en el color de su línea. IDs únicos y estables por trufi+tipo.
 *
 * Nota: `MapRoute` no expone un ancho de línea por-ruta (todo el layer `quivo-route-line`
 * comparte `line-width: 5.5` en `route-map-impl.tsx`) — "trazo fino" del guion se logra acá
 * solo por CONTRASTE de color contra el trazo grueso de la ruta fija, no por un ancho menor
 * (no se toca el design-system para agregar esa prop).
 */
export function rutasEscenarioDe(
  trufisVisibles: TrufiMock[],
  estadoTrufis: Record<string, EstadoTrufi>,
  lineas: Record<LineaMockId, LineaMock>,
  seleccionadoId: string | null,
): MapRoute[] {
  const rutas: MapRoute[] = [];
  for (const trufi of trufisVisibles) {
    const estadoTrufi = estadoTrufis[trufi.id];
    if (!estadoTrufi) continue;
    const linea = lineas[trufi.lineaId];

    if (estadoTrufi.fase === 'atascado' && estadoTrufi.tramoAtascado && estadoTrufi.tramoAtascado.length > 1) {
      rutas.push({
        id: `tramo-atascado-${trufi.id}`,
        label: 'Tramo atascado',
        color: COLOR_ATASCO,
        dashed: true,
        points: estadoTrufi.tramoAtascado.map(([lat, lng]) => ({ lat, lng })),
      });
    }

    if (estadoTrufi.fase === 'desviado' && estadoTrufi.trazaDesvio && estadoTrufi.trazaDesvio.length > 1) {
      rutas.push({
        id: `traza-desvio-${trufi.id}`,
        label: 'Desvío no autorizado',
        color: COLOR_DESVIO,
        dashed: true,
        points: estadoTrufi.trazaDesvio.map(([lat, lng]) => ({ lat, lng })),
      });
    }

    if (trufi.id === seleccionadoId && estadoTrufi.traza.length > 1) {
      rutas.push({
        id: `traza-seleccionado-${trufi.id}`,
        color: linea.color === '#ffffff' ? '#e2e8f0' : linea.color,
        points: estadoTrufi.traza.map(([lat, lng]) => ({ lat, lng })),
      });
    }
  }
  return rutas;
}

/** Overlay pulsante "~N esperando" sobre las paradas con demanda alta ahora mismo (líneas
 * visibles bajo el filtro) — `paradasConAltaDemanda`/`demandaDe` ya toman `estado.horaPico`, así
 * que alternar la hora pico (panel de simulación) mueve este overlay solo. Recalculado en cada
 * render del padre — como el padre re-renderiza en cada tick (1 s, `estado` cambia de
 * referencia), nunca más seguido que eso. */
export function overlayAltaDemandaDe(
  estado: EstadoFlotaMock,
  lineasVisibles: LineaMock[],
  ahora: Date,
): MapOverlayMarker[] {
  const marcadores: MapOverlayMarker[] = [];
  for (const linea of lineasVisibles) {
    const paradas = paradasConAltaDemanda(estado, ahora, linea.id);
    for (const parada of paradas) {
      const demanda = demandaDe(parada.id, ahora, estado.horaPico);
      marcadores.push({
        id: `demanda-${parada.id}`,
        lat: parada.lat,
        lng: parada.lng,
        anchor: 'center',
        zIndex: 5,
        content: (
          // Ítem 1(b) del guion de fixes: por default solo se ve el punto pulsante — el texto
          // "~N esperando" se revela en hover/focus (CSS, `simulado.css`). `tabIndex={0}` para
          // que sea alcanzable por teclado, no solo mouse; el `aria-label` ya lleva la info
          // completa así que un lector de pantalla la tiene sin depender del hover.
          <div
            className="qv-demanda-marker"
            role="status"
            tabIndex={0}
            aria-label={`${parada.nombre}: demanda alta, ~${demanda.esperando} personas esperando`}
          >
            <span className="qv-demanda-marker__pulse" aria-hidden="true" />
            <span className="qv-demanda-marker__label" aria-hidden="true">
              ~{demanda.esperando} esperando
            </span>
          </div>
        ),
      });
    }
  }
  return marcadores;
}

/** Mezcla `hex` hacia `hacia` (gris neutro por default) en proporción `t` (0 = `hex` puro, 1 =
 * `hacia` puro) — a diferencia de un alfa transparente puro (probado primero y descartado), esto
 * sigue siendo OPACO para cualquier color de entrada, incluido el blanco de la Línea 120: un
 * `rgba(255,255,255,0.25)` sobre las teselas claras del basemap es prácticamente invisible, así
 * que "atenuar" esa línea la borraba del todo en vez de dejarla en segundo plano. */
function mezclarHaciaGris(hex: string, t: number, hacia: [number, number, number] = [148, 163, 184]): string {
  const limpio = hex.replace('#', '');
  const completo = limpio.length === 3 ? limpio.split('').map((c) => c + c).join('') : limpio;
  const r = Number.parseInt(completo.slice(0, 2), 16);
  const g = Number.parseInt(completo.slice(2, 4), 16);
  const b = Number.parseInt(completo.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  const mezclar = (c: number, hg: number) => Math.round(c + (hg - c) * t);
  return `rgb(${mezclar(r, hacia[0])}, ${mezclar(g, hacia[1])}, ${mezclar(b, hacia[2])})`;
}

/** Color de ruta con la línea `lineaId` resaltada (E08 06:01, `VistaConfiguracion.onResaltarLinea`):
 * la línea resaltada mantiene su color pleno, las demás se atenúan mezclando su color hacia un
 * gris neutro (`MapRoute.color` acepta cualquier color CSS válido, no solo hex — `resolveColor`
 * en `route-map-impl.tsx` lo pasa tal cual a `line-color`). Sin `resaltarLineaId`, no atenúa
 * nada. */
export function colorConResaltado(lineaId: LineaMockId, color: string, resaltarLineaId: LineaMockId | null): string {
  if (!resaltarLineaId || resaltarLineaId === lineaId) return color;
  return color.startsWith('#') ? mezclarHaciaGris(color, 0.7) : color;
}

/** Círculos de tolerancia de los puntos de control ACTIVOS de `lineaId` (config en vivo) — para
 * `VistaConfiguracion.onResaltarLinea` (E08 06:01: "recorrido resaltado en el mapa... marcar
 * punto de control + radio"). */
export function zonasPuntosControlDe(
  linea: LineaMock,
  puntosControl: { id: string; avance: number; radioToleranciaM: number }[],
): MapZone[] {
  const activos = new Set(puntosControl.map((p) => p.id));
  return linea.paradas
    .filter((p) => activos.has(p.id))
    .map((p) => {
      const config = puntosControl.find((pc) => pc.id === p.id);
      return {
        id: `zona-pc-${p.id}`,
        lat: p.lat,
        lng: p.lng,
        radiusMeters: config?.radioToleranciaM ?? p.radioToleranciaM,
        label: p.nombre,
        color: linea.color === '#ffffff' ? '#0f172a' : linea.color,
      };
    });
}
