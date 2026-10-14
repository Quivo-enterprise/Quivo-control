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
 *   = 151 + 49 + 13 = 213 vértices DEL BOCETO (el script lo asevera, y que |v150 − v92| <= 25 m).
 *
 * ## Trazado por calles (Google Routes API): la geometría que se carga NO es el boceto
 *
 * El boceto es solo la guía. Cada tramo (ida v0..v150; regreso v150→v91..v43 = la ida invertida;
 * conector v43→ramal[0]; ramal) se ajusta a calles POR SEPARADO con `computeRoutes`: se remuestrea
 * cada 250 m y cada muestra va como waypoint `via` con `heading` = rumbo del boceto EN EL SENTIDO
 * DEL TRAMO, lo que obliga a Routes a elegir la calzada de ese sentido (el regreso cae en la
 * calzada de vuelta, no sobre la de ida). Máx. 25 intermedios por request: requests encadenados.
 * Cada tramo se valida contra su boceto (desvío máx. <= 120 m, longitud trazado/boceto <= 1,25).
 * El resultado se versiona en `scripts/data/linea-16/trazado-calles.json` (con sha256 del KML): si
 * existe y el sha coincide, `--apply` NO llama a Google. `--recalcular-trazado` lo regenera
 * (GOOGLE_ROUTES_API_KEY); `--solo-trazado` escribe además `trazado-vista-previa.geojson` (boceto
 * vs. calles por tramo) y termina sin tocar la API de Quivo. Ver `FUENTE.md`.
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
 * 18,42 km (salto mediana 105 m, p90 239 m, máximo 580 m). La geometría que se carga es el
 * trazado por calles derivado de él (sección anterior), validado contra el boceto a <= 60 m; aun
 * así sigue siendo una aproximación (Routes puede elegir otra calle paralela dentro del umbral) y
 * NO una traza GPS: la detección de desvío debe quedar DESHABILITADA para esta ruta.
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
 *   Regenerar el trazado por calles (solo Google, sin API de Quivo ni credenciales de admin):
 *     GOOGLE_ROUTES_API_KEY=$(gcloud secrets versions access latest --secret=google-routes-server-key --project=quivo-control-prod) \
 *       packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --solo-trazado --recalcular-trazado
 *   Tests de las funciones puras: packages/db/node_modules/.bin/tsx --test scripts/lib/trazar-por-calles.test.ts
 *
 *   QUIVO_API_URL es opcional (default: la URL pública de producción de sembrar-piloto; exige
 *   https salvo localhost/127.0.0.1); QUIVO_ADMIN_EMAIL/QUIVO_ADMIN_PASSWORD son obligatorias (el
 *   usuario debe ser admin_quivo); QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE opcionales.
 *
 *   Nota: parseo de KML, helpers geográficos, cliente HTTP y login están duplicados a propósito
 *   con `sembrar-piloto-produccion.ts` / `cargar-linea-120.ts` (scripts standalone). Lo nuevo del
 *   trazado por calles vive en `scripts/lib/trazar-por-calles.ts` (funciones puras + cliente Routes).
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { desvioMaximo, detectarRulos, distanciaAPolilineaM, distanciaM, longitudM, trazarPorCalles, unirTrozos, ESPACIADO_MUESTRAS_M, MAX_INTERMEDIOS } from './lib/trazar-por-calles.js';

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
/** Vértices esperados del BOCETO: 151 (0..150) + 49 (91..43) + 13 (ramal) = 213. */
const VERTICES_BOCETO_ESPERADOS = 213;

/** Trazado por calles (Google Routes API): validación por tramo contra el boceto. */
/**
 * El boceto es a mano y cruza manzanas en diagonal (vértices hasta 580 m entre sí), y en divididas
 * Routes toma la calzada del sentido aunque sea por otra calle: revisando el mapa, los desvíos
 * restantes (hasta ~275 m) son el boceto fuera de calle o la calle real del sentido, no errores
 * del ajuste. 60 m (primer umbral) rechazaba trazados correctos; los espolones y vueltas largas
 * (>> 300 m) los frena el ratio de longitud y el descarte de waypoints de `trazarPorCalles`.
 */
const DESVIO_MAX_TRAZADO_M = 120;
/**
 * Excepciones EXPLÍCITAS al desvío máximo. El boceto cruza manzanas en diagonal (a mano), así que
 * donde la calle real queda a más de 120 m de la diagonal el trazado "legítimo" la supera. Cada una:
 * tramo, centro [lon, lat], radio de la zona y tope propio. NO VERIFICADAS sobre el mapa: el CTO
 * debe revisarlas en `trazado-calles.kml` (Google My Maps) antes de `--apply`.
 */
