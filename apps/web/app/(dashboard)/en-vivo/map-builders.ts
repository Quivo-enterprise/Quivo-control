import type { MapPoint, MapRoute, MapZone } from '@quivo/design-system';
import type { ContextoEnVivo, CumplimientoRecorrido, SesionEnVivoResumen } from '@quivo/shared';
import { ApiError } from '../../../src/lib/api/client';
import { PRESENTACION_FRESCURA, type TrazaAcumulada } from '../../../src/lib/en-vivo/traza';

/** Color fijo de la traza GPS real, igual que en el detalle histórico
 * (`/reportes/recorridos/[id]`) para que las dos pantallas se lean igual. */
export const COLOR_TRAZA = '#2563eb';

export function opcionDeSesion(sesion: SesionEnVivoResumen) {
  const dispositivo = sesion.deviceId.slice(0, 8);
  const estado = PRESENTACION_FRESCURA[sesion.estadoFrescura].etiqueta;
  return {
    value: sesion.id,
    label: `${sesion.vehiculoPlaca} · ${sesion.lineaNombre} · ${sesion.conductorNombre} · ${dispositivo} — ${estado}`,
  };
}

export function construirRutas(
  contexto: ContextoEnVivo,
  traza: TrazaAcumulada | undefined,
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
  if (traza && traza.puntos.length > 1) {
    rutas.push({
      id: 'traza-gps',
      label: 'Recorrido real',
      color: COLOR_TRAZA,
      points: traza.puntos.map((p) => ({ lat: p.lat, lng: p.lng })),
    });
  }
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

export function construirMarcadores(
  contexto: ContextoEnVivo,
  traza: TrazaAcumulada | undefined,
  colorVehiculo: string,
): MapPoint[] {
  const marcadores: MapPoint[] = contexto.puntosControl.map((pc, index) => {
    const cumplimiento = ultimaPasada(traza, pc.id);
    const cumplido = cumplimiento?.cumplido ?? false;
    return {
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      label: `Punto de control ${index + 1}`,
      description: cumplimiento
        ? `${cumplido ? 'Cumplido' : 'No cumplido'} — ${cumplimiento.distanciaM.toFixed(0)} m`
        : 'Todavía sin pasada validada',
      // `MapPoint.color` termina en `buildDivIcon` (`route-map-impl.tsx`), que lo escribe
      // como custom property CSS en un `style` inline (`--qv-map-pin-color:${color}`) — a
      // diferencia de `pathOptions.color` de Leaflet (ver `construirZonas`), acá `var()` SÍ
      // se resuelve.
      color: cumplido ? 'var(--qv-color-success)' : 'var(--qv-text-muted)',
      pinType: 'stop',
    };
  });

  const ultimo = traza?.puntos.at(-1);
  if (ultimo) {
    marcadores.push({
      lat: ultimo.lat,
      lng: ultimo.lng,
      label: `${contexto.vehiculo.placa} — última posición`,
      description: new Date(ultimo.ts).toLocaleTimeString('es-BO'),
      color: colorVehiculo,
      pinType: 'pulse',
    });
  }
  return marcadores;
}

export function construirZonas(contexto: ContextoEnVivo): MapZone[] {
  return contexto.puntosControl.map((pc, index) => ({
    lat: pc.coord.coordinates[1],
    lng: pc.coord.coordinates[0],
    radiusMeters: pc.radioToleranciaM,
    label: `Tolerancia PC ${index + 1}`,
    // Hex literal a propósito, NO `var(--qv-text-muted)`: este color va a `pathOptions.color`/
    // `fillColor` de un `Circle` de Leaflet (`route-map-impl.tsx`), que termina en los
    // atributos de presentación SVG `stroke`/`fill` — ahí `var()` nunca se resuelve (a
    // diferencia de `construirMarcadores`, donde el color va a un `style` inline vía
    // `buildDivIcon`). Mismo valor que el token `--qv-text-muted` claro; no reacciona a
    // `prefers-color-scheme` en oscuro.
    color: '#94a3b8',
  }));
}

export function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
