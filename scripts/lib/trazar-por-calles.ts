/**
 * Ajuste de un boceto (polilínea dibujada a mano) a las calles reales con la **Google Routes API**
 * (`computeRoutes`), respetando el sentido de circulación y la calzada de cada tramo.
 *
 * Idea: el boceto se remuestrea cada ~250 m y cada muestra viaja como waypoint `via: true` con
 * `heading` = rumbo del boceto EN EL SENTIDO DEL TRAMO. El `heading` obliga a Routes a tomar la
 * calzada que va hacia ese rumbo (en una avenida de doble calzada, la de ida o la de vuelta).
 * Routes admite hasta 25 intermedios por request: se encadenan requests (el destino de uno es el
 * origen del siguiente) y los trozos decodificados se unen sin duplicar el punto de empalme.
 *
 * Todo lo de acá es PURO salvo `calcularRutaGoogle` / `trazarPorCalles` (las únicas con red).
 * Coordenadas siempre `[lon, lat]` (GeoJSON), como el resto de los scripts.
 */

export type Coord = [number, number];

export interface Muestra {
  coord: Coord;
  /**
   * Rumbo del boceto en el sentido del tramo, grados 0–359 (0 = norte, 90 = este). `null` si el
   * boceto gira de golpe en ese punto (esquina, rotonda, lazo dibujado a mano): ahí el rumbo no
   * corresponde a ninguna calle y forzarlo hace que Routes dé vueltas largas para "cumplirlo".
   */
  rumbo: number | null;
}

export interface RequestRuta {
  origen: Muestra;
  /** Hasta `MAX_INTERMEDIOS` waypoints `via`. */
  intermedios: Muestra[];
  destino: Muestra;
}

export const ESPACIADO_MUESTRAS_M = 250;
export const MAX_INTERMEDIOS = 25;
/** Semiventana (m de arco) para medir el rumbo local del boceto. */
export const VENTANA_RUMBO_M = 30;
/** Giro del boceto (grados, a ±ventana) desde el cual la muestra va sin rumbo. */
export const GIRO_SIN_RUMBO_GRADOS = 50;
/**
 * Zona enredada: si el boceto acumula más de este giro (suma de |cambios de rumbo|, en grados)
 * dentro de ±`RADIO_ENREDO_M` de una muestra, es un lazo/rotonda dibujado a mano y la muestra se
 * omite (Routes recorre esa zona por la calle natural en vez de dar vueltas largas para "pasar"
 * por un punto con un rumbo que ninguna calle tiene). Primer y último punto nunca se omiten.
 */
export const GIRO_ENREDO_GRADOS = 150;
export const RADIO_ENREDO_M = 100;
export const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const RADIO_TIERRA_M = 6_371_000;
const RAD = Math.PI / 180;

export function distanciaM(a: Coord, b: Coord): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud de una polilínea en metros. */
export function longitudM(coords: Coord[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanciaM(coords[i - 1]!, coords[i]!);
  return total;
}

/** Rumbo inicial (azimut) de `a` hacia `b`, entero en 0–359 (0 = N, 90 = E, 180 = S, 270 = W). */
export function rumboInicial(a: Coord, b: Coord): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const grados = (Math.atan2(y, x) / RAD + 360) % 360;
  return Math.round(grados) % 360;
}

