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
  /** Abscisa (m de arco) de la muestra sobre el boceto del que salió; opcional. */
  s?: number;
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

/** Diferencia angular absoluta entre dos rumbos, en grados (0–180). */
export function difAngulo(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
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

/**
 * Tramo de la polilínea entre las abscisas `desde` y `hasta` (m de arco, acotadas a [0, total]):
 * puntos interpolados en los extremos y los vértices intermedios.
 */
export function cortarPolilinea(coords: Coord[], desde: number, hasta: number): Coord[] {
  const acumulado = [0];
  for (let i = 1; i < coords.length; i++) acumulado.push(acumulado[i - 1]! + distanciaM(coords[i - 1]!, coords[i]!));
  const total = acumulado[acumulado.length - 1]!;
  const a = Math.max(0, Math.min(desde, hasta));
  const b = Math.min(total, Math.max(desde, hasta));
  const res: Coord[] = [puntoEnDistancia(coords, acumulado, a)];
  for (let i = 0; i < coords.length; i++) if (acumulado[i]! > a && acumulado[i]! < b) res.push(coords[i]!);
  res.push(puntoEnDistancia(coords, acumulado, b));
  return res;
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
      if (previo !== null) giro += difAngulo(r, previo);
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
      const giro = difAngulo(rumboInicial(centro, despues), rumboInicial(antes, centro));
      if (giro > giroSinRumboGrados) return { coord: centro, rumbo: null, s };
    }
    return { coord: centro, rumbo: rumboInicial(antes, despues), s };
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

/** Proyección de un punto sobre un segmento, en plano local equirectangular: distancia `d` (m) y parámetro `t` (0–1) del pie. */
export function proyectarEnSegmento(p: Coord, a: Coord, b: Coord): { d: number; t: number } {
  const kx = RADIO_TIERRA_M * RAD * Math.cos(p[1] * RAD);
  const ky = RADIO_TIERRA_M * RAD;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/** Distancia (m) de un punto a un segmento, en plano local equirectangular. */
export function distanciaPuntoSegmentoM(p: Coord, a: Coord, b: Coord): number {
  return proyectarEnSegmento(p, a, b).d;
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

// ============================================================================================
// Detección de rulos
// ============================================================================================

/**
 * Abscisa (m de arco sobre `boceto`) de la proyección de cada punto, con continuidad: se busca cerca
 * de la abscisa anterior (el boceto puede cruzarse a sí mismo) y solo se salta a una búsqueda global
 * si la ventana queda lejos (> 100 m) y la global es claramente mejor Y NO retrocede (la global solo
 * se acepta hacia adelante o con un retroceso <= 200 m: un trazado que se aleja de su rama puede
 * quedar más cerca de una rama ANTERIOR del boceto, pero eso no es avanzar hacia atrás). Ante empates
 * de distancia (boceto que va y vuelve por la misma calle) gana la abscisa más cercana al avance
 * esperado. `sInicio` (opcional) fija dónde arranca el primer punto cuando el boceto se cruza.
 */
export function abscisasSobreBoceto(pts: Coord[], boceto: Coord[], sInicio?: number): number[] {
  const acum = [0];
  for (let i = 1; i < boceto.length; i++) acum.push(acum[i - 1]! + distanciaM(boceto[i - 1]!, boceto[i]!));
  const buscar = (p: Coord, desde: number, hasta: number, esperada: number | null): { s: number; d: number } => {
    const cands: { s: number; d: number }[] = [];
    for (let i = 1; i < boceto.length; i++) {
      if (acum[i]! < desde || acum[i - 1]! > hasta) continue;
      const { d, t } = proyectarEnSegmento(p, boceto[i - 1]!, boceto[i]!);
      cands.push({ s: acum[i - 1]! + t * (acum[i]! - acum[i - 1]!), d });
    }
    if (cands.length === 0) return { s: desde, d: Infinity };
    const dMin = Math.min(...cands.map((c) => c.d));
    const empatados = cands.filter((c) => c.d <= dMin + 5);
    if (esperada === null) return empatados.reduce((m, c) => (c.d < m.d ? c : m));
    return empatados.reduce((m, c) => (Math.abs(c.s - esperada) < Math.abs(m.s - esperada) ? c : m));
  };
  const res: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    if (k === 0) {
      res.push(sInicio === undefined ? buscar(pts[0]!, -Infinity, Infinity, null).s : buscar(pts[0]!, sInicio - 200, sInicio + 300, sInicio).s);
      continue;
    }
    const prev = res[k - 1]!;
    const paso = distanciaM(pts[k - 1]!, pts[k]!);
    let r = buscar(pts[k]!, prev - 200, prev + 300, prev + paso);
    if (r.d > 100) {
      const g = buscar(pts[k]!, -Infinity, Infinity, prev + paso);
      if (g.d < r.d - 30 && (g.s >= prev - 200 || r.d === Infinity)) r = g;
    }
    res.push(r.s);
  }
  return res;
}

export interface VueltaU {
  /** Vértice del trazado (índice) del ápice. */
  indice: number;
  coord: Coord;
  /** Giro de rumbo (grados) medido en `arcoM`. */
  giroGrados: number;
  /** Recorrido (m) en que ocurre la inversión. */
  arcoM: number;
}

/**
 * Vueltas en U del trazado que el boceto NO dibuja: el rumbo se invierte (> `giroMinGrados`) en un
 * recorrido <= `arcoMaxM`. Se ignora si el boceto, en esa abscisa (±60 m), tiene su propia
 * inversión (> 120° en <= 80 m), p. ej. el retorno de Honduras. Trabaja densificado a 5 m.
 * `sInicio`: abscisa del boceto donde arranca el trazado (si el boceto se cruza a sí mismo).
 */
export function detectarVueltasU(trazado: Coord[], boceto: Coord[], giroMinGrados = 150, arcoMaxM = 40, sInicio?: number): VueltaU[] {
  if (trazado.length < 3 || boceto.length < 2) return [];
  const pts: Coord[] = [trazado[0]!];
  const orig: number[] = [0];
  for (let i = 1; i < trazado.length; i++) {
    const a = trazado[i - 1]!;
    const b = trazado[i]!;
    const n = Math.max(1, Math.ceil(distanciaM(a, b) / 5));
    for (let k = 1; k <= n; k++) {
      pts.push(k === n ? b : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      orig.push(k === n ? i : i - 1);
    }
  }
  const arco = [0];
  for (let i = 1; i < pts.length; i++) arco.push(arco[i - 1]! + distanciaM(pts[i - 1]!, pts[i]!));
  const sAbs = abscisasSobreBoceto(pts, boceto, sInicio);
  const acumB = [0];
  for (let i = 1; i < boceto.length; i++) acumB.push(acumB[i - 1]! + distanciaM(boceto[i - 1]!, boceto[i]!));
  const totalB = acumB[acumB.length - 1]!;
  /** Rumbo del boceto en `s` (ventana ±10 m acotada a [0, total]); `null` si la ventana colapsa (< 5 m) y no hay rumbo fiable. */
  const rumboB = (s: number): number | null => {
    const a = Math.max(0, Math.min(totalB, s - 10));
    const b = Math.max(0, Math.min(totalB, s + 10));
    if (b - a < 5) return null;
    return rumboInicial(puntoEnDistancia(boceto, acumB, a), puntoEnDistancia(boceto, acumB, b));
  };
  const bocetoInvierte = (desde: number, hasta: number): boolean => {
    const d0 = Math.max(0, desde);
    const h0 = Math.min(totalB, hasta);
    for (let s = d0; s <= h0; s += 10) {
      const r0 = rumboB(s);
      if (r0 === null) continue;
      for (let w = 20; w <= 80; w += 10) {
        const r1 = rumboB(s + w);
        if (r1 !== null && difAngulo(r1, r0) > 120) return true;
      }
    }
    return false;
  };
  const res: VueltaU[] = [];
  let i = 0;
  while (i < pts.length) {
    // Rumbo de entrada (10 m antes de i) vs. rumbo de salida (10 m después de j), j dentro de arcoMaxM.
    let hallado = -1;
    let giroMax = 0;
    let jFin = i;
    let ini = i;
    while (ini > 0 && arco[i]! - arco[ini]! < 10) ini--;
    if (ini < i && distanciaM(pts[ini]!, pts[i]!) > 3) {
      const r0 = rumboInicial(pts[ini]!, pts[i]!);
      for (let j = i + 2; j < pts.length && arco[j]! - arco[i]! <= arcoMaxM; j++) {
        let k = j;
        while (k + 1 < pts.length && arco[k]! - arco[j]! < 10) k++;
        if (k === j || distanciaM(pts[j]!, pts[k]!) <= 3) continue;
        const g = difAngulo(rumboInicial(pts[j]!, pts[k]!), r0);
        if (g > giroMinGrados && g > giroMax) {
          giroMax = g;
          hallado = j;
          jFin = j;
        }
      }
    }
    if (hallado < 0) {
      i++;
      continue;
    }
    const sMin = Math.min(sAbs[i]!, sAbs[jFin]!) - 60;
    const sMax = Math.max(sAbs[i]!, sAbs[jFin]!) + 60;
    if (!bocetoInvierte(sMin, sMax)) {
      const mid = Math.round((i + jFin) / 2);
      res.push({ indice: orig[mid]!, coord: pts[mid]!, giroGrados: giroMax, arcoM: arco[jFin]! - arco[i]! });
    }
    i = jFin + 1;
  }
  return res;
}

/**
 * Poda los espolones: una vuelta en U que el boceto no dibuja y que consiste en ir hasta un ápice y
 * volver por EXACTAMENTE los mismos puntos (el trazado vuelve a < `toleranciaM` del punto de
 * partida de la ida; típico de un waypoint al final de una calle sin salida). Exige ida-y-vuelta
 * real: cada punto de la vuelta cae a <= `calzaM` de la polilínea de la ida y la recorre en sentido
 * inverso (abscisa decreciente), y viceversa; un lazo que cierra en otro camino (una rotonda) NO se
 * poda. Quita los vértices desde el siguiente al de partida hasta el de regreso: la geometría pierde
 * un ir y volver de área cero. Solo toca lo que `detectarVueltasU` marca; no toca ninguna U que
 * dibuje el boceto. Devuelve también las U detectadas sobre la entrada (`us`), para no recalcularlas.
 */
export function podarEspolones(coords: Coord[], boceto: Coord[], toleranciaM = 3, vecindad = 6, calzaM = 4): { coords: Coord[]; podados: Coord[]; us: VueltaU[] } {
  const us = detectarVueltasU(coords, boceto);
  const quitar = new Set<number>();
  const podados: Coord[] = [];
  for (const u of us) {
    let mejor: { i: number; j: number } | null = null;
    for (let i = Math.max(0, u.indice - vecindad); i <= u.indice; i++) {
      for (let j = Math.min(coords.length - 1, u.indice + vecindad); j >= u.indice && j > i + 1; j--) {
        if (distanciaM(coords[i]!, coords[j]!) <= toleranciaM && (!mejor || j - i > mejor.j - mejor.i) && esIdaYVuelta(coords.slice(i, j + 1), calzaM)) mejor = { i, j };
      }
    }
    if (!mejor || quitar.has(mejor.i + 1)) continue;
    podados.push(coords[u.indice]!);
    for (let k = mejor.i + 1; k <= mejor.j; k++) quitar.add(k);
  }
  return { coords: coords.filter((_, k) => !quitar.has(k)), podados, us };
}

/**
 * ¿El lazo `lazo` (primer y último punto coinciden) es ir hasta un ápice y volver por los mismos
 * puntos? El ápice es el vértice más lejano al inicio; la vuelta debe recorrer la ida en sentido
 * inverso y la ida debe quedar cubierta por la vuelta (ambas a <= `calzaM`).
 */
function esIdaYVuelta(lazo: Coord[], calzaM: number): boolean {
  let apice = 0;
  let dApice = -1;
  for (let k = 0; k < lazo.length; k++) {
    const d = distanciaM(lazo[0]!, lazo[k]!);
    if (d > dApice) {
      dApice = d;
      apice = k;
    }
  }
  if (apice === 0 || apice === lazo.length - 1) return false;
  const ida = lazo.slice(0, apice + 1);
  const vuelta = lazo.slice(apice);
  const acumIda = [0];
  for (let k = 1; k < ida.length; k++) acumIda.push(acumIda[k - 1]! + distanciaM(ida[k - 1]!, ida[k]!));
  /** Abscisa y distancia de `p` proyectado sobre la ida. */
  const sobreIda = (p: Coord): { s: number; d: number } => {
    let mejor = { s: 0, d: Infinity };
    for (let k = 1; k < ida.length; k++) {
      const { d, t } = proyectarEnSegmento(p, ida[k - 1]!, ida[k]!);
      if (d < mejor.d) mejor = { s: acumIda[k - 1]! + t * (acumIda[k]! - acumIda[k - 1]!), d };
    }
    return mejor;
  };
  // La vuelta sale del ápice (abscisa máxima de la ida) y la desanda sin retroceder (holgura `calzaM`).
  let sPrev = Infinity;
  for (const p of vuelta) {
    const r = sobreIda(p);
    if (r.d > calzaM || r.s > sPrev + calzaM) return false;
    sPrev = Math.min(sPrev, r.s);
  }
  // La ida entera queda cubierta por la vuelta (si no, la vuelta tomó otro camino).
  return ida.every((p) => distanciaAPolilineaM(p, vuelta) <= calzaM);
}

export interface Rulo {
  /** Índice (en `trazado`) del último vértice previo al rulo, ya sobre el boceto. */
  indice: number;
  /** Índice (en `trazado`) del primer vértice posterior al rulo. */
  indiceReingreso: number;
  salida: Coord;
  reingreso: Coord;
  /** Largo recorrido entre la salida y el reingreso (m). */
  largoM: number;
  /** Distancia en línea recta entre la salida y el reingreso (m). */
  rectaM: number;
  /** Máxima distancia al boceto dentro del rulo (m). */
  desvioMaxM: number;
  /** Punto del trazado más alejado del boceto dentro del rulo. */
  coordDesvioMax: Coord;
  criterio: 'vuelve-al-boceto' | 'se-cruza' | 'exceso-local';
  /** Solo 'exceso-local': recorrido del trazado menos avance sobre el boceto en la ventana (m). */
  excesoM?: number;
}

export interface OpcionesRulos {
  /** Un tramo cuenta como "fuera del boceto" a más de esto (m). */
  fueraM?: number;
  /** El recorrido fuera del boceto debe superar `factor` × la recta salida→reingreso. */
  factor?: number;
  /** Recorrido mínimo para que una excursión cuente como rulo (m): filtra ruido. */
  largoMinM?: number;
  /** Criterio 2: el trazado pasa a menos de esto de sí mismo... */
  cercaniaPropiaM?: number;
  /** ...con más de esto de recorrido entre medio (m). */
  arcoPropioMinM?: number;
  /** Criterio 3: exceso de recorrido local mínimo (m); `Infinity` lo desactiva. */
  excesoLocalM?: number;
  /** Abscisa del boceto donde arranca el trazado (si el boceto se cruza a sí mismo); sin ella, búsqueda global. */
  sInicio?: number;
  /** Criterio 3: largo máximo de la ventana (m). */
  ventanaExcesoM?: number;
  /** Criterio 3: el exceso debe ser al menos esta fracción del recorrido de la ventana. */
  excesoRatioMin?: number;
}

/**
 * Rulos del trazado: subtramos donde el trazado se aleja del boceto y vuelve dando la vuelta a una
 * manzana (artefacto de un waypoint `via` ubicado del lado o sentido equivocado). Dos criterios:
 *  1. 'vuelve-al-boceto': excursión a > `fueraM` del boceto cuyo recorrido supera `factor` × la
 *     distancia recta entre el punto de salida y el de reingreso. Una calle paralela legítima de
 *     sentido único tiene salida y reingreso lejos entre sí (recorrido ≈ recta), no es rulo.
 *  2. 'se-cruza': el trazado pasa dos veces a < `cercaniaPropiaM` de sí mismo con más de
 *     `arcoPropioMinM` de recorrido entre medio, y ese subtramo se aleja del boceto (> `fueraM`):
 *     un lazo/giro en U que el propio boceto no dibuja.
 *  3. 'exceso-local': el rulo en un trazado que corre PARALELO al boceto (a 10–30 m, sin tocarlo a
 *     <= `pegadoM`) que el criterio 1 no ve. Cada punto del trazado se proyecta sobre el boceto con
 *     continuidad (cerca de la proyección anterior: el boceto se cruza a sí mismo) para obtener su
 *     abscisa `s`. En una ventana de hasta `ventanaExcesoM`, si (recorrido del trazado − avance de
 *     `s`) > `excesoLocalM` y el exceso es >= `excesoRatioMin` del recorrido, es un rulo. Si el
 *     boceto dibuja el giro, `s` avanza junto con el trazado y no marca; una calle paralela larga
 *     (exceso chico respecto al recorrido) tampoco.
 * Trabaja sobre el trazado densificado a ~10 m (los vértices de Routes pueden estar a 100+ m en rectas).
 */
export function detectarRulos(trazado: Coord[], boceto: Coord[], opciones: OpcionesRulos = {}): Rulo[] {
  const fueraM = opciones.fueraM ?? 35;
  const pegadoM = 8;
  const factor = opciones.factor ?? 2.5;
  const largoMinM = opciones.largoMinM ?? 80;
  const cercaniaPropiaM = opciones.cercaniaPropiaM ?? 25;
  const arcoPropioMinM = opciones.arcoPropioMinM ?? 150;
  const excesoLocalM = opciones.excesoLocalM ?? 150;
  const ventanaExcesoM = opciones.ventanaExcesoM ?? 1000;
  const excesoRatioMin = opciones.excesoRatioMin ?? 0.5;
  if (trazado.length < 3 || boceto.length < 2) return [];

  // Densificación a <= 10 m, recordando el vértice original de cada punto.
  const pts: Coord[] = [trazado[0]!];
  const orig: number[] = [0];
  for (let i = 1; i < trazado.length; i++) {
    const a = trazado[i - 1]!;
    const b = trazado[i]!;
    const n = Math.max(1, Math.ceil(distanciaM(a, b) / 10));
    for (let k = 1; k <= n; k++) {
      pts.push(k === n ? b : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      orig.push(k === n ? i : i - 1);
    }
  }
  const arco = [0];
  for (let i = 1; i < pts.length; i++) arco.push(arco[i - 1]! + distanciaM(pts[i - 1]!, pts[i]!));
  const dBoceto = pts.map((p) => distanciaAPolilineaM(p, boceto));

  const construir = (ia: number, ib: number, criterio: Rulo['criterio'], excesoM?: number): Rulo => {
    let max = -1;
    let cmax = pts[ia]!;
    for (let k = ia; k <= ib; k++) {
      if (dBoceto[k]! > max) {
        max = dBoceto[k]!;
        cmax = pts[k]!;
      }
    }
    return {
      indice: orig[ia]!,
      indiceReingreso: orig[ib]! + (pts[ib]! === trazado[orig[ib]!] ? 0 : 1),
      salida: pts[ia]!,
      reingreso: pts[ib]!,
      largoM: arco[ib]! - arco[ia]!,
      rectaM: distanciaM(pts[ia]!, pts[ib]!),
      desvioMaxM: max,
      coordDesvioMax: cmax,
      criterio,
      ...(excesoM === undefined ? {} : { excesoM }),
    };
  };

  const rulos: Rulo[] = [];
  // Criterio 1: excursiones fuera del boceto.
  let k = 0;
  while (k < pts.length) {
    if (dBoceto[k]! <= fueraM) {
      k++;
      continue;
    }
    let fin = k;
    while (fin + 1 < pts.length && dBoceto[fin + 1]! > fueraM) fin++;
    // La salida/reingreso reales son donde el trazado dejó/retomó el boceto (<= `pegadoM`), no donde cruzó `fueraM`.
    let ia = k - 1;
    let ib = fin + 1;
    while (ia > 0 && dBoceto[ia]! > pegadoM) ia--;
    while (ib < pts.length - 1 && dBoceto[ib]! > pegadoM) ib++;
    k = fin + 1;
    if (ia < 0 || ib >= pts.length || dBoceto[ia]! > pegadoM || dBoceto[ib]! > pegadoM) continue; // el trazado empieza/termina fuera: no hay salida/reingreso
    const largo = arco[ib]! - arco[ia]!;
    const recta = distanciaM(pts[ia]!, pts[ib]!);
    if (largo >= largoMinM && largo > factor * Math.max(recta, 1)) rulos.push(construir(ia, ib, 'vuelve-al-boceto'));
  }
  // Criterio 2: el trazado se cruza consigo mismo (planar local, en metros).
  const lat0 = pts[0]![1];
  const kx = RADIO_TIERRA_M * RAD * Math.cos(lat0 * RAD);
  const ky = RADIO_TIERRA_M * RAD;
  const xy = pts.map((p) => [p[0] * kx, p[1] * ky] as const);
  const cubiertos = (i: number): boolean => rulos.some((r) => i >= r.indice && i <= r.indiceReingreso);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (arco[j]! - arco[i]! <= arcoPropioMinM) continue;
      if (Math.hypot(xy[i]![0] - xy[j]![0], xy[i]![1] - xy[j]![1]) >= cercaniaPropiaM) continue;
      const r = construir(i, j, 'se-cruza');
      if (r.desvioMaxM > fueraM && !cubiertos(orig[i]!) && !rulos.some((x) => x.indice <= r.indice && x.indiceReingreso >= r.indiceReingreso)) {
        rulos.push(r);
        i = j; // sigue después del cruce
      }
      // Si el par se rechazó (lo dibuja el boceto o ya está cubierto) NO se salta el tramo: se sigue desde i+1.
      break;
    }
  }
  // Criterio 3: exceso de recorrido local respecto al avance sobre el boceto.
  if (Number.isFinite(excesoLocalM)) {
    const sAbs = abscisasSobreBoceto(pts, boceto, opciones.sInicio);
    const exceso = (a: number, b: number): number => arco[b]! - arco[a]! - (sAbs[b]! - sAbs[a]!);
    const candidatos: { i: number; j: number; exc: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      let mejor: { j: number; exc: number } | null = null;
      for (let j = i + 1; j < pts.length && arco[j]! - arco[i]! <= ventanaExcesoM; j++) {
        const exc = exceso(i, j);
        if (exc > excesoLocalM && exc >= excesoRatioMin * (arco[j]! - arco[i]!) && (!mejor || exc > mejor.exc)) mejor = { j, exc };
      }
      if (mejor) candidatos.push({ i, ...mejor });
    }
    candidatos.sort((a, b) => b.exc - a.exc);
    const tomados: { i: number; j: number }[] = [];
    for (const c of candidatos) {
      if (tomados.some((t) => c.i <= t.j && c.j >= t.i)) continue;
      let { i, j } = c;
      const base = c.exc;
      while (i + 1 < j && exceso(i + 1, j) >= base - 1) i++;
      while (j - 1 > i && exceso(i, j - 1) >= base - 1) j--;
      if (rulos.some((x) => orig[i]! <= x.indiceReingreso && orig[j]! >= x.indice)) continue;
      tomados.push({ i, j });
      rulos.push(construir(i, j, 'exceso-local', exceso(i, j)));
    }
  }
  return rulos.sort((a, b) => a.indice - b.indice);
}

export const MAX_REINTENTOS_POR_REQUEST = 6;
/** Un waypoint solo se toca si está a menos de esto del espolón / rulo (si no, no es el culpable); los que siguen al problema pesan la mitad. */
const DISTANCIA_CULPABLE_M = 350;
/** Máximo de waypoints culpables que se tocan por intento. */
const MAX_CULPABLES_POR_INTENTO = 2;

/** Un problema del trozo (U, espolón o rulo) con los puntos que lo localizan, para elegir waypoints culpables. */
export interface Problema {
  tipo: 'u' | 'espolon' | 'rulo';
  /** Puntos propios del problema (un punto, o la sub-polilínea del rulo). */
  ancla: Coord[];
  /** Último punto del problema en el sentido de marcha. */
  fin: Coord;
  /** Posición del problema a lo largo del trozo (índice de vértice): mayor = más adelante. */
  orden: number;
  /** Primer vértice del trozo que abarca el problema (`orden` es el último). */
  desde: number;
}

/**
 * Problemas del trozo (vueltas en U, espolón y rulos) evaluados con los MISMOS detectores y contra el
 * MISMO boceto (entero) que la validación final del tramo; `sInicio` = abscisa del boceto donde arranca
 * el trozo (el boceto puede cruzarse a sí mismo).
 */
export function localizarProblemas(coords: Coord[], boceto: Coord[], sInicio?: number, excluirAbscisas: { desde: number; hasta: number }[] = []): Problema[] {
  const problemas: Problema[] = [];
  for (const u of detectarVueltasU(coords, boceto, 150, 40, sInicio)) problemas.push({ tipo: 'u', ancla: [u.coord], fin: u.coord, orden: u.indice, desde: u.indice });
  const espolon = primerEspolon(coords, boceto);
  if (espolon) problemas.push({ tipo: 'espolon', ancla: [espolon], fin: espolon, orden: Math.max(0, coords.indexOf(espolon)), desde: Math.max(0, coords.indexOf(espolon)) });
  for (const r of detectarRulos(coords, boceto, { sInicio })) {
    const [ia, ib] = [r.indice, Math.min(r.indiceReingreso, coords.length - 1)];
    const ancla = coords.slice(ia, ib + 1);
    problemas.push({ tipo: 'rulo', ancla: ancla.length > 0 ? ancla : [r.salida], fin: coords[ib] ?? r.reingreso, orden: ib, desde: ia });
  }
  if (excluirAbscisas.length === 0 || problemas.length === 0) return problemas;
  // Un problema cuyo recorrido cae ENTERO dentro de una zona excluida (p. ej. una zona que después se re-rutea) no cuenta.
  const sAbs = abscisasSobreBoceto(coords, boceto, sInicio);
  const dentro = (i: number): boolean => excluirAbscisas.some((z) => sAbs[i]! >= z.desde && sAbs[i]! <= z.hasta);
  return problemas.filter((p) => !(dentro(p.desde) && dentro(p.orden)));
}

/**
 * Waypoints intermedios candidatos a "culpables", por cercanía a CADA problema por separado (no a la
 * unión de todos: un segmento imaginario entre problemas lejanos no es parte del trazado). Los 3
 * waypoints que siguen al último problema en el sentido de marcha (mayor `orden`) pesan la mitad:
 * un waypoint con heading que la calle no admite provoca la vuelta ANTES de alcanzarlo.
 */
export function waypointsCulpables(intermedios: Muestra[], problemas: Problema[]): { k: number; d: number }[] {
  if (problemas.length === 0 || intermedios.length === 0) return [];
  const ultimo = problemas.reduce((m, p) => (p.orden > m.orden ? p : m));
  let kFin = 0;
  intermedios.forEach((m, k) => {
    if (distanciaM(m.coord, ultimo.fin) < distanciaM(intermedios[kFin]!.coord, ultimo.fin)) kFin = k;
  });
  return intermedios
    .map((m, k) => {
      const d = Math.min(...problemas.map((p) => distanciaAPolilineaM(m.coord, p.ancla)));
      return { k, d: k >= kFin && k <= kFin + 2 ? d * 0.5 : d };
    })
    .filter((c) => c.d <= DISTANCIA_CULPABLE_M)
    .sort((a, b) => a.d - b.d);
}

/**
 * Ajusta un tramo del boceto a las calles: remuestrea, trocea, llama a Routes y une los trozos.
 *
 * Robustez: con un `heading` que la calle no admite (o un punto del boceto mal puesto), Routes suele
 * "cumplir" el waypoint metiendo un espolón o un rulo alrededor de una manzana. Si el trozo tiene
 * uno, se escalan los waypoints intermedios más cercanos (<= `DISTANCIA_CULPABLE_M`): primero se
 * QUITAN; si el problema persiste, se REPONEN sin `heading`. Hasta `MAX_REINTENTOS_POR_REQUEST`
 * reintentos; gana el intento con menos problemas (y luego el más corto). Lo que quede lo rechaza
 * la validación del tramo (`detectarRulos`), con coordenadas.
 */
export async function trazarPorCalles(
  boceto: Coord[],
  apiKey: string,
  opciones: { pasoM?: number; maxIntermedios?: number; ventanaRumboM?: number; giroSinRumboGrados?: number; log?: (msg: string) => void; omitir?: Coord[]; maxReintentos?: number; excluirAbscisas?: { desde: number; hasta: number }[] } = {},
): Promise<{ coords: Coord[]; requests: number; descartadas: Coord[]; sinRumbo: Coord[] }> {
  const muestras = remuestrear(boceto, opciones.pasoM ?? ESPACIADO_MUESTRAS_M, opciones.ventanaRumboM ?? VENTANA_RUMBO_M, opciones.giroSinRumboGrados ?? GIRO_SIN_RUMBO_GRADOS);
  // Muestras que se saben culpables (heading que la calle no admite): se omiten de entrada (a <= 3 m de la coordenada). Los extremos nunca.
  const omitir = opciones.omitir ?? [];
  const usadas = muestras.filter((m, k) => k === 0 || k === muestras.length - 1 || !omitir.some((c) => distanciaM(c, m.coord) <= 3));
  for (const c of omitir) if (!muestras.some((m, k) => k > 0 && k < muestras.length - 1 && distanciaM(c, m.coord) <= 3)) throw new Error(`trazarPorCalles: la muestra a omitir ${c[1]},${c[0]} no existe en el boceto (a <= 3 m).`);
  const requests = trocear(usadas, opciones.maxIntermedios ?? MAX_INTERMEDIOS);
  const trozos: Coord[][] = [];
  const descartadas: Coord[] = [];
  const sinRumbo: Coord[] = [];
  let llamadas = 0;
  let nRequest = 0;
  for (const original of requests) {
    nRequest++;
    // Cada pedazo se evalúa igual que la validación final del tramo: contra el boceto ENTERO, con la
    // proyección continua arrancando en la abscisa del origen del request (el boceto puede cruzarse).
    const sInicio = original.origen.s;
    /** 0 = intacto, 1 = quitado, 2 = repuesto sin heading. */
    const nivel = original.intermedios.map(() => 0);
    const armar = (): RequestRuta => ({
      ...original,
      intermedios: original.intermedios.flatMap((m, k) => (nivel[k] === 0 ? [m] : nivel[k] === 2 ? [{ coord: m.coord, rumbo: null }] : [])),
    });
    let mejor: Coord[] | null = null;
    let mejorClave: [number, number] = [Infinity, Infinity];
    let mejorNivel = nivel.slice();
    for (let intento = 0; intento <= (opciones.maxReintentos ?? MAX_REINTENTOS_POR_REQUEST); intento++) {
      const { coords } = await calcularRutaGoogle(armar(), apiKey);
      llamadas++;
      const lista = localizarProblemas(coords, boceto, sInicio, opciones.excluirAbscisas);
      const problemas = lista.length;
      const clave: [number, number] = [problemas, longitudM(coords)];
      if (clave[0] < mejorClave[0] || (clave[0] === mejorClave[0] && clave[1] < mejorClave[1])) {
        mejor = coords;
        mejorClave = clave;
        mejorNivel = nivel.slice();
      }
      if (problemas > 0) opciones.log?.(`request ${nRequest} intento ${intento}: ${problemas} problema(s) cerca de ${lista[0]!.ancla[0]![1].toFixed(5)},${lista[0]!.ancla[0]![0].toFixed(5)}; waypoints quitados [${nivel.map((n, k) => (n === 1 ? k : -1)).filter((k) => k >= 0)}] sin heading [${nivel.map((n, k) => (n === 2 ? k : -1)).filter((k) => k >= 0)}]`);
      if (problemas === 0) break;
      // Waypoints originales ordenados por cercanía a cada problema (ver `waypointsCulpables`).
      const candidatos = waypointsCulpables(original.intermedios, lista);
      let tocados = 0;
      for (const c of candidatos) {
        if (tocados >= MAX_CULPABLES_POR_INTENTO) break;
        if (nivel[c.k]! >= 2) continue;
        // Los ya quitados no influyen en el resultado: solo se reponen sin heading si el problema persiste.
        nivel[c.k] = nivel[c.k]! + 1;
        tocados++;
      }
      if (tocados === 0) break;
    }
    mejorNivel.forEach((n, k) => {
      if (n === 1) descartadas.push(original.intermedios[k]!.coord);
      if (n === 2) sinRumbo.push(original.intermedios[k]!.coord);
    });
    trozos.push(mejor!);
  }
  return { coords: unirTrozos(trozos), requests: llamadas, descartadas, sinRumbo };
}

// ============================================================================================
// Zonas ruteadas tramo a tramo (par de vértices consecutivos del boceto) con huecos sin calle
// ============================================================================================

/**
 * Tramo del boceto (par de vértices consecutivos) donde Google no tiene calle transitable: se usa
 * la geometría de la calle real en vez de pedirle una ruta. Índices sobre el boceto principal.
 * `geometria` = vértices INTERMEDIOS de la calle (sin los extremos, que son los vértices del boceto)
 * en el sentido `desde → hasta`; si falta, salto en línea recta entre los dos vértices.
 */
export interface HuecoSinCalle {
  desde: number;
  hasta: number;
  calle: string;
  motivo: string;
  geometria?: Coord[];
}

/** Par de vértices consecutivos de una zona, en el sentido de marcha. `hueco` si ese par no se rutea. */
export interface ParZona {
  indiceA: number;
  indiceB: number;
  a: Coord;
  b: Coord;
  hueco?: HuecoSinCalle;
}

/**
 * Pares consecutivos de los vértices `desde..hasta` (índices del boceto, desde < hasta) en el sentido
 * de marcha: ascendente, o descendente (`invertir`, p. ej. el regreso directo a Salomón Romero). Un par
 * es hueco si coincide (en cualquier sentido) con un `HuecoSinCalle`.
 */
export function paresDeZona(boceto: Coord[], desde: number, hasta: number, invertir: boolean, huecos: HuecoSinCalle[]): ParZona[] {
  if (!(desde < hasta) || desde < 0 || hasta > boceto.length - 1) throw new Error(`paresDeZona: rango ${desde}..${hasta} inválido para un boceto de ${boceto.length} vértices.`);
  for (const h of huecos) {
    if (!(h.desde < h.hasta) || h.desde < desde || h.hasta > hasta || h.hasta - h.desde !== 1) {
      throw new Error(`paresDeZona: hueco ${h.desde}→${h.hasta} (${h.calle}) no es un par consecutivo dentro de ${desde}..${hasta}.`);
    }
  }
  const pares: ParZona[] = [];
  for (let k = desde; k < hasta; k++) {
    const hueco = huecos.find((h) => h.desde === k);
    const [iA, iB] = invertir ? [k + 1, k] : [k, k + 1];
    pares.push({ indiceA: iA, indiceB: iB, a: boceto[iA]!, b: boceto[iB]!, ...(hueco ? { hueco } : {}) });
  }
  return invertir ? pares.reverse() : pares;
}

/** Geometría de un hueco en el sentido del par: extremos del boceto + vértices de la calle (invertidos si el par va hasta→desde). */
export function geometriaDeHueco(par: ParZona): Coord[] {
  const h = par.hueco;
  if (!h) throw new Error('geometriaDeHueco: el par no es un hueco.');
  const inter = h.geometria ?? [];
  const sentidoNormal = par.indiceA === h.desde;
  return [par.a, ...(sentidoNormal ? inter : [...inter].reverse()), par.b];
}

/**
 * Reemplaza en `tramo` la porción entre los puntos más cercanos a `inicioRef` y `finRef` (en ese
 * orden) por `zona`. Los vértices del tramo ANTES del de inicio y DESPUÉS del de fin quedan idénticos.
 * Falla si el vértice de unión del tramo queda a más de `toleranciaM` de la referencia o de la punta
 * de la zona (empalme con salto o con espolón).
 */
export function empalmarZona(tramo: Coord[], zona: Coord[], inicioRef: Coord, finRef: Coord, toleranciaM = 5): { coords: Coord[]; indiceInicio: number; indiceFin: number } {
  const masCercano = (ref: Coord, desde: number): number => {
    let mejor = -1;
    let dMejor = Infinity;
    for (let i = desde; i < tramo.length; i++) {
      const d = distanciaM(tramo[i]!, ref);
      if (d < dMejor) { dMejor = d; mejor = i; }
    }
    return mejor;
  };
  const i = masCercano(inicioRef, 0);
  const j = i < 0 ? -1 : masCercano(finRef, i + 1);
  if (i < 0 || j < 0) throw new Error('empalmarZona: no se encontró el inicio/fin de la zona en el tramo.');
  const dI = distanciaM(tramo[i]!, zona[0]!);
  const dJ = distanciaM(tramo[j]!, zona[zona.length - 1]!);
  if (dI > toleranciaM) throw new Error(`empalmarZona: el inicio de la zona queda a ${dI.toFixed(1)} m del tramo (> ${toleranciaM} m).`);
  if (dJ > toleranciaM) throw new Error(`empalmarZona: el fin de la zona queda a ${dJ.toFixed(1)} m del tramo (> ${toleranciaM} m).`);
  return { coords: [...tramo.slice(0, i), ...zona, ...tramo.slice(j + 1)], indiceInicio: i, indiceFin: j };
}
