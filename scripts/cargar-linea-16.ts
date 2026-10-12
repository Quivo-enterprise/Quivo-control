/**
 * Carga la **línea 16** (sindicato piloto, Sindicato Mixto de Transporte(istas) Tiquipaya) en
 * producción, **hablando SOLO con la API HTTP pública** (nunca con la base: Cloud SQL es de IP
 * privada, no hay proxy desde fuera de la VPC). Mismo patrón que `sembrar-piloto-produccion.ts`:
 * login de admin con credenciales por variable de entorno (fail-closed), 429 con reintento,
 * idempotente por lookups. **Dry-run por defecto**: se autentica y LEE el estado actual, imprime
 * qué requests mandaría (conteo de vértices, no payloads) y NO escribe nada. `--apply` escribe.
 *
 * ## Modelo operativo (dato del CTO, 2026-10-12 — reemplaza al anterior)
 *
 *   1. Todos los vehículos salen de **Salomón Romero** hacia **Honduras**. Honduras = el punto
 *      del KML `RETORNO LINEA 16` (junto al vértice 122 de la línea principal). Es una
 *      identificación del CTO ("creo"): **no confirmada en campo**.
 *   2. En Honduras un despachador ("la control") designa quién vuelve a Salomón Romero y quién
 *      va a Molinos.
 *   3. Designado a Salomón Romero: vuelve directo → la vuelta termina en Salomón Romero.
 *   4. Designado a Molinos: vuelve por la ruta hasta la bifurcación (vértice 43) y sube por el
 *      ramal Putucu hasta Molinos (= Parada Putucu) → la vuelta termina en Molinos.
 *   5. Vuelta siguiente: cada uno baja desde su terminal hacia Honduras; el ciclo se repite.
 *      **Una vuelta = terminal → Honduras → terminal, clasificada por la terminal de llegada.**
 *   - Cupos diarios (todavía NO modelados): lun-vie 4 Salomón Romero + 1 Molinos; sáb 2 + 1;
 *     dom 3 + 1.
 *   - Salidas de la mañana: 7-8 am con 6 min de intervalo, en orden de llegada; luego 7 min;
 *     después a criterio del admin. Turno nocturno desde las 17:01 (ahí se suelen cumplir las
 *     sanciones; si se deben 3 vueltas pueden empezar a las 15:00).
 *   - Alternancia de conductores: **3 días en la línea 120 (troncal) y 1 día en la 16**.
 *   - Fuera de alcance a propósito: los 4 trufis que salen desde el centro de Cochabamba.
 *
 * ## Consecuencia de geometría: UNA ruta asignable que cubre toda la red
 *
 * Un vehículo asignado a la línea 16 puede hacer cualquiera de las dos vueltas el mismo día y
 * una asignación apunta a UNA ruta; por eso la ruta asignable tiene que contener todos los
 * puntos de control. Se carga UNA ruta `sentido 'circuito'` (único valor libre permitido:
 * `sentido` es `string` 1..50) con:
 *
 *     principal[0..150]  todo el dibujo principal (151 vértices): Salomón Romero → … → v92
 *                        (América/Libertador) → El Prado → Honduras (v122) → Aroma → Ayacucho →
 *                        Libertador/América (v150, a pocos metros del v92)
 *   + principal[91..43] invertido: desde ahí, la misma ruta de vuelta hasta la bifurcación
 *                        (49 vértices; se salta el v92 porque v150 ≈ v92)
 *   + conector recto bifurcación → inicio del ramal (~77 m, un solo segmento entre el vértice
 *     43 y el primer vértice del ramal; el KML no trae ese tramo y NO se inventan calles)
 *   + ramal Putucu (13 vértices) hasta Molinos
 *   = 151 + 49 + 13 = 213 vértices (el script lo asevera, y que |v150 − v92| <= 25 m).
 *
 * Aclaración del CTO (2026-10-12): bajando desde Salomón Romero se toma El Prado hasta Honduras;
 * desde Honduras se vuelve por Aroma, se sube por Ayacucho hasta Libertador/América y desde ahí
 * es la misma ruta de regreso (los designados a Molinos suben por el ramal Putucu). Por eso los
 * vértices 123..150 del KML SON el tramo de retorno (un lazo en el centro), no basura. El
 * regreso directo a Salomón Romero (principal 43..0) usa las mismas calles de la ida, ya
 * cubiertas.
 *
 * ## Puntos de control y paradas (todos sobre esa ruta)
 *
 *   PC (radio 150 m como la 120/Z12):
 *     orden 0 Salomón Romero (obligatorio=false) · orden 1 Molinos (Parada Putucu,
 *     obligatorio=false) · orden 2 Honduras (RETORNO, obligatorio=true).
 *   **Por qué solo Honduras es obligatorio y va ÚLTIMO (orden 2):** la detección server-side
 *   `pc_omitido` (`apps/api` ingesta-worker, `infracciones.logic.ts` — único lugar que lee
 *   `obligatorio`; la app móvil no) marca, EN VIVO, los PC obligatorios de `orden` menor que el
 *   cumplido que no se visitaron, y al `fin_recorrido` cualquier obligatorio sin visitar. Toda
 *   vuelta empieza y termina en una terminal, así que las terminales no pueden ser obligatorias
 *   (darían 'omitido' falso en cada vuelta). Honduras con el orden MÁS ALTO nunca es "menor que
 *   el cumplido": la detección en vivo jamás la marca (una vuelta que sale de Molinos no genera
 *   falso positivo) y solo `fin_recorrido` marca una vuelta que se saltó Honduras. Regla neta:
 *   "toda vuelta debe pasar por Honduras". Los pasos por las terminales se registran igual (el
 *   matcheo por radio no depende de `obligatorio`).
 *   ⚠ `orden` acá NO es un orden de recorrido: las vueltas alternan terminales (Salomón →
 *   Honduras → Salomón, o Molinos → Honduras → Molinos, o mezcladas). El conteo de vueltas por
 *   terminal de llegada se implementará del lado del servidor más adelante; hoy los PC solo
 *   sirven para el matcheo por radio.
 *   Paradas (orden alineado con los PC): Salomón Romero (origen, 0), Molinos (destino, 1),
 *   Honduras (intermedia, 2). `tipo` es semántico —terminal de salida, terminal del ramal,
 *   punto intermedio de retorno—; `orden` solo se alinea con los PC. La API no impone
 *   unicidad ni distancia mínima entre paradas de una ruta (solo que cada una esté a <= 100 m
 *   de la geometría: `RUTA_PROXIMIDAD_TOLERANCIA_METROS`), y los PC igual: se valida localmente
 *   ANTES de mandar nada.
 *   Variante de catálogo: UNA, "Molinos (ramal Putucu)", sobre la misma ruta — mismo patrón que
 *   los ramales de la 120 (`variantes` sin geometría, solo etiqueta para el catálogo/mapa
 *   público de la vuelta que termina en Molinos). Cuesta un POST y no condiciona nada más; si no
 *   se quiere, basta quitar `NOMBRE_VARIANTE`.
 *
 * ## ⚠ Calidad de la geometría — LEER ANTES DE USARLA PARA OTRA COSA
 *
 * El KML (`scripts/data/linea-16/linea-16-my-maps.kml`, ver `FUENTE.md`, intacto) es un
 * **boceto dibujado a mano**, no una traza GPS: la línea principal tiene 151 vértices para
 * 18,42 km (salto mediana 105 m, p90 239 m, máximo 580 m). Sirve para el matcheo por radio de
 * los puntos de control, pero **NO sirve** para detectar desvío de ruta ni para dibujar el
 * recorrido con precisión. La detección de desvío debe quedar DESHABILITADA para esta ruta.
 *
 * ## NO se crean asignaciones ni rotaciones (el CTO asigna desde el panel).
 *
 * ## Endpoints usados (todos relativos a `<QUIVO_API_URL>/v1`)
 *
 *   POST /auth/login · GET /sindicatos · GET|POST /lineas · GET|POST /lineas/:id/rutas ·
 *   PATCH /rutas/:id · GET|POST /rutas/:id/puntos-control · PATCH /puntos-control/:id ·
 *   GET|POST /rutas/:id/paradas · PATCH /paradas/:id · GET|POST /rutas/:id/variantes
 *
 * ## Idempotencia (por lookups; los ids los pone el servidor)
 *
 *   Sindicato: por `QUIVO_SINDICATO_ID` o por nombre (`QUIVO_SINDICATO_NOMBRE`, default
 *   "Sindicato Piloto — Producción"); NO se crea. Línea: `codigo '16'` en ese sindicato. Ruta:
 *   `sentido 'circuito'` de la línea (geometría distinta → PATCH). PC: por `orden` entre los
 *   activos (coord/radio/obligatorio distintos → PATCH). Paradas: por `nombre` entre las activas
 *   (tipo/orden/coord distintos → PATCH). Variante: por `nombre`. Lo que sobra: rutas con otro
 *   sentido solo se REPORTA; PC/paradas activos no esperados ABORTAN antes de la primera escritura
 *   (nunca se borra ni desactiva nada). Antes de escribir también se aborta si alguna parada
 *   existente (activa o no) queda a > 100 m de la geometría planeada, si el sindicato no está
 *   'activo' o si el código '16' existe en OTRO sindicato.
 *
 * ## Cómo se corre (nombres de variables; los valores salen de Secret Manager, nunca se imprimen)
 *
 *   La raíz no tiene tsx: usar `packages/db/node_modules/.bin/tsx`. Proyecto GCP: quivo-control-prod.
 *     QUIVO_ADMIN_EMAIL=$(gcloud secrets versions access latest --secret=QUIVO_PANEL_ADMIN_EMAIL --project=quivo-control-prod) \
 *     QUIVO_ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret=SEED_ADMIN_PASSWORD --project=quivo-control-prod) \
 *       packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts            # dry-run (lee, no escribe)
 *   … mismas variables … packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --apply
 *
 *   QUIVO_API_URL es opcional (default: la URL pública de producción de sembrar-piloto; exige
 *   https salvo localhost/127.0.0.1); QUIVO_ADMIN_EMAIL/QUIVO_ADMIN_PASSWORD son obligatorias (el
 *   usuario debe ser admin_quivo); QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE opcionales.
 *
 *   Nota: parseo de KML, helpers geográficos, cliente HTTP y login están duplicados a propósito
 *   con `sembrar-piloto-produccion.ts` / `cargar-linea-120.ts` (scripts standalone; extraer un
 *   `scripts/lib` queda fuera de alcance).
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================================================
// Constantes
// ============================================================================================

const CIUDAD_ID = 'cochabamba';
const NOMBRE_SINDICATO_DEFAULT = 'Sindicato Piloto — Producción';

const LINEA_16_CODIGO = '16';
const LINEA_16_NOMBRE = 'Línea 16';
const COLOR_LINEA = '#B45309'; // ámbar oscuro: distinto de teal/índigo/coral del seed

const SENTIDO_RUTA = 'circuito';
const NOMBRE_VARIANTE = 'Molinos (ramal Putucu)';

/** Mismo valor que la 120 y los PC activos de la Z12. */
const RADIO_TOLERANCIA_M = 150;
/** Tolerancia de `apps/api/src/common/geo/proximidad-ruta.ts` (paradas Y PC a la geometría). */
const PROXIMIDAD_API_M = 100;
/** Tolerancia para comparar coordenadas guardadas vs planeadas en la verificación final. */
const TOLERANCIA_COORD_M = 1;