/** Punto de la polilínea a `s` metros desde el inicio (por longitud de arco; `s` se acota a [0, total]). */
function puntoEnDistancia(coords: Coord[], acumulado: number[], s: number): Coord {
  const total = acumulado[acumulado.length - 1]!;
  if (s <= 0) return coords[0]!;
  if (s >= total) return coords[coords.length - 1]!;
  let i = 1;
  while (acumulado[i]! < s) i++;
  const largo = acumulado[i]! - acumulado[i - 1]!;
  const t = largo === 0 ? 0 : (s - acumulado[i - 1]!) / largo;
  const a = coords[i - 1]!;
  const b = coords[i]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Suma de |cambios de rumbo| (grados) del boceto entre las distancias de arco `desde` y `hasta`, mirando cada 15 m. */
function giroAcumulado(coords: Coord[], acumulado: number[], desde: number, hasta: number): number {
  const total = acumulado[acumulado.length - 1]!;
  const ini = Math.max(0, desde);
  const fin = Math.min(total, hasta);
  let giro = 0;
  let previo: number | null = null;
  let anterior = puntoEnDistancia(coords, acumulado, ini);
  for (let s = ini + 15; s < fin + 15; s += 15) {
    const actual = puntoEnDistancia(coords, acumulado, Math.min(s, fin));
    if (distanciaM(anterior, actual) > 1) {
      const r = rumboInicial(anterior, actual);
      if (previo !== null) giro += Math.abs(((r - previo + 540) % 360) - 180);
      previo = r;
      anterior = actual;
    }
  }
  return giro;
}

/**
 * Remuestrea una polilínea cada `pasoM` metros (por longitud de arco). Conserva SIEMPRE el primer y
 * el último punto. El rumbo de cada muestra es el del boceto en el sentido en que se recorre la
 * polilínea, medido entre los puntos a ±`ventanaRumboM` metros de arco (no del segmento suelto: en
 * un boceto a mano un vértice en una esquina daría un rumbo que no corresponde a ninguna calle).
 * Si la última muestra interior queda a menos de medio paso del final, se descarta.
 */
export function remuestrear(coords: Coord[], pasoM: number = ESPACIADO_MUESTRAS_M, ventanaRumboM: number = VENTANA_RUMBO_M, giroSinRumboGrados: number = GIRO_SIN_RUMBO_GRADOS): Muestra[] {
  if (coords.length < 2) throw new Error('remuestrear: hacen falta al menos 2 puntos.');
  if (!(pasoM > 0)) throw new Error('remuestrear: pasoM debe ser > 0.');
  const acumulado = [0];
  for (let i = 1; i < coords.length; i++) acumulado.push(acumulado[i - 1]! + distanciaM(coords[i - 1]!, coords[i]!));
  const total = acumulado[acumulado.length - 1]!;
  if (!(total > 0)) throw new Error('remuestrear: la polilínea tiene longitud 0.');
  const distancias = [0];
  for (let s = pasoM; s < total - pasoM / 2; s += pasoM) {
    if (giroAcumulado(coords, acumulado, s - RADIO_ENREDO_M, s + RADIO_ENREDO_M) <= GIRO_ENREDO_GRADOS) distancias.push(s);
  }
  distancias.push(total);
  return distancias.map((s) => {
    const centro = puntoEnDistancia(coords, acumulado, s);
    const antes = puntoEnDistancia(coords, acumulado, s - ventanaRumboM);
    const despues = puntoEnDistancia(coords, acumulado, s + ventanaRumboM);
    const esExtremo = s === 0 || s === total;
    if (!esExtremo) {
      const giro = Math.abs(((rumboInicial(centro, despues) - rumboInicial(antes, centro) + 540) % 360) - 180);
      if (giro > giroSinRumboGrados) return { coord: centro, rumbo: null };
    }
    return { coord: centro, rumbo: rumboInicial(antes, despues) };
  });
}

/**
 * Trocea las muestras en requests de ≤ `maxIntermedios` waypoints intermedios, encadenados: el
 * destino de un request es el origen del siguiente. 60 muestras ⇒ 3 requests (27 + 27 + 8).
 */
export function trocear(muestras: Muestra[], maxIntermedios: number = MAX_INTERMEDIOS): RequestRuta[] {
  if (muestras.length < 2) throw new Error('trocear: hacen falta al menos 2 muestras.');
  const paso = maxIntermedios + 1; // muestras que avanza cada request
  const requests: RequestRuta[] = [];
  for (let ini = 0; ini < muestras.length - 1; ini += paso) {
    const fin = Math.min(ini + paso, muestras.length - 1);
    requests.push({ origen: muestras[ini]!, intermedios: muestras.slice(ini + 1, fin), destino: muestras[fin]! });
  }
  return requests;
}

/** Decodifica un encoded polyline de Google (precisión 5) a `[lon, lat]`. */
export function decodificarPolyline(codificado: string): Coord[] {
  const coords: Coord[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const leerValor = (): number => {
    let resultado = 0;
    let shift = 0;
    let byte: number;
    do {
      if (i >= codificado.length) throw new Error('decodificarPolyline: polyline truncado.');
      byte = codificado.charCodeAt(i++) - 63;
      resultado |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
  };
  while (i < codificado.length) {
    lat += leerValor();
    lon += leerValor();
    coords.push([lon / 1e5, lat / 1e5]);
  }
  return coords;
}

/** Une trozos consecutivos; si el primer punto de un trozo coincide (≤ `toleranciaM`) con el último acumulado, no lo duplica. */
export function unirTrozos(trozos: Coord[][], toleranciaM = 1): Coord[] {
  const unido: Coord[] = [];
  for (const trozo of trozos) {
    const desde = unido.length > 0 && trozo.length > 0 && distanciaM(unido[unido.length - 1]!, trozo[0]!) <= toleranciaM ? 1 : 0;
    for (let k = desde; k < trozo.length; k++) unido.push(trozo[k]!);
  }
  return unido;
}

/** Distancia (m) de un punto a un segmento, en plano local equirectangular. */
export function distanciaPuntoSegmentoM(p: Coord, a: Coord, b: Coord): number {
  const kx = RADIO_TIERRA_M * RAD * Math.cos(p[1] * RAD);
  const ky = RADIO_TIERRA_M * RAD;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanciaAPolilineaM(p: Coord, polilinea: Coord[]): number {
  if (polilinea.length === 1) return distanciaM(p, polilinea[0]!);
  let mejor = Infinity;
  for (let i = 1; i < polilinea.length; i++) mejor = Math.min(mejor, distanciaPuntoSegmentoM(p, polilinea[i - 1]!, polilinea[i]!));
  return mejor;
}

export interface Desvio {
  maxM: number;
  /** Punto (de `a` o de `b`) donde se da el máximo. */
  coord: Coord;
  /** 'a→b': el punto peor es vértice de `a`; 'b→a': vértice de `b`. */
  sentido: 'a→b' | 'b→a';
}

/** Desvío máximo entre dos polilíneas: peor distancia vértice→otra polilínea, en ambos sentidos. */
export function desvioMaximo(a: Coord[], b: Coord[]): Desvio {
  let peor: Desvio = { maxM: -1, coord: a[0]!, sentido: 'a→b' };
  for (const p of a) {
    const d = distanciaAPolilineaM(p, b);
    if (d > peor.maxM) peor = { maxM: d, coord: p, sentido: 'a→b' };
  }
  for (const p of b) {
    const d = distanciaAPolilineaM(p, a);
    if (d > peor.maxM) peor = { maxM: d, coord: p, sentido: 'b→a' };
  }
  return peor;
}

// ============================================================================================
// Cliente Routes API (única parte con red)
// ============================================================================================

function waypoint(m: Muestra, via: boolean): Record<string, unknown> {
  return {
    ...(via ? { via: true } : {}),
    location: { latLng: { latitude: m.coord[1], longitude: m.coord[0] }, ...(m.rumbo === null ? {} : { heading: m.rumbo }) },
  };
}

/** Body de `computeRoutes` para un request troceado. Público para poder testearlo. */
export function armarBodyRoutes(req: RequestRuta): Record<string, unknown> {
  return {
    origin: waypoint(req.origen, false),
    destination: waypoint(req.destino, false),
    intermediates: req.intermedios.map((m) => waypoint(m, true)),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    polylineQuality: 'HIGH_QUALITY',
    polylineEncoding: 'ENCODED_POLYLINE',
  };
}

/** Un request a Routes API → coordenadas de la ruta. Errores HTTP con mensaje claro (nunca incluye la key). */
export async function calcularRutaGoogle(req: RequestRuta, apiKey: string): Promise<{ coords: Coord[]; distanciaM: number }> {
  const res = await fetch(ROUTES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters',
    },
    body: JSON.stringify(armarBodyRoutes(req)),
  });
  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`Routes API respondió HTTP ${res.status} ${res.statusText}: ${texto.slice(0, 800)}`);
  }
  let json: { routes?: { polyline?: { encodedPolyline?: string }; distanceMeters?: number }[] };
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(`Routes API devolvió una respuesta no-JSON: ${texto.slice(0, 300)}`);
  }
  const ruta = json.routes?.[0];
  const codificado = ruta?.polyline?.encodedPolyline;
  if (!codificado) {
    throw new Error(`Routes API no devolvió ruta (origen ${req.origen.coord.join(',')} → destino ${req.destino.coord.join(',')}): ${texto.slice(0, 300)}`);
  }
  return { coords: decodificarPolyline(codificado), distanciaM: ruta?.distanceMeters ?? 0 };
}

