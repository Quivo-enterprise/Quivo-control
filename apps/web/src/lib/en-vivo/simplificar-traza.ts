/**
 * Simplificación (Douglas-Peucker) de la polilínea `traza-gps` de `/en-vivo`.
 *
 * **Por qué hace falta.** `construirRutas` (`map-builders.ts`) reconstruye la ruta
 * `traza-gps` a partir de `traza.puntos` ENTERO en cada poll (no solo el delta nuevo), y
 * `route-map-impl.tsx` la vuelca a la fuente `quivo-routes` con `GeoJSONSource.setData()`
 * cada vez que cambia — cada 10 s en régimen normal, cada 1 s mientras el server avisa
 * `hayMas`. Eso es O(puntos totales) de serialización + `postMessage` al worker de MapLibre
 * + re-tesela de la línea, EN CADA POLL, sin importar cuántos puntos nuevos llegaron. Con el
 * límite viejo (`TRAZA_EN_VIVO_LIMITE_MAX` = 5 000) el costo por poll era acotado; con
 * `distanceFilter` de 15 m sin elasticidad una jornada completa puede rondar 30 000-43 000
 * puntos (ver `entities/en-vivo.ts`), y repetir ese trabajo sobre el array completo cada 1-10 s
 * durante horas es el riesgo real de degradación — no la capacidad de MapLibre de RENDERIZAR
 * una línea de 40 000 vértices (eso lo soporta sin problema: los tiles del mapa base ya traen
 * órdenes de magnitud más geometría en pantalla al mismo tiempo).
 *
 * La solución NO es limitar cuántos puntos se piden o se guardan (esos siguen completos, para
 * el histórico y el auto-heal) — es dibujar una versión simplificada de la polilínea. Douglas-
 * Peucker es la elección estándar para esto: conserva la forma real del recorrido (curvas,
 * esquinas) y descarta los puntos que caen casi exactos sobre la recta entre dos vecinos más
 * separados — exactamente el caso común acá, porque a 15 m de `distanceFilter` en una avenida
 * recta hay muchos fixes casi colineales.
 *
 * `EPSILON_SIMPLIFICACION_METROS` (3 m) es chico a propósito: a la escala de zoom en la que
 * se usa este mapa (ciudad/barrio, nunca acercado a nivel de vereda) una desviación de 3 m es
 * imperceptible, así que la forma dibujada no se distingue de la traza cruda — la ganancia es
 * en cantidad de vértices, no en fidelidad visual perdida.
 *
 * Se aplica solo por encima de `UMBRAL_PUNTOS_SIMPLIFICACION`: para una sesión corta o media
 * (la gran mayoría) el array ya es chico y correr el algoritmo no ahorra nada que valga la
 * pena — simplificar tiene su propio costo (barrido de todo el array), así que no tiene
 * sentido pagarlo cuando el problema que resuelve todavía no existe.
 */

export interface PuntoSimplificable {
  lat: number;
  lng: number;
}

/** Metros por grado de latitud — mismo valor que usa `zonePolygon` en `route-map-impl.tsx`
 * para el mismo tipo de conversión planar aproximada (válido a escala de ciudad). */
const METROS_POR_GRADO_LAT = 111_320;

/**
 * Distancia perpendicular de `p` a la RECTA (no al segmento — es la definición clásica de
 * Douglas-Peucker) que pasa por `a` y `b`, en metros. Proyección equirectangular centrada en
 * `a`: suficiente a la escala de una ciudad, mismo criterio de aproximación que el resto del
 * código de mapas de este repo (ninguna ruta de QUIVO cruza zonas donde la curvatura de la
 * Tierra importe a esta escala).
 */
function distanciaPerpendicularMetros(p: PuntoSimplificable, a: PuntoSimplificable, b: PuntoSimplificable): number {
  const metrosPorGradoLng = METROS_POR_GRADO_LAT * Math.max(Math.cos((a.lat * Math.PI) / 180), 0.2);
  const bx = (b.lng - a.lng) * metrosPorGradoLng;
  const by = (b.lat - a.lat) * METROS_POR_GRADO_LAT;
  const px = (p.lng - a.lng) * metrosPorGradoLng;
  const py = (p.lat - a.lat) * METROS_POR_GRADO_LAT;
  const largoAB = Math.hypot(bx, by);
  if (largoAB === 0) return Math.hypot(px, py);
  return Math.abs(px * by - py * bx) / largoAB;
}

/**
 * Douglas-Peucker iterativo (pila explícita, no recursión): con hasta ~50 000 puntos
 * (`TRAZA_EN_VIVO_LIMITE_MAX`) una implementación recursiva podría, en el peor caso
 * patológico (una traza con ruido GPS donde casi todos los puntos superan el epsilon),
 * acumular profundidad de recursión proporcional al tamaño del array — la versión iterativa
 * no tiene ese riesgo, sin importar la forma de la entrada.
 *
 * Devuelve los ÍNDICES a conservar (ascendente, siempre incluye el primero y el último) en
 * vez de una copia de los puntos, para que el llamador decida cómo mapearlos de vuelta.
 */
export function indicesDouglasPeucker(puntos: PuntoSimplificable[], epsilonMetros: number): number[] {
  const n = puntos.length;
  if (n <= 2) return puntos.map((_, i) => i);

  const mantener = new Uint8Array(n);
  mantener[0] = 1;
  mantener[n - 1] = 1;
  const pila: Array<[number, number]> = [[0, n - 1]];

  while (pila.length > 0) {
    const [inicio, fin] = pila.pop()!;
    if (fin - inicio < 2) continue;
    let distanciaMax = -1;
    let indiceMax = -1;
    for (let i = inicio + 1; i < fin; i += 1) {
      const d = distanciaPerpendicularMetros(puntos[i]!, puntos[inicio]!, puntos[fin]!);
      if (d > distanciaMax) {
        distanciaMax = d;
        indiceMax = i;
      }
    }
    if (distanciaMax > epsilonMetros) {
      mantener[indiceMax] = 1;
      pila.push([inicio, indiceMax], [indiceMax, fin]);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) if (mantener[i]) indices.push(i);
  return indices;
}

/** Ver el comentario de cabecera del archivo. */
export const UMBRAL_PUNTOS_SIMPLIFICACION = 1_500;
/** Ver el comentario de cabecera del archivo. */
export const EPSILON_SIMPLIFICACION_METROS = 3;

/**
 * Simplifica `puntos` para DIBUJAR la polilínea `traza-gps` — nunca se usa para lo que
 * consume los puntos crudos (auto-heal, cumplimientos, exportes): es puramente de
 * presentación. Por debajo de `UMBRAL_PUNTOS_SIMPLIFICACION` devuelve `puntos` tal cual
 * (misma referencia).
 */
export function simplificarTrazaParaDibujo<T extends PuntoSimplificable>(puntos: T[]): T[] {
  if (puntos.length <= UMBRAL_PUNTOS_SIMPLIFICACION) return puntos;
  const indices = indicesDouglasPeucker(puntos, EPSILON_SIMPLIFICACION_METROS);
  return indices.map((i) => puntos[i]!);
}
