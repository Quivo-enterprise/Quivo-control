/**
 * Interpolación sobre una polilínea `[lat, lng][]`, usada para mover los trufis mock a lo
 * largo de la ruta de su línea (tick de 1 s en `flota-mock-context.tsx`).
 *
 * Es interpolación LINEAL por distancia acumulada (no geodésica exacta, no sigue calles):
 * para el radio de una demo de mapa (zoom ciudad/barrio) el error es imperceptible y evita
 * traer una librería de geometría nueva (regla del contrato: "no new dependencies").
 */

/** Radio medio terrestre en metros — mismo valor que usa el resto del repo para haversine. */
const RADIO_TIERRA_M = 6_371_000;

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

/** Distancia haversine en metros entre dos puntos `[lat, lng]`. */
function distanciaMetros(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = aRadianes(lat2 - lat1);
  const dLng = aRadianes(lng2 - lng1);
  const rLat1 = aRadianes(lat1);
  const rLat2 = aRadianes(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cache de largos de segmento por polilínea (clave: la referencia del array), para no
 * recalcular N distancias haversine en CADA tick (1/s) de CADA trufi — la polilínea de una
 * línea es la misma referencia de array durante toda la vida de la demo (`LINEAS_MOCK` no se
 * reconstruye), así que se calcula una sola vez y se reusa. `WeakMap` para no retener la
 * polilínea si alguna vez dejara de estar referenciada desde otro lado.
 */
const cacheSegmentos = new WeakMap<
  [number, number][],
  { segmentos: number[]; largoTotal: number }
>();

function segmentosDe(polilinea: [number, number][]): { segmentos: number[]; largoTotal: number } {
  const cacheado = cacheSegmentos.get(polilinea);
  if (cacheado) {
    return cacheado;
  }
  const segmentos: number[] = [];
  let largoTotal = 0;
  for (let i = 0; i < polilinea.length - 1; i++) {
    const largo = distanciaMetros(polilinea[i]!, polilinea[i + 1]!);
    segmentos.push(largo);
    largoTotal += largo;
  }
  const resultado = { segmentos, largoTotal };
  cacheSegmentos.set(polilinea, resultado);
  return resultado;
}

/**
 * Posición sobre la polilínea para un `avance` en `[0, 1)` (hace loop: `avance` fuera de
 * rango se normaliza con módulo 1 antes de interpolar).
 *
 * Recorre la polilínea acumulando distancia real (haversine) hasta ubicar el segmento que
 * contiene el punto pedido, y hace `lerp` lineal lat/lng dentro de ese segmento — suficiente
 * para el propósito visual de la demo (ver cabecera del archivo). Los largos de segmento se
 * calculan una sola vez por polilínea (`segmentosDe`, cacheados en un `WeakMap`), no en cada
 * llamada.
 */
export function posicionEnPolilinea(
  polilinea: [number, number][],
  avance: number,
): { lat: number; lng: number } {
  if (polilinea.length === 0) {
    return { lat: 0, lng: 0 };
  }
  if (polilinea.length === 1) {
    const [lat, lng] = polilinea[0]!;
    return { lat, lng };
  }

  // Normaliza a [0, 1) incluso si `avance` viene negativo o >= 1 (el tick suma un paso chico
  // cada segundo y podría pasarse de largo del final).
  const t = ((avance % 1) + 1) % 1;

  const { segmentos, largoTotal } = segmentosDe(polilinea);

  if (largoTotal === 0) {
    const [lat, lng] = polilinea[0]!;
    return { lat, lng };
  }

  const distanciaObjetivo = t * largoTotal;
  let acumulado = 0;
  for (let i = 0; i < segmentos.length; i++) {
    const largoSegmento = segmentos[i]!;
    if (acumulado + largoSegmento >= distanciaObjetivo || i === segmentos.length - 1) {
      const fraccionSegmento = largoSegmento === 0 ? 0 : (distanciaObjetivo - acumulado) / largoSegmento;
      const [lat1, lng1] = polilinea[i]!;
      const [lat2, lng2] = polilinea[i + 1]!;
      const clamp = Math.min(1, Math.max(0, fraccionSegmento));
      return {
        lat: lat1 + (lat2 - lat1) * clamp,
        lng: lng1 + (lng2 - lng1) * clamp,
      };
    }
    acumulado += largoSegmento;
  }

  // Inalcanzable en la práctica (el loop siempre retorna dentro del for), pero TypeScript
  // no lo sabe con `noUncheckedIndexedAccess` — fallback al último punto.
  const [lat, lng] = polilinea[polilinea.length - 1]!;
  return { lat, lng };
}

/**
 * Detecta el vértice de RETORNO de una polilínea de ida y vuelta (recorre las mismas calles
 * de ida y de vuelta para cerrar el loop, como `L120_POLILINEA` en `datos.ts` — ver su
 * comentario de cabecera) — el índice donde el recorrido empieza a retrazar, en sentido
 * opuesto, el camino que ya hizo.
 *
 * Se DERIVA de la propia polilínea, no se hardcodea: el punto más lejano en línea recta
 * desde el inicio es el candidato — para cualquier ida-y-vuelta simple (sin
 * auto-intersecciones) es cierto que la distancia al inicio crece en la ida y solo puede
 * achicarse retrazando el mismo camino en la vuelta, así que el máximo cae justo en el punto
 * de retorno. Se CONFIRMA verificando que el tramo posterior sea el espejo (dentro de
 * `toleranciaM`) del tramo anterior — si la polilínea no es de ida y vuelta (p. ej.
 * `Z12_POLILINEA`, un circuito por calles distintas en cada sentido), el espejo no se
 * cumple y devuelve `null`; el llamador debe usar la polilínea completa en ese caso.
 */
export function indiceDeRetornoDe(
  polilinea: [number, number][],
  toleranciaM = 5,
): number | null {
  if (polilinea.length < 3) {
    return null;
  }

  const inicio = polilinea[0]!;
  let distanciaMax = -1;
  let indiceMax = -1;
  for (let i = 0; i < polilinea.length; i++) {
    const d = distanciaMetros(inicio, polilinea[i]!);
    if (d > distanciaMax) {
      distanciaMax = d;
      indiceMax = i;
    }
  }

  // Sin margen de espejo hacia alguno de los dos lados (el punto más lejano es el primero o
  // el último vértice) no hay vuelta que verificar — no es ida y vuelta.
  const alcance = Math.min(indiceMax, polilinea.length - 1 - indiceMax);
  if (alcance === 0) {
    return null;
  }

  for (let k = 1; k <= alcance; k++) {
    const antes = polilinea[indiceMax - k]!;
    const despues = polilinea[indiceMax + k]!;
    if (distanciaMetros(antes, despues) > toleranciaM) {
      return null;
    }
  }

  return indiceMax;
}

/**
 * Tramo VISIBLE de una polilínea — solo la ida, cuando la polilínea completa es de ida y
 * vuelta sobre las mismas calles (ver `indiceDeRetornoDe`). Pensado para DIBUJAR el trazo en
 * el mapa (`RouteMap`/`MapRoute.points` en `en-vivo-simulado.tsx`): dibujar también la vuelta
 * es visualmente idéntico (retraza las mismas calles) pero hace que la mitad del trazo
 * compartido con otra línea corra en sentido contrario, lo que arruina el `line-offset` de
 * MapLibre (offsets de signo fijo quedan del mismo lado en la ida y del lado opuesto en la
 * vuelta — ver comentario de `OFFSET_PX` en `en-vivo-simulado.tsx`).
 *
 * OJO: no usar para MOVER vehículos sobre la ruta — `posicionEnPolilinea` tiene que seguir
 * recibiendo la polilínea COMPLETA (`LineaMock.polilinea`, no este resultado): el loop ida +
 * vuelta es real para el movimiento del trufi, aunque sea redundante para el dibujo.
 *
 * Si la polilínea no es de ida y vuelta (no se detecta vértice de retorno), devuelve la
 * misma polilínea sin cambios.
 */
export function trazoVisibleDe(polilinea: [number, number][]): [number, number][] {
  const indiceRetorno = indiceDeRetornoDe(polilinea);
  return indiceRetorno === null ? polilinea : polilinea.slice(0, indiceRetorno + 1);
}

// ================================================================================================
// Helpers añadidos para el mock del panel del delegado (`docs/plan-mock-guion-delegado.md`,
// subagente A). Reusan `segmentosDe`/`distanciaMetros` de arriba — no se duplica la lógica de
// distancia acumulada.
// ================================================================================================

/** Wrapper público de `distanciaMetros` (arriba es privada) — lo necesitan `estado/*` para
 * medir gaps delante/detrás y tramos de atasco sin reimplementar haversine. */
export function distanciaEntrePuntosM(a: [number, number], b: [number, number]): number {
  return distanciaMetros(a, b);
}

/** Largo total (metros) de una polilínea — wrapper público de `segmentosDe().largoTotal`,
 * usado por `estado/salidas.ts` para convertir la velocidad de un trufi (fracción de loop por
 * tick) a metros/segundo al calcular `delanteDetras`. */
export function largoTotalM(polilinea: [number, number][]): number {
  return segmentosDe(polilinea).largoTotal;
}

/**
 * Avance `[0,1)` de un punto `(lat, lng)` sobre `polilinea`: ubica el VÉRTICE más cercano
 * (no proyección sobre el segmento — de sobra para paradas ya puestas casi encima de un
 * vértice real de la polilínea, que es como están cargadas todas las paradas de `datos.ts`) y
 * devuelve su distancia acumulada / largo total.
 *
 * OJO: busca el vértice más cercano en TODA la polilínea — en un circuito (ida y vuelta por
 * otro camino, o un loop que pasa dos veces cerca del mismo punto) esto puede matchear un
 * vértice del lado equivocado y romper el orden de `orden` entre paradas (bug real observado
 * en Z12: `villa-armonia`, la primera parada, matcheaba el ÚLTIMO vértice del loop y daba
 * avance ≈0.999999). Para precalcular `ParadaMock.avance` de una LÍNEA completa (varias
 * paradas, cada una con su `orden`) usar `avancesDeParadas`, que busca cada parada solo hacia
 * ADELANTE del vértice de la parada anterior y por eso da un avance monótono creciente por
 * `orden`. Esta función queda para el caso de un único punto suelto (y para los tests).
 */
export function avanceDeParada(polilinea: [number, number][], lat: number, lng: number): number {
  if (polilinea.length === 0) {
    return 0;
  }
  let indiceCercano = 0;
  let distanciaCercana = Infinity;
  for (let i = 0; i < polilinea.length; i++) {
    const d = distanciaMetros(polilinea[i]!, [lat, lng]);
    if (d < distanciaCercana) {
      distanciaCercana = d;
      indiceCercano = i;
    }
  }
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) {
    return 0;
  }
  let acumulado = 0;
  for (let i = 0; i < indiceCercano; i++) {
    acumulado += segmentos[i]!;
  }
  return Math.min(0.999999, acumulado / largoTotal);
}

/**
 * Avances `[0,1)` de un conjunto de paradas de una MISMA línea, uno por parada, en el MISMO
 * orden en que se pasaron en `paradas` (no necesariamente ordenadas por `orden`). A diferencia
 * de `avanceDeParada` (que busca el vértice más cercano en TODA la polilínea), acá cada parada
 * busca su vértice más cercano SOLO ESTRICTAMENTE DESPUÉS del vértice encontrado para la parada
 * anterior (según `orden`) — así el resultado es SIEMPRE monótono CRECIENTE por `orden`. La
 * PRIMERA parada (menor `orden`) recibe avance `0` fijo — es el origen del loop, no se busca su
 * vértice (ver comentario de `avanceDeParada` sobre por qué buscarlo en toda la polilínea puede
 * dar 0.999999 en vez de 0 para el punto de partida).
 *
 * OJO con un caso real de este mock: las coordenadas de las paradas "intermedias" de Z12
 * (`datos.ts`) vienen de puntos de control reales pero su `orden` fue asignado a mano, sin
 * verificar que coincidiera con la posición real a lo largo del circuito — el vértice más
 * cercano GLOBAL de varias de ellas cae en la MISMA zona de la polilínea (cerca del final del
 * loop). Si la búsqueda de cada parada pudiera repetir el índice de la anterior (`>=` en vez de
 * `>`), esas paradas quedarían con el MISMO avance (empatadas) — rompe cualquier lógica que
 * asuma estrictamente creciente (cruce de puntos de control en orden). Por eso la búsqueda
 * arranca en `indiceBusqueda + 1`, nunca en `indiceBusqueda`: fuerza que cada parada avance AL
 * MENOS un vértice más que la anterior, aunque no sea su vecino geográfico más cercano en
 * términos absolutos — sigue siendo el mejor candidato DISPONIBLE dado que ya se "gastó" el
 * tramo anterior.
 */
export function avancesDeParadas(
  polilinea: [number, number][],
  paradas: { lat: number; lng: number; orden: number }[],
): number[] {
  if (polilinea.length === 0 || paradas.length === 0) {
    return paradas.map(() => 0);
  }
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  const ordenAsc = [...paradas].sort((a, b) => a.orden - b.orden);
  const avancePorOrden = new Map<number, number>();

  let indiceBusqueda = 0;
  ordenAsc.forEach((parada, i) => {
    if (i === 0) {
      avancePorOrden.set(parada.orden, 0);
      return;
    }
    const desde = Math.min(indiceBusqueda + 1, polilinea.length - 1);
    let indiceCercano = desde;
    let distanciaCercana = Infinity;
    for (let idx = desde; idx < polilinea.length; idx++) {
      const d = distanciaMetros(polilinea[idx]!, [parada.lat, parada.lng]);
      if (d < distanciaCercana) {
        distanciaCercana = d;
        indiceCercano = idx;
      }
    }
    let acumulado = 0;
    for (let idx = 0; idx < indiceCercano; idx++) {
      acumulado += segmentos[idx]!;
    }
    const avance = largoTotal === 0 ? 0 : Math.min(0.999999, acumulado / largoTotal);
    avancePorOrden.set(parada.orden, avance);
    indiceBusqueda = indiceCercano;
  });

  return paradas.map((p) => avancePorOrden.get(p.orden) ?? 0);
}

/**
 * Metros recorridos AVANZANDO por la polilínea desde `avanceInicio` hasta `avanceFin`, en
 * sentido de recorrido normal (hace loop si `avanceFin < avanceInicio`). Usado por
 * `delanteDetras` (`estado/salidas.ts`) para convertir una distancia de arco en minutos según
 * la velocidad nominal de cada trufi.
 */
export function distanciaEntreAvancesM(
  polilinea: [number, number][],
  avanceInicio: number,
  avanceFin: number,
): number {
  const { largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) {
    return 0;
  }
  const a = ((avanceInicio % 1) + 1) % 1;
  const b = ((avanceFin % 1) + 1) % 1;
  const fraccion = b >= a ? b - a : 1 - a + b;
  return fraccion * largoTotal;
}

/**
 * Tramo `[lat,lng][]` de la polilínea desde `avanceInicio` hacia ADELANTE, hasta acumular
 * `metros` (o hasta llegar al final de la polilínea si no es un loop cerrado — en la práctica
 * todas las líneas del mock son loops, así que no hace falta un caso especial ahí). Incluye el
 * punto de inicio exacto (interpolado) como primer elemento, y SIEMPRE termina con el punto
 * interpolado exacto a `metros` de distancia (aunque ese punto caiga dentro del MISMO segmento
 * que el inicio, p. ej. cuando el próximo vértice real está a más de `metros` — antes este caso
 * devolvía un único punto y el overlay de "tramo atascado" desaparecía del mapa). Usado por
 * `simularAtasco` (`estado/flota.ts`) para exponer el tramo "atascado" (~250 m) a dibujar en el
 * mapa.
 */
export function tramoDesdeAvance(
  polilinea: [number, number][],
  avanceInicio: number,
  metros: number,
): [number, number][] {
  if (polilinea.length < 2) {
    return polilinea.length === 1 ? [polilinea[0]!] : [];
  }
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) {
    return [polilinea[0]!];
  }

  const inicio = posicionEnPolilinea(polilinea, avanceInicio);
  const puntos: [number, number][] = [[inicio.lat, inicio.lng]];

  const t = ((avanceInicio % 1) + 1) % 1;
  const distanciaInicio = t * largoTotal;
  const distanciaObjetivo = Math.min(largoTotal, distanciaInicio + Math.max(0, metros));

  // Ubica el índice de segmento donde cae `avanceInicio`, para empezar a acumular vértices
  // completos desde ahí en adelante.
  let acumulado = 0;
  let indiceSegmento = segmentos.length - 1;
  for (let i = 0; i < segmentos.length; i++) {
    if (acumulado + segmentos[i]! >= distanciaInicio) {
      indiceSegmento = i;
      break;
    }
    acumulado += segmentos[i]!;
  }

  let acumuladoRecorrido = acumulado;
  for (let i = indiceSegmento; i < segmentos.length; i++) {
    const largoSegmento = segmentos[i]!;
    const finSegmento = acumuladoRecorrido + largoSegmento;
    if (finSegmento >= distanciaObjetivo) {
      // El objetivo cae DENTRO de este segmento (o justo en su extremo) — interpola el punto
      // final y listo. Si el segmento de arranque YA es este mismo (`i === indiceSegmento`),
      // no vuelve a empujar su vértice inicial (ya está en `puntos` como `inicio`).
      if (i > indiceSegmento) {
        puntos.push(polilinea[i]!);
      }
      const fraccion = largoSegmento === 0 ? 0 : Math.min(1, Math.max(0, (distanciaObjetivo - acumuladoRecorrido) / largoSegmento));
      const [lat1, lng1] = polilinea[i]!;
      const [lat2, lng2] = polilinea[i + 1]!;
      puntos.push([lat1 + (lat2 - lat1) * fraccion, lng1 + (lng2 - lng1) * fraccion]);
      return puntos;
    }
    if (i > indiceSegmento) {
      puntos.push(polilinea[i]!);
    }
    acumuladoRecorrido = finSegmento;
  }

  // Solo alcanzable si `distanciaObjetivo` cae exactamente en el largo total (clamp de arriba)
  // y el loop no lo capturó por redondeo — devuelve hasta el último vértice.
  puntos.push(polilinea[polilinea.length - 1]!);
  return puntos;
}

