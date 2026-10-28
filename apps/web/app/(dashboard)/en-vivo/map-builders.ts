import type { MapPoint, MapRoute, MapZone } from '@quivo/design-system';
import type { ContextoEnVivo, CumplimientoRecorrido, PosicionEnVivo, PuntoControl, PuntoTrazaGps, Ruta, RutaSnap } from '@quivo/shared';
import { capitalizar } from '../rutas/route-utils';
import { ApiError } from '../../../src/lib/api/client';
import { presentacionFrescura, sufijoPausa, type TrazaAcumulada } from '../../../src/lib/en-vivo/traza';
import { alertaMarcador } from '../../../src/lib/en-vivo/alertas';
import { rutasDeTraza } from '../../../src/lib/en-vivo/segmentos-traza';
import { pcsEfectivos } from '../../../src/lib/en-vivo/pcs-efectivos';

// Ámbar: distinto del azul de la traza y de los colores de línea; lee como "desvío designado".
const COLOR_VARIANTE = '#f59e0b';

export function construirRutas(
  contexto: ContextoEnVivo,
  puntos: readonly PuntoTrazaGps[] | undefined,
  rutasSnap: readonly RutaSnap[],
  varianteId: string | null,
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
  // La geometría de la variante es solo el tramo extra (ida y vuelta sobre la base): se superpone, sin desplazarla.
  const variante = varianteId ? contexto.variantes.find((v) => v.id === varianteId) : undefined;
  if (variante && variante.geometria.coordinates.length > 1) {
    rutas.push({
      id: 'ruta-variante',
      label: `Variante: ${variante.nombre}`,
      color: COLOR_VARIANTE,
      sinOffset: true,
      points: variante.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
    });
  }
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
  contexto: Pick<ContextoEnVivo, 'puntosControl' | 'puntoEsperaPorVariante'>,
  traza: TrazaAcumulada | undefined,
  varianteId?: string | null,
): MapPoint[] {
  const efectivos = pcsEfectivos(contexto, varianteId);
  const punto = (pc: ContextoEnVivo['puntosControl'][number], label: string): MapPoint => {
    const cumplimiento = ultimaPasada(traza, pc.id);
    const cumplido = cumplimiento?.cumplido ?? false;
    return {
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      label,
      description: cumplimiento
        ? `${cumplido ? 'Cumplido' : 'No cumplido'} — ${cumplimiento.distanciaM.toFixed(0)} m`
        : 'Todavía sin pasada validada',
      color: cumplido ? 'var(--qv-color-success)' : 'var(--qv-text-muted)',
      pinType: 'stop',
    };
  };
  // El PC de espera (Molinos) se dibuja siempre, aunque la vuelta no lo designe (sin número):
  // el despachador lo necesita ver en el mapa.
  const idsEfectivos = new Set(efectivos.map((pc) => pc.id));
  const espera = contexto.puntosControl
    .filter((pc) => pc.rol === 'espera' && !idsEfectivos.has(pc.id))
    .map((pc) => punto(pc, 'Espera Molinos'));
  return [...efectivos.map((pc, index) => punto(pc, `Punto de control ${index + 1}`)), ...espera];
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
  /** Lugar en la cola de Molinos por `sesionId`, del servidor (`ordenColaMolinos`). */
  ordenMolinos?: ReadonlyMap<string, number>;
}

/**
 * Alerta, foto, color de línea, selección y badge "M" del marcador. `parpadea` = hay infracciones
 * abiertas (`alertaMarcador`): al "Atender", la infracción pasa de abierta a atendida y el marcador
 * deja de parpadear pero conserva el ícono de severidad con su color, atenuado (pendiente E #1); al descartarla sale
 * de la cuenta y el ícono desaparece. "M" = la vuelta en curso está designada a una variante con
 * punto de espera; con número cuando ya espera en la cola (`ordenMolinos`). `fotoUrl` viene en `PosicionEnVivo` (vacía/`null` si la unidad no tiene foto).
 */
