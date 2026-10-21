import type { MapPoint, MapRoute, MapZone } from '@quivo/design-system';
import type { ContextoEnVivo, CumplimientoRecorrido, PosicionEnVivo, PuntoTrazaGps, RutaSnap } from '@quivo/shared';
import { ApiError } from '../../../src/lib/api/client';
import { presentacionFrescura, sufijoPausa, type TrazaAcumulada } from '../../../src/lib/en-vivo/traza';
import { alertaMarcador } from '../../../src/lib/en-vivo/alertas';
import { rutasDeTraza } from '../../../src/lib/en-vivo/segmentos-traza';

export function construirRutas(
  contexto: ContextoEnVivo,
  puntos: readonly PuntoTrazaGps[] | undefined,
  rutasSnap: readonly RutaSnap[],
): MapRoute[] {
  const rutas: MapRoute[] = [
    {
      id: 'ruta-asignada',
      label: 'Ruta asignada',
      color: contexto.linea.color,
      dashed: true,
      points: contexto.ruta.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
    },
  ];
  if (puntos && puntos.length > 1) rutas.push(...rutasDeTraza(puntos, rutasSnap, 'Recorrido real'));
  return rutas;
}

/**
 * Última pasada validada de un punto de control (no la primera). El server ya devuelve
 * `cumplimientos` ordenado `ts asc` (`en-vivo.service.ts`), así que el último elemento que
 * matchea es el más reciente.
 *
 * `CumplimientoPc` modela explícitamente varias pasadas por `(sesionId, puntoControlId)` con
 * la columna `pasada` (multi-vuelta, `schema.prisma`): un `.find()` (primera coincidencia) se
 * queda pegado a la primera pasada de la sesión — un punto de control fallado en la vuelta 1
 * y cumplido en la vuelta 2 quedaría "No cumplido" en el mapa el resto del día.
 */
export function ultimaPasada(
  traza: TrazaAcumulada | undefined,
  puntoControlId: string,
): CumplimientoRecorrido | undefined {
  if (!traza) return undefined;
  let ultimo: CumplimientoRecorrido | undefined;
  for (const c of traza.cumplimientos) {
    if (c.puntoControlId === puntoControlId && c.validadoPor === 'worker') ultimo = c;
  }
  return ultimo;
}

/**
 * ENTREGA 13/14 — puntos de control de la sesión con detalle abierto (`sesionSeleccionada`
 * en `page.tsx`). Antes esta función (`construirMarcadores`) también agregaba el marker del
 * vehículo al final, tomando su posición del ÚLTIMO punto de la traza — eso dejó de tener
 * sentido: ahora la posición "en vivo" de CADA vehículo (haya detalle abierto o no) sale de
 * `GET /reportes/en-vivo/posiciones` (ver `construirMarcadoresVehiculos`), no de la traza de
 * una sola sesión. Motor de renderizado: MapLibre GL (`route-map-impl.tsx`), no Leaflet — el
 * `color` de cada punto termina en la propiedad `color` de un feature GeoJSON que consume la
 * capa `quivo-marker-points`, donde `var(--qv-color-*)` sí se resuelve (`resolveColor`).
 */
export function construirPuntosControl(
  contexto: ContextoEnVivo,
  traza: TrazaAcumulada | undefined,
): MapPoint[] {
  return contexto.puntosControl.map((pc, index) => {
    const cumplimiento = ultimaPasada(traza, pc.id);
    const cumplido = cumplimiento?.cumplido ?? false;
    return {
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      label: `Punto de control ${index + 1}`,
      description: cumplimiento
        ? `${cumplido ? 'Cumplido' : 'No cumplido'} — ${cumplimiento.distanciaM.toFixed(0)} m`
        : 'Todavía sin pasada validada',
      color: cumplido ? 'var(--qv-color-success)' : 'var(--qv-text-muted)',
      pinType: 'stop',
    };
  });
}

/** Filtro por línea, client-side — mismo patrón que `vehiculos/page.tsx` (`filteredRows` de
 * `use-vehiculos.ts`): el endpoint trae TODA la flota activa/reciente y el `<Select>` de
 * línea filtra en memoria, sin round-trip. `lineaId === ''` ("Todas las líneas") es un no-op. */
export function filtrarPorLinea(posiciones: PosicionEnVivo[], lineaId: string): PosicionEnVivo[] {
  return lineaId ? posiciones.filter((p) => p.lineaId === lineaId) : posiciones;
}

/** Id ESTABLE del marker de un vehículo — no el id sintético `${lat}:${lng}:${index}` que
 * arma `resolvePointId` sin esto (`route-map-impl.tsx`): la posición cambia en cada poll de
 * `/en-vivo/posiciones` (cada 2 s), así que un id derivado de lat/lng cambiaría con ella, y
 * `RouteMap` necesita un id fijo para saber, entre un render y el siguiente, que sigue siendo
 * "el mismo" marker al que aplicarle la animación (`animatedVehicle.markerId`) o el override
 * de posición en vivo.
 *
 * 🔴 ENTREGA 14 — reemplaza a la vieja constante `ID_MARCADOR_VEHICULO` (un único id fijo,
 * `'vehiculo-en-vivo'`): con **todos** los vehículos dibujados a la vez (Entrega 13), un id
 * único chocaría — los N marcadores se pisarían entre sí en la misma fuente GeoJSON
 * `quivo-markers`. Namespaced por `sesionId`, que es único por definición (`PosicionEnVivo.id`
 * = `sesionOperativa.id`).
 */
