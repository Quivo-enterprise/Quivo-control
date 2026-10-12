// Máquina de estados PURA de la animación del marcador de vehículo en `/en-vivo`
// (`route-map-impl.tsx`). Vive en su propio módulo, sin imports de MapLibre/React, por el
// mismo motivo que `route-map-geometry.ts`: así se testea con Vitest en el entorno `node`
// por default de este repo, sin tener que montar un mapa ni mockear `requestAnimationFrame`.
//
// **Por qué animar así (y no con un `maplibregl.Marker` de DOM):** el marcador del vehículo
// es una feature más de la fuente GeoJSON `quivo-markers`, dibujada por una capa `circle`
// (WebGL) junto al halo `quivo-marker-pulse` que ya filtra por `pinType: 'vehicle'` (con
// `estadoFrescura: 'reportando'`, ver `MARKER_PULSE_FILTER`) sobre esa misma fuente. Mover la
// posición vía `GeoJSONSource.setData()` en cada frame mantiene el
// halo "gratis" (recalcula con el resto de la fuente, sin un segundo mecanismo de
// animación) y evita el costo de un `Marker` DOM: ese es un `<div>` posicionado con
// transform CSS que MapLibre reproyecta a mano en cada evento `move`, lo que implica layout/
// paint de DOM en cada frame en vez de quedar todo en el mismo canvas WebGL que ya dibuja el
// resto del mapa (rutas, paradas, zonas). El costo de `setData()` a 60 fps es bajo en este
// caso concreto porque la fuente `quivo-markers` es CHICA (paradas/puntos de control de una
// ruta — típicamente decenas, nunca miles): reconstruir su FeatureCollection y reenviarla al
// worker de MapLibre en cada frame es un `Array.map` sobre esa lista corta, no sobre la
// traza GPS completa (esa vive en la fuente `quivo-routes`, separada, y NO se toca acá).
//
// **Duración de la animación:** no hay un valor fijo arbitrario. Los puntos GPS llegan en
// lotes irregulares (el poll de traza de `/en-vivo` es cada `INTERVALO_POLL_MS` = 10 s, el de posiciones cada 2 s, o
// `INTERVALO_POLL_RAPIDO_MS` = 1 s mientras el server avisa `hayMas`), así que el criterio es
// repartir el intervalo de poll VIGENTE entre los puntos nuevos de ESE lote
// (`intervalMs / puntos.length`, ver `encolarNuevosPuntos`): el marcador termina de recorrer
// el lote más o menos cuando se espera que llegue el próximo, en vez de terminar de golpe y
// quedarse quieto varios segundos, o de seguir deslizándose todavía cuando ya hay un punto
// más nuevo esperando. Es una aproximación (no sabemos el instante exacto del próximo poll),
// pero es la mejor señal disponible y evita el error mayor de usar el `ts` de captura GPS
// entre dos puntos: ese delta puede ser de segundos O de más de una hora (ver
// `SOLAPE_CURSOR_MS`/huecos por Doze en `traza.ts`), y animar a esa escala se vería
// carísimo o directamente pausado la mayor parte del tiempo.
//
// **Nota (PR 2 de `docs/plan-en-vivo-google.md`):** el llamador de `/en-vivo` pasa el intervalo
// real del poll de `/posiciones` (2 s) y agrega a la traza el último fix de ese poll, así que
// los lotes nuevos llegan cada ~2 s y la animación los reparte en ese mismo lapso. Esta
// función es agnóstica: reparte lo que reciba.

/** Punto de la traza con lo mínimo que necesita la animación. `PuntoTrazaGps` de
 * `@quivo/shared` (con `accuracy`/`speed` de más) es asignable acá sin problema — es
 * estructural, y este módulo no depende de `@quivo/shared` a propósito (mismo criterio que
 * el resto de `route-map-impl.tsx`: el paquete de diseño no conoce tipos de dominio). */
export interface PuntoAnimable {
  lat: number;
  lng: number;
  /** ISO-8601. Se compara como string (orden lexicográfico = orden cronológico en ISO-8601
   * con el mismo formato/zona), nunca se parsea a `Date` — no hace falta para solo comparar
   * "más nuevo que" contra el cursor ya consumido. */
  ts: string;
}

interface SegmentoEnCola {
  lat: number;
  lng: number;
  durationMs: number;
}