function camposAlertaYFoto(
  p: PosicionEnVivo,
  opciones: OpcionesMarcadoresVehiculos,
  ordenMolinos?: number,
): Partial<MapPoint> {
  const alerta = alertaMarcador(p);
  const foto = p.fotoUrl?.trim();
  const colorLinea = opciones.colorLineaPorId?.[p.lineaId];
  return {
    ...(foto ? { fotoUrl: foto } : {}),
    ...(colorLinea ? { colorLinea } : {}),
    ...(alerta ? { alerta } : {}),
    // "M2" = 2.º en la cola de Molinos (espera real); "M" = vuelta designada, todavía sin llegar.
    // El orden viene del resumen de 15 s: solo vale si la posición fresca (2 s) confirma que espera.
    ...(ordenMolinos && p.vuelta?.enEspera ? { molinos: ordenMolinos } : p.vuelta?.varianteId ? { molinos: true } : {}),
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
  const conPosicion = posiciones.filter(
    (p): p is PosicionEnVivo & { lat: number; lng: number } => p.lat !== null && p.lng !== null,
  );
  const dibujadas = posicionesAbanico(conPosicion);
  return conPosicion.map((p, i) => {
      const presentacion = presentacionFrescura(p.estadoFrescura);
      return {
        id: idMarcadorVehiculo(p.id),
        lat: dibujadas[i]!.lat,
        lng: dibujadas[i]!.lng,
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
        ...camposAlertaYFoto(p, opciones, opciones.ordenMolinos?.get(p.id)),
        onClick: () => onSeleccionar(p.id),
      };
  });
}

const RADIO_APILADO_M = 10;
const RADIO_ABANICO_M = 7;
const M_POR_GRADO = 111_320;

/**
 * Solo para dibujar: vehículos a <= 10 m del ancla del grupo (típico en la terminal) se abren en
 * abanico de 7 m ALREDEDOR DEL ANCLA, así el de arriba no se come los clics de los demás. El ancla
 * (el primero por id) queda en su posición real. Agrupa de forma voraz sobre los ids ordenados:
 * mismo resultado sin importar el orden de entrada ni la selección. El seguimiento y la animación
 * del seleccionado usan su posición real (`page.tsx`), no la del marcador.
 */
function posicionesAbanico(
  ps: Array<{ id: string; lat: number; lng: number }>,
): Array<{ lat: number; lng: number }> {
  const out = ps.map((p) => ({ lat: p.lat, lng: p.lng }));
  const orden = ps.map((_, i) => i).sort((i, j) => (ps[i]!.id < ps[j]!.id ? -1 : ps[i]!.id > ps[j]!.id ? 1 : 0));
  const grupos: number[][] = [];
  for (const i of orden) {
    const p = ps[i]!;
    const g = grupos.find((idx) => {
      const c = ps[idx[0]!]!;
      const dy = (p.lat - c.lat) * M_POR_GRADO;
      const dx = (p.lng - c.lng) * M_POR_GRADO * Math.cos((c.lat * Math.PI) / 180);
      return Math.hypot(dx, dy) <= RADIO_APILADO_M;
    });
    if (g) g.push(i);
    else grupos.push([i]);
  }
  for (const idxs of grupos) {
    const ancla = ps[idxs[0]!]!;
    const otros = idxs.length - 1;
    idxs.forEach((i, k) => {
      if (k === 0) return;
      const ang = (2 * Math.PI * (k - 1)) / otros;
      out[i] = {
        lat: ancla.lat + (RADIO_ABANICO_M * Math.cos(ang)) / M_POR_GRADO,
        lng: ancla.lng + (RADIO_ABANICO_M * Math.sin(ang)) / (M_POR_GRADO * Math.cos((ancla.lat * Math.PI) / 180)),
      };
    });
  }
  return out;
}

export function construirZonas(contexto: Pick<ContextoEnVivo, 'puntosControl'>): MapZone[] {
  return [...contexto.puntosControl].sort((a, b) => a.orden - b.orden).map((pc, index) => ({
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

/** Ruta de una línea con sus puntos de control, tal como los devuelven `/lineas/:id/rutas` y `/rutas/:id/puntos-control`. */
export interface RutaDeLinea {
  ruta: Ruta;
  puntos: PuntoControl[];
}

/**
 * Mapa de una línea elegida en el filtro sin vehículo con detalle abierto: sus rutas (ya activas), los
 * puntos de control activos (misma numeración que `construirPuntosControl`, sin variante) y zonas.
 * shortcut: sin variantes (Molinos) ni cumplimiento; el trazado de la variante solo sale con un vehículo seleccionado.
 */
export function construirMapaDeLinea(
  color: string,
  rutas: readonly RutaDeLinea[],
): { routes: MapRoute[]; markers: MapPoint[]; zones: MapZone[] } {
  const routes: MapRoute[] = [];
  const markers: MapPoint[] = [];
  const zones: MapZone[] = [];
  for (const { ruta, puntos } of rutas) {
    const sentido = capitalizar(ruta.sentido);
    routes.push({
      id: `ruta-linea-${ruta.id}`,
      label: `Ruta ${sentido}`,
      color,
      dashed: true,
      points: ruta.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
    });
    const contexto = {
      puntosControl: puntos
        .filter((pc) => pc.estado === 'activo')
        .map((pc) => ({ ...pc, rol: pc.rol ?? null })),
      puntoEsperaPorVariante: {},
    };
    markers.push(
      ...construirPuntosControl(contexto, undefined).map((m) => ({
        ...m,
        // Con varias rutas los "Punto de control N" se repiten: el sentido los distingue.
        label: rutas.length > 1 ? `${sentido} · ${m.label}` : m.label,
        description: `Ruta ${sentido}`,
      })),
    );
    zones.push(...construirZonas(contexto));
  }
  return { routes, markers, zones };
}

export function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

/** Sin vehículos pero con línea filtrada y su ruta (o cargándola): el vacío va como tarjeta sobre el mapa, no a pantalla completa. */
export function vacioSobreMapa(lineaFilter: string, hayMapaLinea: boolean, cargando: boolean): boolean {
  return Boolean(lineaFilter) && (hayMapaLinea || cargando);
}