/** Honduras = punto RETORNO del KML, junto a este vértice de la línea principal (guarda). */
const INDICE_HONDURAS = 122;
/** Vértice de la línea principal donde se bifurca el ramal Putucu (guarda contra el KML). */
const INDICE_BIFURCACION_PUTUCU = 43;
/** Vértice de la ida donde el lazo del retorno vuelve a cruzar (América/Libertador): v150 ≈ v92. */
const INDICE_CRUCE_RETORNO = 92;
const TOLERANCIA_CRUCE_M = 25;
/** Vértices esperados: 151 (0..150) + 49 (91..43) + 13 (ramal). */
const VERTICES_ESPERADOS = 213;

const KML_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/linea-16-my-maps.kml');
const KML_LINEA_PRINCIPAL = 'Línea 1';
const KML_RAMAL_PUTUCU = 'RUTA PUTUCU LINEA 16';
const KML_PARADA_SALOMON = 'PARADA SALOMON ROMERO LINEA 16';
const KML_PARADA_HONDURAS = 'RETORNO LINEA 16';
const KML_PARADA_MOLINOS = 'PARADA PUTUCU LINEA 16';

// ============================================================================================
// Tipos y geometría
// ============================================================================================

type Coord = [number, number]; // [lon, lat]

interface KmlParseado {
  linestrings: Map<string, Coord[]>;
  puntos: Map<string, Coord>;
}