interface SegmentoActivo {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  durationMs: number;
  /** Timestamp de `requestAnimationFrame` (no `Date.now()`) en el que arrancó este segmento —
   * ver `avanzarAnimacion`. */
  startTs: number;
}

export interface EstadoAnimacionVehiculo {
  /** `ts` del último punto ya incorporado (encolado o saltado) — el cursor del diff de
   * `encolarNuevosPuntos`. `null` significa "todavía no se vio ningún punto de este
   * vehículo": la próxima llamada salta directo, sin animar (ver `encolarNuevosPuntos`). */
  lastConsumedTs: string | null;
  /** Posición VISUAL actual del marcador — lo que hay que dibujar. `null` solo antes del
   * primer punto. */
  current: { lat: number; lng: number } | null;
  /** Waypoints pendientes de visitar, en orden cronológico. */
  queue: SegmentoEnCola[];
  /** Segmento que se está interpolando ahora mismo, o `null` si no hay ninguno en curso
   * (recién arrancó uno de `queue`, o la cola está vacía y no hay nada que animar). */
  segment: SegmentoActivo | null;
}

export function estadoInicialAnimacion(): EstadoAnimacionVehiculo {
  return { lastConsumedTs: null, current: null, queue: [], segment: null };
}

/**
 * Tope de puntos nuevos que vale la pena animar en un solo lote.
 *
 * Con `distanceFilter` de 15 m sin elasticidad, un vehículo en movimiento genera un fix cada
 * pocos segundos; 40 puntos nuevos de una sola vez ya representan varios minutos de recorrido
 * de backlog (ej. el teléfono volviendo de un hueco largo de Doze, o el auto-heal de
 * `debeRecargar` fusionando una ráfaga atrasada). Recorrerlos uno por uno en ese caso no
 * comunica nada útil — el usuario quiere ver DÓNDE ESTÁ el vehículo ahora, no un replay del
 * historial — y encima cada segmento de una cola tan larga terminaría durando menos que
 * `DURACION_MINIMA_SEGMENTO_MS`, o sea invisible igual. Por encima del tope: salto directo al
 * último punto del lote, igual que si no hubiera animación.
 */
export const MAX_PUNTOS_ANIMADOS = 40;

/**
 * Piso de duración por segmento. Por debajo de esto (unos pocos frames a 60 fps) el ojo no
 * distingue una transición de un salto, así que no tiene sentido bajar más: mejor un segmento
 * un poco más largo que uno tan corto que ya no se percibe como animación.
 */
export const DURACION_MINIMA_SEGMENTO_MS = 120;

/**
 * Incorpora los puntos nuevos de un lote (delta de poll) al estado de animación.
 *
 * `puntos` es el historial COMPLETO y ordenado ascendente por `ts` (ej. `traza.puntos`, tal
 * cual lo deja `fusionarTraza` en `traza.ts`) — no solo los nuevos: esta función encuentra
 * por sí sola, comparando contra `estado.lastConsumedTs`, cuál es el sufijo que todavía no
 * se incorporó. Así el llamador no tiene que llevar la cuenta de qué ya se consumió; alcanza
 * con pasar el array completo tal como lo entrega la cache de TanStack Query en cada poll.
 *
 * Casos:
 * - **Primera vez** (`estado.lastConsumedTs === null`): salto directo al último punto, sin
 *   animar. No hay "posición anterior" real desde la cual deslizar (el marcador recién
 *   aparece), así que animar acá sería un slide arbitrario desde el centro del mapa.
 * - **Lote grande** (más de `MAX_PUNTOS_ANIMADOS` nuevos) o **`prefers-reduced-motion`**:
 *   salto directo al último punto del lote — ver el comentario de `MAX_PUNTOS_ANIMADOS`.
 * - **Caso normal**: los puntos nuevos se agregan al FINAL de `estado.queue`, cada uno con
 *   `durationMs = intervalMs / cantidadDeNuevos` (piso `DURACION_MINIMA_SEGMENTO_MS`). Si ya
 *   había una animación en curso (`estado.segment` no `null`) o una cola pendiente, **no se
 *   tocan**: los nuevos waypoints se agregan detrás, así que la animación sigue desde donde
 *   esté el marcador en ese instante — nunca rebobina al punto viejo (ver
 *   `avanzarAnimacion` para cómo se preserva `current`/`segment` mientras no termina).
 * - **Sin puntos nuevos** (el lote no trajo nada por encima de `lastConsumedTs` — ej. una
 *   ráfaga de backfill enteramente más vieja que lo ya dibujado): `estado` se devuelve sin
 *   cambios (misma referencia), no hay nada que hacer.
 */