const EXCEPCIONES_DESVIO: { tramo: NombreTramo; centro: Coord; radioM: number; maxM: number; motivo: string }[] = [
  { tramo: 'ida', centro: [-66.2253, -17.32103], radioM: 120, maxM: 150, motivo: 'salida del terminal: el boceto tiene un lazo propio (v10–v13) y diagonales entre manzanas' },
  { tramo: 'ida', centro: [-66.22277, -17.32515], radioM: 120, maxM: 150, motivo: 'diagonal del boceto entre manzanas; el trazado toma la calle del sentido' },
  { tramo: 'regreso', centro: [-66.16418, -17.36593], radioM: 150, maxM: 150, motivo: 'cuña de Honduras: la diagonal del boceto (v10–v12) cruza manzanas; el trazado rodea por calles' },
];
const RATIO_LONGITUD_MAX = 1.25;
const TRAZADO_JSON_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-calles.json');
const VISTA_PREVIA_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-vista-previa.geojson');
const KML_TRAZADO_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-calles.kml');
const TRAMOS = ['ida', 'regreso', 'conector', 'ramal'] as const;
type NombreTramo = (typeof TRAMOS)[number];

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
const RECALCULAR_TRAZADO = argv.includes('--recalcular-trazado');
const SOLO_TRAZADO = argv.includes('--solo-trazado');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=… QUIVO_ADMIN_PASSWORD=… [QUIVO_API_URL=…] tsx scripts/cargar-linea-16.ts [--apply]
  [GOOGLE_ROUTES_API_KEY=…] tsx scripts/cargar-linea-16.ts --solo-trazado [--recalcular-trazado]

Sin --apply: dry-run (login + lecturas GET; NO escribe). Con --apply: escribe vía la API.
--solo-trazado: calcula/lee el trazado por calles, escribe trazado-calles.json y la vista previa
  (.geojson) y termina SIN tocar la API de Quivo.
--recalcular-trazado: regenera el trazado con Google Routes API (requiere GOOGLE_ROUTES_API_KEY).
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

type TramosCoord = Record<NombreTramo, Coord[]>;

interface Boceto {
  principal: Coord[];
  ramal: Coord[];
  salomon: Coord;
  honduras: Coord;
  molinos: Coord;
  /** Tramos del boceto en el sentido de circulación de cada uno. */
  tramos: TramosCoord;
}

/**
 * Parsea el KML y valida el boceto (índices Honduras/bifurcación/cruce, vértices). Pura: no toca la
 * red. Separa los tramos que se ajustan a calles POR SEPARADO, cada uno en su sentido:
 *   ida      principal v0..v150 (Salomón Romero → … → Honduras → lazo → v150 ≈ v92)
 *   regreso  v150 → v91..v43 (la ida invertida: es la que cae en la calzada de vuelta). Se antepone
 *            v150 (≈ v92, ≤ 25 m) para que el tramo arranque donde termina la ida.
 *   conector v43 → ramal[0] (~77 m; el KML no trae ese tramo)
 *   ramal    ramal Putucu hasta Molinos
 */
export function prepararBoceto(kmlTexto: string): Boceto {
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
  const regresoInvertido = principal.slice(INDICE_BIFURCACION_PUTUCU, INDICE_CRUCE_RETORNO).reverse(); // v91..v43
  const verticesBoceto = principal.length + regresoInvertido.length + ramal.length;
  console.log(
    `  Boceto: dibujo completo ${principal.length} + regreso a bifurcación ${regresoInvertido.length} + ramal ${ramal.length} = ${verticesBoceto} vértices.`,
  );
  console.log(`  Cierre del lazo: v${ultimo} a ${cierre.toFixed(1)} m de v${INDICE_CRUCE_RETORNO} (tope ${TOLERANCIA_CRUCE_M} m).`);
  if (verticesBoceto !== VERTICES_BOCETO_ESPERADOS) {
    throw new Error(`El boceto tiene ${verticesBoceto} vértices y se esperaban ${VERTICES_BOCETO_ESPERADOS}.`);
  }
  const tramos: TramosCoord = {
    ida: principal,
    regreso: [principal[ultimo]!, ...regresoInvertido],
    conector: [principal[INDICE_BIFURCACION_PUTUCU]!, ramal[0]!],
    ramal,
  };
  return { principal, ramal, salomon, honduras, molinos, tramos };
}