/**
 * Primer "espolón" del trazado: un vértice `i` al que el trazado VUELVE (a <= `toleranciaM`) después
 * de recorrer más de `arcoMinM` metros. Es el patrón de ir y volver por la misma calle para dar un
 * giro en U (típico cuando Routes no puede "pasar" por un waypoint con su heading). Devuelve el
 * vértice donde arranca el espolón, o `null`. Si se pasa `boceto`, solo cuenta el espolón cuyo
 * extremo se aleja más de `alejamientoMinM` del boceto: un ir y volver que el propio boceto dibuja
 * (p. ej. el retorno en Honduras) es legítimo y no se toca.
 */
export function primerEspolon(trazado: Coord[], boceto?: Coord[], arcoMinM = 100, toleranciaM = 10, alejamientoMinM = 80): Coord | null {
  const acumulado = [0];
  for (let i = 1; i < trazado.length; i++) acumulado.push(acumulado[i - 1]! + distanciaM(trazado[i - 1]!, trazado[i]!));
  for (let i = 0; i < trazado.length; i++) {
    for (let j = i + 1; j < trazado.length; j++) {
      if (acumulado[j]! - acumulado[i]! <= arcoMinM) continue;
      if (distanciaM(trazado[i]!, trazado[j]!) > toleranciaM) continue;
      if (boceto) {
        let lejos = false;
        for (let k = i + 1; k < j && !lejos; k++) lejos = distanciaAPolilineaM(trazado[k]!, boceto) > alejamientoMinM;
        if (!lejos) continue;
      }
      return trazado[i]!;
    }
  }
  return null;
}