function redondear(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

const RADIO_TIERRA_METROS = 6_371_000;

function haversineMetros(a: Coord, b: Coord): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const sLat = Math.sin(dLat / 2);
  const sLon = Math.sin(dLon / 2);
  const h = sLat * sLat + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * sLon * sLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function indiceMasCercano(coords: Coord[], punto: Coord): { indice: number; distanciaM: number } {
  let mejor = { indice: 0, distanciaM: Infinity };
  coords.forEach((c, i) => {
    const d = haversineMetros(c, punto);
    if (d < mejor.distanciaM) mejor = { indice: i, distanciaM: d };
  });
  return mejor;
}

function longitudKm(coords: Coord[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineMetros(coords[i - 1]!, coords[i]!);
  return total / 1000;
}

/** Distancia mínima (m) de un punto a la polilínea, aproximando localmente a plano (equirectangular). */
function distanciaAGeometriaM(coords: Coord[], p: Coord): number {
  const rad = Math.PI / 180;
  const kx = RADIO_TIERRA_METROS * rad * Math.cos(p[1] * rad);
  const ky = RADIO_TIERRA_METROS * rad;
  let mejor = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1]![0] - p[0]) * kx, ay = (coords[i - 1]![1] - p[1]) * ky;
    const bx = (coords[i]![0] - p[0]) * kx, by = (coords[i]![1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    mejor = Math.min(mejor, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return mejor;
}

// ============================================================================================
// Parser del KML (regex, igual que la 120: sin librería XML en el repo)
// ============================================================================================

function parseCoordinatesTexto(texto: string): Coord[] {
  return texto
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => {
      const partes = tok.split(',');
      const lon = Number(partes[0]);
      const lat = Number(partes[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Coordenada KML inválida: "${tok}"`);
      if (Math.abs(lon) <= 90 && Math.abs(lat) > 90) throw new Error(`Coordenada [${lon}, ${lat}] parece [lat, lon] invertido.`);
      return [redondear(lon), redondear(lat)] as Coord;
    });
}

function parseKml(kmlTexto: string): KmlParseado {
  const linestrings = new Map<string, Coord[]>();
  const puntos = new Map<string, Coord>();
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = placemarkRegex.exec(kmlTexto)) !== null) {
    total++;
    const bloque = match[1]!;
    const nombre = bloque.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? '';
    if (!nombre) throw new Error(`Placemark #${total} del KML sin <name>.`);
    const ls = bloque.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    const pt = bloque.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (ls) {
      const coords = parseCoordinatesTexto(ls[1]!);
      if (coords.length < 2) throw new Error(`Placemark "${nombre}": LineString con menos de 2 vértices.`);
      if (linestrings.has(nombre)) throw new Error(`Placemark "${nombre}" (LineString) duplicado.`);
      linestrings.set(nombre, coords);
    } else if (pt) {
      const coords = parseCoordinatesTexto(pt[1]!);
      if (coords.length !== 1) throw new Error(`Placemark "${nombre}": Point con ${coords.length} coordenadas.`);
      if (puntos.has(nombre)) throw new Error(`Placemark "${nombre}" (Point) duplicado.`);
      puntos.set(nombre, coords[0]!);
    }
  }
  if (total !== 5) {
    throw new Error(`El KML tiene ${total} Placemarks, se esperaban 5 (2 LineString + 3 Point). El archivo cambió: revisar.`);
  }
  return { linestrings, puntos };
}

function requerirLineString(kml: KmlParseado, nombre: string): Coord[] {
  const c = kml.linestrings.get(nombre);
  if (!c) throw new Error(`KML: no se encontró el LineString "${nombre}".`);
  return c;
}

function requerirPunto(kml: KmlParseado, nombre: string): Coord {
  const c = kml.puntos.get(nombre);
  if (!c) throw new Error(`KML: no se encontró el Point "${nombre}".`);
  return c;
}

// ============================================================================================
// CLI y entorno (fail-closed: sin credenciales no se hace nada, ni siquiera el dry-run)
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=… QUIVO_ADMIN_PASSWORD=… [QUIVO_API_URL=…] tsx scripts/cargar-linea-16.ts [--apply]

Sin --apply: dry-run (login + lecturas GET; NO escribe). Con --apply: escribe vía la API.
Opcionales: QUIVO_SINDICATO_ID, QUIVO_SINDICATO_NOMBRE.
`);
  process.exit(0);
}

function normalizarBaseUrl(url: string): string {
  const sinBarraFinal = url.replace(/\/+$/, '');
  const host = new URL(sinBarraFinal).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!sinBarraFinal.startsWith('https://') && !local) {
    console.error(`QUIVO_API_URL debe ser https (salvo localhost/127.0.0.1): "${sinBarraFinal}". Abortando.`);
    process.exit(1);
  }
  return sinBarraFinal.endsWith('/v1') ? sinBarraFinal : `${sinBarraFinal}/v1`;
}

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim().length === 0) {
    console.error(`Falta la variable de entorno ${nombre}. Abortando antes de tocar nada.`);
    process.exit(1);
  }
  return valor;
}

// ============================================================================================
// Cliente HTTP — único punto de contacto con la API. Las lecturas (GET) se ejecutan siempre;
// las escrituras solo con --apply (en dry-run `escribir` solo imprime el plan).
// ============================================================================================

class ErrorApi extends Error {}

const RATE_LIMIT_ESPERA_MS = 60_000;
const RATE_LIMIT_MAX_REINTENTOS = 5;

let API_URL = '';
let accessToken: string | undefined;
let escriturasPlaneadas = 0;
let escriturasEjecutadas = 0;

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function http(metodo: string, ruta: string, body?: unknown): Promise<unknown> {
  for (let intento = 0; ; intento++) {
    const res = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401) {
      await res.body?.cancel();
      throw new ErrorApi(`${metodo} ${ruta} → HTTP 401: credenciales inválidas o token vencido. Abortando (sin reintento).`);
    }
    if (res.status === 429) {
      await res.body?.cancel();
      if (intento >= RATE_LIMIT_MAX_REINTENTOS) {
        throw new ErrorApi(`${metodo} ${ruta} → HTTP 429 (rate limit) tras ${intento} reintento(s). Abortando.`);
      }
      const ra = Number(res.headers.get('retry-after'));
      const esperaMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RATE_LIMIT_ESPERA_MS;
      console.warn(`  429 en ${metodo} ${ruta} — esperando ${Math.round(esperaMs / 1000)}s (intento ${intento + 1}/${RATE_LIMIT_MAX_REINTENTOS})`);
      await esperarMs(esperaMs);
      continue;
    }
    const texto = await res.text();
    let cuerpo: unknown = undefined;
    if (texto.length > 0) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        cuerpo = texto;
      }
    }
    if (!res.ok) {
      const t = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo, null, 2);
      throw new ErrorApi(`${metodo} ${ruta} → HTTP ${res.status}\n${t}`);
    }
    return cuerpo;
  }
}

function leer<T>(ruta: string): Promise<T> {
  return http('GET', ruta) as Promise<T>;
}

/** Resumen del body para el plan: nunca el JSON completo de geometrías. */
function resumirBody(body: unknown): string {
  if (body === undefined || body === null) return '(sin body)';
  const resumen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k === 'geometria' && v && typeof v === 'object' && 'coordinates' in v) {
      resumen[k] = `LineString(${(v as { coordinates: unknown[] }).coordinates.length} vértices)`;
    } else {
      resumen[k] = v;
    }
  }
  return JSON.stringify(resumen);
}

/** Escritura: en dry-run solo imprime; con --apply la manda. Devuelve la respuesta (o undefined). */
async function escribir<T = { id: string }>(metodo: string, ruta: string, body: unknown): Promise<T | undefined> {
  escriturasPlaneadas++;
  if (!APLICAR) {
    console.log(`  SE HARÍA: ${metodo} ${ruta}  body=${resumirBody(body)}`);
    return undefined;
  }
  escriturasEjecutadas++;
  console.log(`  ${metodo} ${ruta}  body=${resumirBody(body)}`);
  return (await http(metodo, ruta, body)) as T;
}

// ============================================================================================
// Tipos de la API (solo los campos que usamos)
// ============================================================================================

interface SindicatoApi { id: string; nombre: string; estado: string }
interface LineaApi { id: string; sindicatoId: string; cityId: string; codigo: string; nombre: string; color: string | null }
interface RutaApi { id: string; lineaId: string; sentido: string; estado: string; geometria: { type: 'LineString'; coordinates: Coord[] } }
interface PuntoControlApi { id: string; rutaId: string; orden: number; coord: { coordinates: Coord }; radioToleranciaM: number; obligatorio: boolean; estado: string }
interface ParadaApi { id: string; rutaId: string; tipo: string; orden: number; nombre: string | null; coord: { coordinates: Coord }; estado: string }
interface VarianteApi { id: string; rutaId: string; nombre: string; estado: string }

const EPS_GRADOS = 1e-6; // ~0,1 m: absorbe el redondeo de ST_AsGeoJSON

function mismaCoord(a: Coord, b: Coord): boolean {
  return Math.abs(a[0] - b[0]) < EPS_GRADOS && Math.abs(a[1] - b[1]) < EPS_GRADOS;
}

function mismaGeometria(a: Coord[], b: Coord[]): boolean {
  return a.length === b.length && a.every((c, i) => mismaCoord(c, b[i]!));
}

// ============================================================================================
// Plan de datos (derivado del KML, puro) — lo que DEBE existir al terminar
// ============================================================================================

interface PuntoPlan { nombre: string; orden: number; coord: Coord; obligatorio: boolean }
interface ParadaPlan { nombre: string; tipo: 'origen' | 'intermedia' | 'destino'; orden: number; coord: Coord }
interface PlanDatos {
  geometria: Coord[];
  puntosControl: PuntoPlan[];
  paradas: ParadaPlan[];
}

/** Construye y valida (aseveraciones) todo lo que se va a cargar. Pura: no toca la red. */
export function construirPlan(kmlTexto: string): PlanDatos {
  const kml = parseKml(kmlTexto);
  const principal = requerirLineString(kml, KML_LINEA_PRINCIPAL);
  const ramal = requerirLineString(kml, KML_RAMAL_PUTUCU);
  const salomon = requerirPunto(kml, KML_PARADA_SALOMON);
  const honduras = requerirPunto(kml, KML_PARADA_HONDURAS);
  const molinos = requerirPunto(kml, KML_PARADA_MOLINOS);

  console.log(`  Línea principal "${KML_LINEA_PRINCIPAL}": ${principal.length} vértices, ${longitudKm(principal).toFixed(2)} km.`);
  console.log(`  Ramal Putucu "${KML_RAMAL_PUTUCU}": ${ramal.length} vértices, ${longitudKm(ramal).toFixed(2)} km.`);

  if (INDICE_HONDURAS > principal.length - 1) throw new Error(`INDICE_HONDURAS=${INDICE_HONDURAS} fuera de rango.`);
  const hond = indiceMasCercano(principal, honduras);
  if (hond.indice !== INDICE_HONDURAS) {
    throw new Error(`RETORNO (Honduras) está junto al vértice ${hond.indice} y se esperaba ${INDICE_HONDURAS}. El KML cambió: revisar.`);
  }
  const bif = indiceMasCercano(principal, ramal[0]!);
  if (bif.indice !== INDICE_BIFURCACION_PUTUCU) {
    throw new Error(`El ramal Putucu empieza junto al vértice ${bif.indice} y se esperaba ${INDICE_BIFURCACION_PUTUCU}. El KML cambió: revisar.`);
  }

  // Guardas del lazo: el último vértice del dibujo (v150) cierra sobre la ida en el v92.
  const ultimo = principal.length - 1;
  const cierre = haversineMetros(principal[ultimo]!, principal[INDICE_CRUCE_RETORNO]!);
  if (cierre > TOLERANCIA_CRUCE_M) {
    throw new Error(`v${ultimo} está a ${cierre.toFixed(1)} m de v${INDICE_CRUCE_RETORNO} (> ${TOLERANCIA_CRUCE_M} m). El KML cambió: revisar.`);
  }
  // Todo el dibujo (0..150) + regreso invertido 91..43 (se salta v92 ≈ v150) +
  // [conector recto 43 → ramal[0]: es el segmento implícito entre estos dos vértices] + ramal.
  const ida = principal;
  const retornoAlRamal = principal.slice(INDICE_BIFURCACION_PUTUCU, INDICE_CRUCE_RETORNO).reverse();
  const geometria: Coord[] = [...ida, ...retornoAlRamal, ...ramal];
  console.log(
    `  Geometría: dibujo completo ${ida.length} + regreso a bifurcación ${retornoAlRamal.length} + ramal ${ramal.length} = ${geometria.length} vértices, ${longitudKm(geometria).toFixed(2)} km.`,
  );
  console.log(`  Cierre del lazo: v${ultimo} a ${cierre.toFixed(1)} m de v${INDICE_CRUCE_RETORNO} (tope ${TOLERANCIA_CRUCE_M} m).`);
  console.log(
    `  Conector recto bifurcación (vértice ${INDICE_BIFURCACION_PUTUCU}) → inicio del ramal: ${haversineMetros(principal[INDICE_BIFURCACION_PUTUCU]!, ramal[0]!).toFixed(0)} m (sin calles inventadas).`,
  );
  if (geometria.length !== VERTICES_ESPERADOS) {
    throw new Error(`La geometría tiene ${geometria.length} vértices y se esperaban ${VERTICES_ESPERADOS}.`);
  }

  const puntosControl: PuntoPlan[] = [
    { nombre: 'Salomón Romero', orden: 0, coord: salomon, obligatorio: false },
    { nombre: 'Molinos (Parada Putucu)', orden: 1, coord: molinos, obligatorio: false },
    { nombre: 'Honduras (RETORNO)', orden: 2, coord: honduras, obligatorio: true },
  ];
  const paradas: ParadaPlan[] = [
    { nombre: 'Salomón Romero', tipo: 'origen', orden: 0, coord: salomon },
    { nombre: 'Molinos', tipo: 'destino', orden: 1, coord: molinos },
    { nombre: 'Honduras', tipo: 'intermedia', orden: 2, coord: honduras },
  ];

  // Mismas reglas que la API (<= 100 m a la geometría), validadas ANTES de mandar nada.
  for (const p of puntosControl) {
    const d = distanciaAGeometriaM(geometria, p.coord);
    console.log(`  PC orden ${p.orden} ${p.nombre}: a ${d.toFixed(1)} m de la geometría.`);
    if (d > PROXIMIDAD_API_M) throw new Error(`PC "${p.nombre}" a ${d.toFixed(1)} m de la geometría (> ${PROXIMIDAD_API_M} m: la API lo rechazaría).`);
  }
  for (const p of paradas) {
    const d = distanciaAGeometriaM(geometria, p.coord);
    if (d > PROXIMIDAD_API_M) throw new Error(`Parada "${p.nombre}" a ${d.toFixed(1)} m de la geometría (> ${PROXIMIDAD_API_M} m: la API la rechazaría).`);
  }
  return { geometria, puntosControl, paradas };
}

// ============================================================================================
// Sincronización contra la API
// ============================================================================================

const PENDIENTE = 'PENDIENTE';

async function login(): Promise<void> {
  console.log('--- Login (POST /v1/auth/login) ---');
  const r = (await http('POST', '/auth/login', { email: requerirEnv('QUIVO_ADMIN_EMAIL'), password: requerirEnv('QUIVO_ADMIN_PASSWORD') })) as {
    accessToken: string;
    user: { email: string; rol: string };
  };
  accessToken = r.accessToken;
  console.log(`  OK — autenticado como ${r.user.email} (rol=${r.user.rol}).`);
  if (r.user.rol !== 'admin_quivo') throw new Error(`El usuario tiene rol "${r.user.rol}"; hace falta admin_quivo (GET /sindicatos y crear líneas lo exigen).`);
}

async function resolverSindicato(): Promise<SindicatoApi> {
  console.log('\n--- Sindicato piloto (GET /v1/sindicatos) ---');
  const todos = await leer<SindicatoApi[]>('/sindicatos');
  const id = process.env.QUIVO_SINDICATO_ID?.trim();
  const nombre = process.env.QUIVO_SINDICATO_NOMBRE?.trim() || NOMBRE_SINDICATO_DEFAULT;
  const candidatos = id ? todos.filter((s) => s.id === id) : todos.filter((s) => s.nombre === nombre);
  if (candidatos.length !== 1) {
    throw new Error(
      `Se esperaba exactamente 1 sindicato (${id ? `id=${id}` : `nombre="${nombre}"`}), hay ${candidatos.length}. ` +
        `Existentes: ${todos.map((s) => `"${s.nombre}"`).join(', ') || '(ninguno)'}. Usar QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE.`,
    );
  }
  if (candidatos[0]!.estado !== 'activo') throw new Error(`El sindicato "${candidatos[0]!.nombre}" está '${candidatos[0]!.estado}', no 'activo'.`);
  console.log(`  "${candidatos[0]!.nombre}" (${candidatos[0]!.id}).`);
  return candidatos[0]!;
}

async function sincronizarLinea(sindicato: SindicatoApi): Promise<string> {
  console.log('\n--- Línea 16 (GET/POST /v1/lineas) ---');
  const todas = await leer<LineaApi[]>('/lineas');
  const otras = todas.filter((l) => l.codigo === LINEA_16_CODIGO && l.sindicatoId !== sindicato.id);
  if (otras.length > 0) throw new Error(`El código '${LINEA_16_CODIGO}' ya existe en OTRO sindicato (${otras.map((l) => l.sindicatoId).join(', ')}). Abortando antes de escribir.`);
  const lineas = todas.filter((l) => l.sindicatoId === sindicato.id && l.codigo === LINEA_16_CODIGO);
  if (lineas.length > 1) throw new Error(`Hay ${lineas.length} líneas con código ${LINEA_16_CODIGO} en el sindicato (el unique lo impide: revisar).`);
  if (lineas[0]) {
    const l = lineas[0];
    console.log(`  Ya existe: ${l.id} ("${l.nombre}", color=${l.color}).`);
    if (l.nombre !== LINEA_16_NOMBRE || l.color !== COLOR_LINEA || l.cityId !== CIUDAD_ID) {
      await escribir('PATCH', `/lineas/${l.id}`, { nombre: LINEA_16_NOMBRE, color: COLOR_LINEA, cityId: CIUDAD_ID });
    }
    return l.id;
  }
  const creada = await escribir<LineaApi>('POST', '/lineas', {
    sindicatoId: sindicato.id,
    cityId: CIUDAD_ID,
    codigo: LINEA_16_CODIGO,
    nombre: LINEA_16_NOMBRE,
    color: COLOR_LINEA,
  });
  return creada?.id ?? PENDIENTE;
}

async function sincronizarRuta(lineaId: string, plan: PlanDatos): Promise<string> {
  console.log(`\n--- Ruta '${SENTIDO_RUTA}' (GET/POST /v1/lineas/:id/rutas) ---`);
  const nueva = { sentido: SENTIDO_RUTA, geometria: { type: 'LineString', coordinates: plan.geometria }, estado: 'activo' };
  if (lineaId === PENDIENTE) {
    await escribir('POST', `/lineas/${PENDIENTE}/rutas`, nueva);
    return PENDIENTE;
  }
  const rutas = await leer<RutaApi[]>(`/lineas/${lineaId}/rutas`);
  for (const r of rutas.filter((x) => x.sentido !== SENTIDO_RUTA)) {
    console.warn(`  AVISO: la línea tiene una ruta '${r.sentido}' (${r.id}, ${r.estado}) que este script no toca — revisar a mano.`);
  }
  const propias = rutas.filter((r) => r.sentido === SENTIDO_RUTA);
  if (propias.length > 1) throw new Error(`Hay ${propias.length} rutas '${SENTIDO_RUTA}' en la línea; ambiguo. Resolver a mano.`);
  const existente = propias[0];
  if (!existente) {
    const creada = await escribir<RutaApi>('POST', `/lineas/${lineaId}/rutas`, nueva);
    return creada?.id ?? PENDIENTE;
  }
  console.log(`  Ya existe: ${existente.id} (${existente.geometria.coordinates.length} vértices, ${existente.estado}).`);
  const patch: Record<string, unknown> = {};
  if (!mismaGeometria(existente.geometria.coordinates, plan.geometria)) patch.geometria = nueva.geometria;
  if (existente.estado !== 'activo') patch.estado = 'activo';
  if (Object.keys(patch).length > 0) await escribir('PATCH', `/rutas/${existente.id}`, patch);
  else console.log('  Sin cambios.');
  return existente.id;
}

async function sincronizarPuntosControl(rutaId: string, plan: PlanDatos): Promise<void> {
  console.log('\n--- Puntos de control (GET/POST /v1/rutas/:id/puntos-control) ---');
  const existentes = rutaId === PENDIENTE ? [] : (await leer<PuntoControlApi[]>(`/rutas/${rutaId}/puntos-control`)).filter((p) => p.estado === 'activo');
  const ordenes = new Set(plan.puntosControl.map((p) => p.orden));
  for (const p of existentes.filter((e) => !ordenes.has(e.orden))) {
    throw new Error(`PC activo orden ${p.orden} (${p.id}) no previsto en la ruta. Abortando; resolver a mano.`);
  }
  for (const p of plan.puntosControl) {
    const cuerpo = { orden: p.orden, coord: { type: 'Point', coordinates: p.coord }, radioToleranciaM: RADIO_TOLERANCIA_M, obligatorio: p.obligatorio, estado: 'activo' };
    const iguales = existentes.filter((e) => e.orden === p.orden);
    if (iguales.length > 1) throw new Error(`Hay ${iguales.length} PC activos con orden ${p.orden} en la ruta; resolver a mano.`);
    const e = iguales[0];
    console.log(`  [${p.orden}] ${p.nombre}:`);
    if (!e) {
      await escribir('POST', `/rutas/${rutaId}/puntos-control`, cuerpo);
    } else if (!mismaCoord(e.coord.coordinates, p.coord) || e.radioToleranciaM !== RADIO_TOLERANCIA_M || e.obligatorio !== p.obligatorio) {
      await escribir('PATCH', `/puntos-control/${e.id}`, cuerpo);
    } else {
      console.log(`    ya existe (${e.id}), sin cambios.`);
    }
  }
}

async function sincronizarParadas(rutaId: string, plan: PlanDatos): Promise<void> {
  console.log('\n--- Paradas (GET/POST /v1/rutas/:id/paradas) ---');
  const existentes = rutaId === PENDIENTE ? [] : (await leer<ParadaApi[]>(`/rutas/${rutaId}/paradas`)).filter((p) => p.estado === 'activo');
  const nombres = new Set(plan.paradas.map((p) => p.nombre));
  for (const p of existentes.filter((e) => !e.nombre || !nombres.has(e.nombre))) {
    throw new Error(`Parada activa "${p.nombre}" (${p.id}) no prevista en la ruta. Abortando; resolver a mano.`);
  }
  for (const p of plan.paradas) {
    const cuerpo = { tipo: p.tipo, orden: p.orden, nombre: p.nombre, coord: { type: 'Point', coordinates: p.coord }, estado: 'activo' };
    const iguales = existentes.filter((e) => e.nombre === p.nombre);
    if (iguales.length > 1) throw new Error(`Hay ${iguales.length} paradas activas "${p.nombre}"; resolver a mano.`);
    const e = iguales[0];
    console.log(`  ${p.nombre} (${p.tipo}, orden ${p.orden}):`);
    if (!e) {
      await escribir('POST', `/rutas/${rutaId}/paradas`, cuerpo);
    } else if (e.tipo !== p.tipo || e.orden !== p.orden || !mismaCoord(e.coord.coordinates, p.coord)) {
      await escribir('PATCH', `/paradas/${e.id}`, cuerpo);
    } else {
      console.log(`    ya existe (${e.id}), sin cambios.`);
    }
  }
}

async function sincronizarVariante(rutaId: string): Promise<void> {
  console.log('\n--- Variante de catálogo (GET/POST /v1/rutas/:id/variantes) ---');
  const existentes = rutaId === PENDIENTE ? [] : (await leer<VarianteApi[]>(`/rutas/${rutaId}/variantes`)).filter((v) => v.nombre === NOMBRE_VARIANTE);
  if (existentes.length > 1) throw new Error(`Hay ${existentes.length} variantes "${NOMBRE_VARIANTE}"; resolver a mano.`);
  const e = existentes[0];
  if (!e) await escribir('POST', `/rutas/${rutaId}/variantes`, { nombre: NOMBRE_VARIANTE, estado: 'activo' });
  else if (e.estado !== 'activo') await escribir('PATCH', `/variantes/${e.id}`, { estado: 'activo' });
  else console.log(`  "${NOMBRE_VARIANTE}" ya existe (${e.id}), sin cambios.`);
}

/** Relee todo desde la API tras --apply y falla si el estado no es el esperado. */
async function verificar(lineaId: string, plan: PlanDatos): Promise<void> {
  console.log('\n--- Verificación final (solo lecturas) ---');
  const rutas = (await leer<RutaApi[]>(`/lineas/${lineaId}/rutas`)).filter((r) => r.sentido === SENTIDO_RUTA && r.estado === 'activo');
  if (rutas.length !== 1) throw new Error(`Se esperaba 1 ruta '${SENTIDO_RUTA}' activa, hay ${rutas.length}.`);
  const ruta = rutas[0]!;
  console.log(`  Ruta ${ruta.id}: ${ruta.geometria.coordinates.length} vértices (esperado ${plan.geometria.length}).`);
  if (!mismaGeometria(ruta.geometria.coordinates, plan.geometria)) throw new Error('La geometría guardada no coincide con la planeada.');

  const pcs = (await leer<PuntoControlApi[]>(`/rutas/${ruta.id}/puntos-control`)).filter((p) => p.estado === 'activo');
  if (pcs.length !== plan.puntosControl.length) throw new Error(`PC activos: ${pcs.length}, esperados ${plan.puntosControl.length}.`);
  for (const esp of plan.puntosControl) {
    const hallados = pcs.filter((p) => p.orden === esp.orden);
    if (hallados.length !== 1) throw new Error(`PC orden ${esp.orden}: ${hallados.length} activos, esperado 1.`);
    const p = hallados[0]!;
    const d = distanciaAGeometriaM(ruta.geometria.coordinates, p.coord.coordinates);
    const dPlan = haversineMetros(p.coord.coordinates, esp.coord);
    console.log(`  PC orden ${p.orden} ${esp.nombre}: radio ${p.radioToleranciaM} m, obligatorio=${p.obligatorio}, a ${d.toFixed(1)} m de la geometría, ${dPlan.toFixed(2)} m del plan.`);
    if (p.obligatorio !== esp.obligatorio || p.radioToleranciaM !== RADIO_TOLERANCIA_M || d > PROXIMIDAD_API_M || dPlan > TOLERANCIA_COORD_M) {
      throw new Error(`PC orden ${p.orden} (${esp.nombre}) no coincide con el plan (coord/radio/obligatorio/distancia).`);
    }
  }
  const pars = (await leer<ParadaApi[]>(`/rutas/${ruta.id}/paradas`)).filter((p) => p.estado === 'activo');
  if (pars.length !== plan.paradas.length) throw new Error(`Paradas activas: ${pars.length}, esperadas ${plan.paradas.length}.`);
  for (const esp of plan.paradas) {
    const hallados = pars.filter((p) => p.nombre === esp.nombre);
    if (hallados.length !== 1) throw new Error(`Parada "${esp.nombre}": ${hallados.length} activas, esperada 1.`);
    const p = hallados[0]!;
    const d = distanciaAGeometriaM(ruta.geometria.coordinates, p.coord.coordinates);
    const dPlan = haversineMetros(p.coord.coordinates, esp.coord);
    console.log(`  Parada ${esp.nombre}: tipo=${p.tipo}, orden=${p.orden}, a ${d.toFixed(1)} m de la geometría, ${dPlan.toFixed(2)} m del plan.`);
    if (p.tipo !== esp.tipo || p.orden !== esp.orden || d > PROXIMIDAD_API_M || dPlan > TOLERANCIA_COORD_M) {
      throw new Error(`Parada "${esp.nombre}" no coincide con el plan (tipo/orden/coord/distancia).`);
    }
  }
  const vars = (await leer<VarianteApi[]>(`/rutas/${ruta.id}/variantes`)).filter((v) => v.nombre === NOMBRE_VARIANTE && v.estado === 'activo');
  if (vars.length !== 1) throw new Error(`Variante "${NOMBRE_VARIANTE}": ${vars.length} activas, esperada 1.`);
  console.log(`  Variante "${NOMBRE_VARIANTE}": 1. OK.`);
}

/**
 * Pre-vuelo de SOLO LECTURA, antes de la primera escritura: si ya existe la línea y su ruta,
 * cada parada existente (activa o no) debe quedar a <= 100 m de la geometría planeada (si no,
 * el PATCH de geometría o las paradas fallarían a medio camino), y no puede haber PC/paradas
 * activos no previstos, duplicados ni rutas ambiguas.
 */
async function preVuelo(sindicato: SindicatoApi, plan: PlanDatos): Promise<void> {
  console.log('\n--- Pre-vuelo (solo lecturas, antes de cualquier escritura) ---');
  const todas = await leer<LineaApi[]>('/lineas');
  const otras = todas.filter((l) => l.codigo === LINEA_16_CODIGO && l.sindicatoId !== sindicato.id);
  if (otras.length > 0) throw new Error(`El código '${LINEA_16_CODIGO}' ya existe en OTRO sindicato (${otras.map((l) => l.sindicatoId).join(', ')}).`);
  const linea = todas.find((l) => l.sindicatoId === sindicato.id && l.codigo === LINEA_16_CODIGO);
  if (!linea) {
    console.log('  La línea 16 no existe todavía: nada más que validar.');
    return;
  }
  const rutas = (await leer<RutaApi[]>(`/lineas/${linea.id}/rutas`)).filter((r) => r.sentido === SENTIDO_RUTA);
  if (rutas.length > 1) throw new Error(`Hay ${rutas.length} rutas '${SENTIDO_RUTA}' en la línea; ambiguo.`);
  const ruta = rutas[0];
  if (!ruta) {
    console.log('  La línea existe sin ruta circuito: nada más que validar.');
    return;
  }
  const paradas = await leer<ParadaApi[]>(`/rutas/${ruta.id}/paradas`);
  for (const pa of paradas) {
    const d = distanciaAGeometriaM(plan.geometria, pa.coord.coordinates);
    if (d > PROXIMIDAD_API_M) throw new Error(`Parada existente "${pa.nombre}" (${pa.id}, ${pa.estado}) a ${d.toFixed(1)} m de la geometría planeada (> ${PROXIMIDAD_API_M} m).`);
  }
  const nombres = new Set(plan.paradas.map((p) => p.nombre));
  const inesperadasPar = paradas.filter((pa) => pa.estado === 'activo' && (!pa.nombre || !nombres.has(pa.nombre)));
  if (inesperadasPar.length > 0) throw new Error(`Paradas activas no previstas: ${inesperadasPar.map((pa) => `"${pa.nombre}" (${pa.id})`).join(', ')}.`);
  const pcs = (await leer<PuntoControlApi[]>(`/rutas/${ruta.id}/puntos-control`)).filter((pc) => pc.estado === 'activo');
  const ordenes = new Set(plan.puntosControl.map((pc) => pc.orden));
  const inesperadosPc = pcs.filter((pc) => !ordenes.has(pc.orden));
  if (inesperadosPc.length > 0) throw new Error(`PC activos no previstos (orden): ${inesperadosPc.map((pc) => `${pc.orden} (${pc.id})`).join(', ')}.`);
  console.log(`  OK: ${paradas.length} parada(s) y ${pcs.length} PC activo(s) existentes, todo compatible con el plan.`);
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL || 'https://quivo-api-741758083365.southamerica-west1.run.app');
  requerirEnv('QUIVO_ADMIN_EMAIL');
  requerirEnv('QUIVO_ADMIN_PASSWORD');

  console.log('='.repeat(90));
  console.log(`Línea 16 — API ${API_URL} — modo: ${APLICAR ? 'APPLY (escribe vía la API)' : 'DRY-RUN (solo lecturas; no escribe nada)'}`);
  console.log('='.repeat(90));

  console.log('\n--- Paso 0: insumos (KML) ---');
  const plan = construirPlan(fs.readFileSync(KML_PATH, 'utf8'));

  try {
    await login();
    const sindicato = await resolverSindicato();
    await preVuelo(sindicato, plan);
    const lineaId = await sincronizarLinea(sindicato);
    const rutaId = await sincronizarRuta(lineaId, plan);
    await sincronizarPuntosControl(rutaId, plan);
    await sincronizarParadas(rutaId, plan);
    await sincronizarVariante(rutaId);

    if (APLICAR) {
      await verificar(lineaId, plan);
      console.log(`\nOK. ${escriturasEjecutadas} escritura(s) ejecutada(s). Sin asignaciones (el CTO asigna desde el panel).`);
    } else {
      console.log(`\nDRY-RUN: ${escriturasPlaneadas} escritura(s) planeada(s), 0 enviadas. Para aplicar: agregar --apply.`);
    }
  } catch (err) {
    console.error('\nAbortado.');
    console.error(err instanceof Error ? err.message : err);
    console.error(`(escrituras ejecutadas antes del error: ${escriturasEjecutadas}; el script es idempotente: re-correr para completar)`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void main();
}