export function encolarNuevosPuntos(
  estado: EstadoAnimacionVehiculo,
  puntos: PuntoAnimable[],
  intervalMs: number,
  opts: { reducirMovimiento: boolean } = { reducirMovimiento: false },
): EstadoAnimacionVehiculo {
  if (puntos.length === 0) return estado;
  const ultimo = puntos[puntos.length - 1]!;

  if (estado.lastConsumedTs === null) {
    return { lastConsumedTs: ultimo.ts, current: { lat: ultimo.lat, lng: ultimo.lng }, queue: [], segment: null };
  }

  // `puntos` viene ordenado ascendente por `ts` — el sufijo nuevo se recorta desde el final.
  let corte = puntos.length;
  while (corte > 0 && puntos[corte - 1]!.ts > estado.lastConsumedTs) corte -= 1;
  const nuevos = puntos.slice(corte);
  if (nuevos.length === 0) return estado;

  if (nuevos.length > MAX_PUNTOS_ANIMADOS || opts.reducirMovimiento) {
    return { lastConsumedTs: ultimo.ts, current: { lat: ultimo.lat, lng: ultimo.lng }, queue: [], segment: null };
  }

  const duracionSegmento = Math.max(intervalMs / nuevos.length, DURACION_MINIMA_SEGMENTO_MS);
  return {
    lastConsumedTs: ultimo.ts,
    current: estado.current,
    queue: [...estado.queue, ...nuevos.map((p) => ({ lat: p.lat, lng: p.lng, durationMs: duracionSegmento }))],
    segment: estado.segment,
  };
}

export interface ResultadoAvance {
  estado: EstadoAnimacionVehiculo;
  /** Posición a dibujar en este frame — `null` solo si todavía no hay ningún punto. */
  posicion: { lat: number; lng: number } | null;
  /** `true` si hace falta pedir otro frame (`requestAnimationFrame`) para seguir animando.
   * `false` cuando no queda nada pendiente — el llamador debe DEJAR de pedir frames acá
   * (ver el comentario de cabecera sobre no consumir CPU con la sesión inactiva). */
  enMovimiento: boolean;
}

/**
 * Avanza un frame de animación. Pura respecto del reloj: `timestampMs` es el timestamp que
 * ya trae el callback de `requestAnimationFrame` — nunca se llama `Date.now()`/`performance.now()`
 * acá adentro, así que esto se testea sin mockear temporizadores.
 *
 * Si no hay segmento activo, toma el próximo de `queue` y lo arranca EN ESTE MISMO frame
 * (`startTs = timestampMs`, progreso 0 % ya calculado más abajo) — no hace falta un frame
 * "vacío" solo para inicializar.
 */
export function avanzarAnimacion(estado: EstadoAnimacionVehiculo, timestampMs: number): ResultadoAvance {
  if (estado.current === null) {
    return { estado, posicion: null, enMovimiento: false };
  }

  let segment = estado.segment;
  let queue = estado.queue;

  if (!segment) {
    const [siguiente, ...resto] = queue;
    if (!siguiente) {
      return { estado, posicion: estado.current, enMovimiento: false };
    }
    segment = { from: estado.current, to: { lat: siguiente.lat, lng: siguiente.lng }, durationMs: siguiente.durationMs, startTs: timestampMs };
    queue = resto;
  }

  const elapsed = timestampMs - segment.startTs;
  const t = segment.durationMs <= 0 ? 1 : Math.min(1, elapsed / segment.durationMs);
  const terminoSegmento = t >= 1;
  const current = terminoSegmento
    ? segment.to
    : {
        lat: segment.from.lat + (segment.to.lat - segment.from.lat) * t,
        lng: segment.from.lng + (segment.to.lng - segment.from.lng) * t,
      };

  const nuevoEstado: EstadoAnimacionVehiculo = {
    ...estado,
    current,
    queue,
    segment: terminoSegmento ? null : segment,
  };
  return { estado: nuevoEstado, posicion: current, enMovimiento: !terminoSegmento || queue.length > 0 };
}