export const MAX_REINTENTOS_POR_REQUEST = 5;
/** Un waypoint solo se descarta si está a menos de esto del inicio del espolón (si no, no es el culpable). */
const DISTANCIA_CULPABLE_M = 150;

/**
 * Ajusta un tramo del boceto a las calles: remuestrea, trocea, llama a Routes y une los trozos.
 *
 * Robustez: con un `heading` que la calle no admite (o un punto del boceto mal puesto), Routes suele
 * "cumplir" el waypoint metiendo un espolón de cientos de metros para dar la vuelta. Si el trozo
 * tiene un espolón, se descarta el waypoint intermedio más cercano a su inicio y se reintenta (hasta
 * `MAX_REINTENTOS_POR_REQUEST`); gana el intento más corto. La validación del tramo decide después.
 */
export async function trazarPorCalles(
  boceto: Coord[],
  apiKey: string,
  opciones: { pasoM?: number; maxIntermedios?: number; ventanaRumboM?: number; giroSinRumboGrados?: number } = {},
): Promise<{ coords: Coord[]; requests: number; descartadas: Coord[] }> {
  const muestras = remuestrear(boceto, opciones.pasoM ?? ESPACIADO_MUESTRAS_M, opciones.ventanaRumboM ?? VENTANA_RUMBO_M, opciones.giroSinRumboGrados ?? GIRO_SIN_RUMBO_GRADOS);
  const requests = trocear(muestras, opciones.maxIntermedios ?? MAX_INTERMEDIOS);
  const trozos: Coord[][] = [];
  const descartadas: Coord[] = [];
  let llamadas = 0;
  for (const original of requests) {
    let req = original;
    let mejor: Coord[] | null = null;
    let mejorLargo = Infinity;
    for (let intento = 0; intento <= MAX_REINTENTOS_POR_REQUEST; intento++) {
      const { coords } = await calcularRutaGoogle(req, apiKey);
      llamadas++;
      const largo = longitudM(coords);
      if (largo < mejorLargo) {
        mejor = coords;
        mejorLargo = largo;
      }
      const espolon = primerEspolon(coords, boceto);
      if (!espolon || req.intermedios.length === 0) break;
      let culpable = 0;
      for (let k = 1; k < req.intermedios.length; k++) {
        if (distanciaM(req.intermedios[k]!.coord, espolon) < distanciaM(req.intermedios[culpable]!.coord, espolon)) culpable = k;
      }
      if (distanciaM(req.intermedios[culpable]!.coord, espolon) > DISTANCIA_CULPABLE_M) break;
      descartadas.push(req.intermedios[culpable]!.coord);
      req = { ...req, intermedios: req.intermedios.filter((_, k) => k !== culpable) };
    }
    trozos.push(mejor!);
  }
  return { coords: unirTrozos(trozos), requests: llamadas, descartadas };
}