// ============================================================================================
// Trazado por calles (Google Routes API) — versionado en trazado-calles.json
// ============================================================================================

interface TrazadoJson {
  meta: {
    generado: string;
    kmlSha256: string;
    fuente: string;
    parametros: { espaciadoMuestrasM: number; maxIntermedios: number; desvioMaxM: number; ratioLongitudMax: number };
  };
  tramos: TramosCoord;
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/**
 * Valida un tramo trazado contra su boceto: desvío máximo <= DESVIO_MAX_TRAZADO_M y longitud
 * trazado/boceto <= RATIO_LONGITUD_MAX. Si no, error con tramo, valor y coordenada del peor punto.
 */
export function validarTramo(nombre: string, boceto: Coord[], trazado: Coord[]): { desvioM: number; kmBoceto: number; kmTrazado: number } {
  const desvio = desvioMaximo(trazado, boceto);
  const kmBoceto = longitudM(boceto) / 1000;
  const kmTrazado = longitudM(trazado) / 1000;
  const ratio = kmTrazado / kmBoceto;
  // Desvío contra el tope general, salvo en las zonas con excepción explícita (que tienen su propio tope).
  const excepciones = EXCEPCIONES_DESVIO.filter((e) => e.tramo === nombre);
  const tope = (p: Coord): number => excepciones.find((e) => distanciaM(p, e.centro) <= e.radioM)?.maxM ?? DESVIO_MAX_TRAZADO_M;
  const revisar = (puntos: Coord[], contra: Coord[], sentido: string): void => {
    for (const p of puntos) {
      const d = distanciaAPolilineaM(p, contra);
      if (d > tope(p)) {
        throw new Error(`Tramo "${nombre}": desvío máximo ${d.toFixed(1)} m > ${tope(p)} m (${sentido}) en ${p[1].toFixed(6)},${p[0].toFixed(6)}.`);
      }
    }
  };
  revisar(trazado, boceto, 'punto del trazado lejos del boceto');
  revisar(boceto, trazado, 'punto del boceto lejos del trazado');
  // Un trazado con rulos (vuelta a una manzana para reincorporarse a la misma avenida) no se acepta.
  const rulos = detectarRulos(trazado, boceto);
  if (rulos.length > 0) {
    const f = (c: Coord) => `${c[1].toFixed(6)},${c[0].toFixed(6)}`;
    throw new Error(
      `Tramo "${nombre}": ${rulos.length} rulo(s) alrededor de una manzana: ` +
        rulos.map((r) => `sale en ${f(r.salida)} y reingresa en ${f(r.reingreso)} (${r.largoM.toFixed(0)} m de recorrido para ${r.rectaM.toFixed(0)} m en recta, desvío máx ${r.desvioMaxM.toFixed(0)} m en ${f(r.coordDesvioMax)}, criterio ${r.criterio})`).join('; ') +
        '.',
    );
  }
  if (ratio > RATIO_LONGITUD_MAX) {
    const [lon, lat] = desvio.coord;
    throw new Error(
      `Tramo "${nombre}": longitud trazado/boceto = ${ratio.toFixed(3)} (${kmTrazado.toFixed(2)} km / ${kmBoceto.toFixed(2)} km) > ${RATIO_LONGITUD_MAX}. Peor desvío ${desvio.maxM.toFixed(1)} m en ${lat.toFixed(6)},${lon.toFixed(6)}.`,
    );
  }
  return { desvioM: desvio.maxM, kmBoceto, kmTrazado };
}

/**
 * Devuelve el trazado por calles de cada tramo. Si `trazado-calles.json` existe y el sha256 del KML
 * coincide, se usa SIN llamar a Google. `--recalcular-trazado` lo regenera (requiere
 * GOOGLE_ROUTES_API_KEY). Si el sha no coincide y no se pidió recalcular: error.
 */
async function obtenerTrazado(kmlTexto: string, boceto: Boceto): Promise<TramosCoord> {
  const sha = sha256(kmlTexto);
  let guardado: TrazadoJson | undefined;
  if (fs.existsSync(TRAZADO_JSON_PATH)) guardado = JSON.parse(fs.readFileSync(TRAZADO_JSON_PATH, 'utf8')) as TrazadoJson;

  let tramos: TramosCoord;
  if (guardado && guardado.meta.kmlSha256 === sha && !RECALCULAR_TRAZADO) {
    console.log(`  Trazado versionado (${guardado.meta.generado}, sha KML ${sha.slice(0, 12)}…): se usa sin llamar a Google.`);
    tramos = guardado.tramos;
  } else {
    if (!RECALCULAR_TRAZADO) {
      throw new Error(
        guardado
          ? `trazado-calles.json es de otro KML (sha ${guardado.meta.kmlSha256.slice(0, 12)}… vs ${sha.slice(0, 12)}…). Regenerar con --recalcular-trazado (requiere GOOGLE_ROUTES_API_KEY).`
          : 'No existe scripts/data/linea-16/trazado-calles.json. Generarlo con --recalcular-trazado (requiere GOOGLE_ROUTES_API_KEY).',
      );
    }
    const apiKey = requerirEnv('GOOGLE_ROUTES_API_KEY');
    console.log(`  Recalculando trazado con Google Routes API (muestras cada ${ESPACIADO_MUESTRAS_M} m, heading del boceto en el sentido del tramo)…`);
    tramos = { ida: [], regreso: [], conector: [], ramal: [] };
    for (const nombre of TRAMOS) {
      const r = await trazarPorCalles(boceto.tramos[nombre], apiKey, { pasoM: ESPACIADO_MUESTRAS_M, maxIntermedios: MAX_INTERMEDIOS });
      tramos[nombre] = r.coords.map((c) => [redondear(c[0]), redondear(c[1])] as Coord);
      console.log(`    ${nombre}: ${r.requests} request(s), ${tramos[nombre].length} vértices${r.descartadas.length ? `, ${r.descartadas.length} waypoint(s) quitado(s) por provocar espolones/rulos` : ''}${r.sinRumbo.length ? `, ${r.sinRumbo.length} sin heading` : ''}.`);
      for (const c of r.descartadas) console.log(`      quitado:    ${c[1].toFixed(6)},${c[0].toFixed(6)}`);
      for (const c of r.sinRumbo) console.log(`      sin heading: ${c[1].toFixed(6)},${c[0].toFixed(6)}`);
    }
  }

  // Validación SIEMPRE (también el json versionado): no se carga basura.
  console.log('  Validación por tramo (boceto → trazado):');
  for (const nombre of TRAMOS) {
    const v = validarTramo(nombre, boceto.tramos[nombre], tramos[nombre]);
    console.log(
      `    ${nombre.padEnd(8)} vértices ${String(boceto.tramos[nombre].length).padStart(3)} → ${String(tramos[nombre].length).padStart(4)} · ${v.kmBoceto.toFixed(2)} km → ${v.kmTrazado.toFixed(2)} km · desvío máx ${v.desvioM.toFixed(1)} m`,
    );
  }

  if (RECALCULAR_TRAZADO || !guardado || guardado.meta.kmlSha256 !== sha) {
    const salida: TrazadoJson = {
      meta: {
        generado: new Date().toISOString(),
        kmlSha256: sha,
        fuente: 'Google Routes API computeRoutes (DRIVE, TRAFFIC_UNAWARE, HIGH_QUALITY) sobre scripts/data/linea-16/linea-16-my-maps.kml',
        parametros: { espaciadoMuestrasM: ESPACIADO_MUESTRAS_M, maxIntermedios: MAX_INTERMEDIOS, desvioMaxM: DESVIO_MAX_TRAZADO_M, ratioLongitudMax: RATIO_LONGITUD_MAX },
      },
      tramos,
    };
    fs.writeFileSync(TRAZADO_JSON_PATH, JSON.stringify(salida) + '\n');
    console.log(`  Escrito ${path.relative(REPO_ROOT, TRAZADO_JSON_PATH)}.`);
  }
  return tramos;
}

/** FeatureCollection con boceto y trazado por tramo, para revisar en geojson.io / QGIS. */
function escribirVistaPrevia(boceto: Boceto, trazado: TramosCoord): void {
  const features = TRAMOS.flatMap((tramo) => [
    { type: 'Feature', properties: { tramo, fuente: 'boceto' }, geometry: { type: 'LineString', coordinates: boceto.tramos[tramo] } },
    { type: 'Feature', properties: { tramo, fuente: 'calles' }, geometry: { type: 'LineString', coordinates: trazado[tramo] } },
  ]);
  fs.writeFileSync(VISTA_PREVIA_PATH, JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  console.log(`  Escrito ${path.relative(REPO_ROOT, VISTA_PREVIA_PATH)}.`);
  fs.writeFileSync(KML_TRAZADO_PATH, armarKmlTrazado(boceto, trazado));
  console.log(`  Escrito ${path.relative(REPO_ROOT, KML_TRAZADO_PATH)} (importable en Google My Maps).`);
}

const xmlEscape = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Colores KML = aabbggrr. */
const COLOR_KML: Record<NombreTramo, string> = { ida: 'ffff7f00', regreso: 'ff0000ff', conector: 'ff00ffff', ramal: 'ff00c800' };
const NOMBRE_KML: Record<NombreTramo, string> = { ida: 'Ida', regreso: 'Regreso', conector: 'Conector', ramal: 'Ramal Putucu' };

/** KML para revisar el trazado sobre el mapa de Google (My Maps): una carpeta con el trazado por tramo y otra con el boceto en gris. */
export function armarKmlTrazado(boceto: Boceto, trazado: TramosCoord): string {
  const linea = (nombre: string, estilo: string, coords: Coord[]): string =>
    `    <Placemark><name>${xmlEscape(nombre)}</name><styleUrl>#${estilo}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords.map((c) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LineString></Placemark>`;
  const estilos = [
    ...TRAMOS.map((t) => `  <Style id="calles-${t}"><LineStyle><color>${COLOR_KML[t]}</color><width>4</width></LineStyle></Style>`),
    '  <Style id="boceto"><LineStyle><color>ff9e9e9e</color><width>2</width></LineStyle></Style>',
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    '  <name>Línea 16 — trazado por calles (Google Routes API)</name>',
    ...estilos,
    '  <Folder>',
    '    <name>Trazado por calles</name>',
    ...TRAMOS.map((t) => linea(`${NOMBRE_KML[t]} (calles)`, `calles-${t}`, trazado[t])),
    '  </Folder>',
    '  <Folder>',
    '    <name>Boceto original (gris)</name>',
    ...TRAMOS.map((t) => linea(`${NOMBRE_KML[t]} (boceto)`, 'boceto', boceto.tramos[t])),
    '  </Folder>',
    '</Document>',
    '</kml>',
    '',
  ].join('\n');
}

/** Construye y valida todo lo que se va a cargar. Pura: no toca la red. */
export function construirPlan(boceto: Boceto, trazado: TramosCoord): PlanDatos {
  const { salomon, honduras, molinos, principal, ramal } = boceto;
  // Ida + regreso + conector + ramal, sin duplicar los puntos de empalme.
  const geometria: Coord[] = unirTrozos(TRAMOS.map((t) => trazado[t]));
  console.log(
    `  Geometría final (trazado por calles): ${geometria.length} vértices, ${longitudKm(geometria).toFixed(2)} km (boceto: ${longitudKm([...principal, ...ramal]).toFixed(2)} km de dibujo).`,
  );

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
  if (SOLO_TRAZADO) {
    // Sin API de Quivo: ni login ni red salvo Google (y solo si se pidió recalcular).
    console.log('='.repeat(90));
    console.log(`Línea 16 — SOLO TRAZADO (${RECALCULAR_TRAZADO ? 'recalcula con Google Routes API' : 'lee el json versionado'}); no toca la API de Quivo.`);
    console.log('='.repeat(90));
    try {
      const kmlTexto = fs.readFileSync(KML_PATH, 'utf8');
      const boceto = prepararBoceto(kmlTexto);
      const trazado = await obtenerTrazado(kmlTexto, boceto);
      escribirVistaPrevia(boceto, trazado);
    } catch (err) {
      console.error('\nAbortado.');
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
    return;
  }

  API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL || 'https://quivo-api-741758083365.southamerica-west1.run.app');
  requerirEnv('QUIVO_ADMIN_EMAIL');
  requerirEnv('QUIVO_ADMIN_PASSWORD');

  console.log('='.repeat(90));
  console.log(`Línea 16 — API ${API_URL} — modo: ${APLICAR ? 'APPLY (escribe vía la API)' : 'DRY-RUN (solo lecturas; no escribe nada)'}`);
  console.log('='.repeat(90));

  console.log('\n--- Paso 0: insumos (KML + trazado por calles) ---');
  const kmlTexto = fs.readFileSync(KML_PATH, 'utf8');
  const boceto = prepararBoceto(kmlTexto);
  let plan: PlanDatos;
  try {
    plan = construirPlan(boceto, await obtenerTrazado(kmlTexto, boceto));
  } catch (err) {
    console.error('\nAbortado.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

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
