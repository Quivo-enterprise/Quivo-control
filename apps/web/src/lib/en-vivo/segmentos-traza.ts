import type { MapRoute } from '@quivo/design-system';
import {
  ajustarPuntosARutas,
  debeInterpolarPorRuta,
  distanciaMetros,
  interpolarSobreRuta,
  prepararRutaSnap,
  trazaParaDibujo,
  type PuntoTrazaGps,
  type RutaSnap,
  type VarianteTramo,
} from '@quivo/shared';
import type { PuntoConTs } from './punto-vivo';
import { simplificarTrazaParaDibujo } from './simplificar-traza';

/** Color fijo de la traza GPS real pegada a la ruta (igual en `/en-vivo` y en el histórico). */
export const COLOR_TRAZA = '#2563eb';
/** Tramos donde el vehículo se salió de la ruta: color de alerta del design system. */
export const COLOR_TRAZA_LIBRE = 'var(--qv-color-warning)';

type Coordenadas = readonly (readonly number[])[];

/** Rutas contra las que se ajusta la traza: la base primero, luego cada tramo de variante. Quien
 * la llama la memoiza (`useMemo` sobre el contexto). `variantes` puede faltar: `apiFetch` no
 * valida con zod, y un web desplegado antes que la API (o una respuesta cacheada) no la trae. */
export function rutasSnapDe(base: Coordenadas, variantes: readonly VarianteTramo[] | undefined): RutaSnap[] {
  return [base, ...(variantes ?? []).map((v) => v.geometria.coordinates)]
    .map((cs) => prepararRutaSnap(cs.map(([lng, lat]) => ({ lat: lat!, lng: lng! }))))
    .filter((r): r is RutaSnap => r !== null);
}

/** Una `MapRoute` por segmento de `trazaParaDibujo`: 'ruta' en azul sólido, 'libre' (GPS crudo,
 * fuera de la ruta) en color de alerta y más fino. Sin offset lateral: la traza va en el eje.
 * Douglas-Peucker (3 m, sobre el umbral de puntos) a todos los segmentos. */
export function rutasDeTraza(
  puntos: readonly PuntoTrazaGps[],
  rutasSnap: readonly RutaSnap[],
  label: string,
): MapRoute[] {
  return trazaParaDibujo(puntos, rutasSnap).map((s, i) => ({
    id: `traza-gps-${i}`,
    label: i === 0 ? label : undefined,
    color: s.tipo === 'ruta' ? COLOR_TRAZA : COLOR_TRAZA_LIBRE,
    fino: s.tipo === 'libre',
    sinOffset: true,
    points: simplificarTrazaParaDibujo(s.coords),
  }));
}

/** Cuántos puntos del final se ajustan para animar el marcador: la animación solo recorre los
 * nuevos (≤ `MAX_PUNTOS_ANIMADOS`) y ajustar toda la jornada en cada poll sería trabajo tirado. */
const COLA_SNAP_MARCADOR = 80;

type PuntoMarcador = PuntoConTs & Partial<Pick<PuntoTrazaGps, 'accuracy' | 'speed'>>;

/** Puntos para animar el marcador del vehículo seleccionado: cada fix ajustado a la ruta y, entre
 * dos ajustados a la misma ruta donde `debeInterpolarPorRuta` lo permite, un `camino` que sigue
 * la calle (como el móvil). Los que no ajustan quedan crudos con la animación recta de siempre. */
export function puntosAnimadosSobreRuta(
  puntos: readonly PuntoMarcador[],
  rutas: readonly RutaSnap[],
): (PuntoConTs & { camino?: (t: number) => { lat: number; lng: number } })[] {
  if (rutas.length === 0) return [...puntos];
  const cola = puntos.slice(-COLA_SNAP_MARCADOR);
  const ajustados = ajustarPuntosARutas(
    cola.map((p) => ({ ...p, accuracy: p.accuracy ?? null, speed: p.speed ?? null })),
    rutas,
  );
  const antes = puntos.length - cola.length;
  return [
    ...puntos.slice(0, antes),
    ...cola.map((p, i) => {
      const a = ajustados[i]!;
      const ant = i > 0 ? ajustados[i - 1]! : null;
      const base = { ts: p.ts, lat: a.pos.lat, lng: a.pos.lng };
      if (!a.snap || !ant?.snap || a.hueco || ant.rutaIdx !== a.rutaIdx) return base;
      const ruta = rutas[a.rutaIdx]!;
      const d0 = ant.snap.distanciaRecorrida;
      const d1 = a.snap.distanciaRecorrida;
      if (!debeInterpolarPorRuta(ruta, d0, d1, distanciaMetros(ant.pos, a.pos))) return base;
      return { ...base, camino: (t: number) => interpolarSobreRuta(ruta, d0, d1, t) };
    }),
  ];
}