/**
 * Rumbo (grados, 0=norte/+lat, 90=este/+lng — aproximación plana suficiente para el radio de
 * esta demo) de la polilínea en el punto `avance`, usado para desplazar perpendicularmente el
 * marcador durante `simularDesvio` (`estado/flota.ts`).
 */
export function bearingEnAvance(polilinea: [number, number][], avance: number): number {
  if (polilinea.length < 2) {
    return 0;
  }
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) {
    return 0;
  }
  const t = ((avance % 1) + 1) % 1;
  const distanciaObjetivo = t * largoTotal;
  let acumulado = 0;
  for (let i = 0; i < segmentos.length; i++) {
    if (acumulado + segmentos[i]! >= distanciaObjetivo || i === segmentos.length - 1) {
      const [lat1, lng1] = polilinea[i]!;
      const [lat2, lng2] = polilinea[i + 1]!;
      const dLat = lat2 - lat1;
      const dLng = (lng2 - lng1) * Math.cos(aRadianes((lat1 + lat2) / 2));
      return (Math.atan2(dLng, dLat) * 180) / Math.PI;
    }
    acumulado += segmentos[i]!;
  }
  return 0;
}

/**
 * Desplaza `(lat, lng)` `metros` en la dirección PERPENDICULAR (90° a la derecha) de
 * `bearingDeg`. Aproximación plana (válida al radio de una demo de mapa urbano) — usada por
 * `simularDesvio` para generar el trayecto que se separa de la polilínea y vuelve a unirse.
 */
export function desplazarPerpendicular(
  lat: number,
  lng: number,
  bearingDeg: number,
  metros: number,
): { lat: number; lng: number } {
  const bearingPerpendicular = aRadianes(bearingDeg + 90);
  const dLat = (metros * Math.cos(bearingPerpendicular)) / RADIO_TIERRA_M;
  const dLng = (metros * Math.sin(bearingPerpendicular)) / (RADIO_TIERRA_M * Math.cos(aRadianes(lat)));
  return {
    lat: lat + (dLat * 180) / Math.PI,
    lng: lng + (dLng * 180) / Math.PI,
  };
}