export function idMarcadorVehiculo(sesionId: string): string {
  return `vehiculo:${sesionId}`;
}

/** Opciones de PR E (`docs/plan-en-vivo-alertas.md`): lo que el marcador necesita además de la posición. */
export interface OpcionesMarcadoresVehiculos {
  /** Sesión con el panel abierto: el marcador se resalta y se apila encima. */
  seleccionadoId?: string | null;
  /** Color de la línea por `lineaId` (el poll de posiciones no lo trae): anillo del marcador. */
  colorLineaPorId?: Readonly<Record<string, string | null | undefined>>;
}

/**
 * Alerta, foto, color de línea, selección y badge "M" del marcador. `parpadea` = hay infracciones
 * abiertas (`alertaMarcador`): al "Atender", la infracción pasa de abierta a atendida y el marcador
 * deja de parpadear pero conserva el ícono fijo de severidad (pendiente E #1); al descartarla sale
 * de la cuenta y el ícono desaparece. "M" = la vuelta en curso está designada a una variante con
 * punto de espera. `fotoUrl` viene en `PosicionEnVivo` (vacía/`null` si la unidad no tiene foto).
 */
function camposAlertaYFoto(p: PosicionEnVivo, opciones: OpcionesMarcadoresVehiculos): Partial<MapPoint> {
  const alerta = alertaMarcador(p);
  const foto = p.fotoUrl?.trim();
  const colorLinea = opciones.colorLineaPorId?.[p.lineaId];
  return {
    ...(foto ? { fotoUrl: foto } : {}),
    ...(colorLinea ? { colorLinea } : {}),
    ...(alerta ? { alerta } : {}),
    ...(p.vuelta?.varianteId ? { molinos: true } : {}),
    ...(opciones.seleccionadoId === p.id ? { seleccionado: true } : {}),
  };
}

/**
 * ENTREGA 13/14 — TODOS los vehículos con sesión activa/reciente, ya filtrados por línea en
 * `page.tsx` (filtrado client-side, mismo patrón que `vehiculos/page.tsx`). Un vehículo sin
 * primer fix (`lat`/`lng` `null` — la sesión existe pero nunca entró un punto GPS) NO se
 * dibuja: no hay dónde ponerlo. `page.tsx` lo cuenta aparte para el resumen honesto ("N en el
 * mapa · M sin GPS todavía") en vez de fingir que no existen.
 *
 * `estadoFrescura`/`placa` viajan como propiedades del `MapPoint` (Entrega 14): las consume
 * `quivo-vehicle-symbols`/`quivo-vehicle-labels` en `route-map-impl.tsx` para elegir el
 * sprite (la FORMA cambia con el estado, no solo el color) y dibujar la placa junto al ícono.
 */
export function construirMarcadoresVehiculos(
  posiciones: PosicionEnVivo[],
  onSeleccionar: (sesionId: string) => void,
  opciones: OpcionesMarcadoresVehiculos = {},
): MapPoint[] {
  return posiciones
    .filter((p): p is PosicionEnVivo & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
    .map((p) => {
      const presentacion = presentacionFrescura(p.estadoFrescura);
      return {
        id: idMarcadorVehiculo(p.id),
        lat: p.lat,
        lng: p.lng,
        label: p.vehiculoPlaca,
        description: `${p.lineaNombre} · ${p.conductorNombre} · ${presentacion.etiqueta}${sufijoPausa(p)}`,
        color: presentacion.color,
        // ENTREGA 16 — `'vehicle'`, no `'pulse'`: un fix de code-review le devolvió `'pulse'` a
        // su significado original (nodos pulsantes del editor de trazado/demo de landing) — los
        // vehículos reales de `/en-vivo` tienen su propio pinType desde acá en adelante (ver
        // `MARKER_PULSE_FILTER`/`MARKER_POINTS_FILTER`/`VEHICLE_BODY_FILTER` en
        // `route-map-impl.tsx`).
        pinType: 'vehicle',
        estadoFrescura: p.estadoFrescura,
        placa: p.vehiculoPlaca,
        ...camposAlertaYFoto(p, opciones),
        onClick: () => onSeleccionar(p.id),
      };
    });
}

export function construirZonas(contexto: ContextoEnVivo): MapZone[] {
  return contexto.puntosControl.map((pc, index) => ({
    lat: pc.coord.coordinates[1],
    lng: pc.coord.coordinates[0],
    radiusMeters: pc.radioToleranciaM,
    label: `Tolerancia PC ${index + 1}`,
    // Hex literal a propósito, NO `var(--qv-text-muted)`: este color va al `paint` de la capa
    // `quivo-zone-fill`/`quivo-zone-outline` de MapLibre GL (`route-map-impl.tsx`), que
    // termina en atributos de presentación WebGL — ahí `var()` nunca se resuelve (a diferencia
    // de `construirPuntosControl`/`construirMarcadoresVehiculos`, donde el color pasa por
    // `resolveColor` antes de llegar al feature). Mismo valor que el token `--qv-text-muted`
    // claro; no reacciona a `prefers-color-scheme` en oscuro.
    color: '#94a3b8',
  }));
}

export function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
