/**
 * Crea el **piloto de la línea 16 con 3 trufis** en el sindicato piloto de producción, **hablando
 * SOLO con la API HTTP pública** (nunca con la base: Cloud SQL es de IP privada). Mismo patrón que
 * `sembrar-piloto-produccion.ts` / `cargar-linea-16.ts`: login de admin por variables de entorno
 * (fail-closed), 401 aborta, 429 con reintento, idempotente por lookups (los ids los pone el
 * servidor), pre-vuelo de SOLO LECTURA que aborta antes de la primera escritura si el estado es
 * inesperado, y verificación final de solo lectura. **Dry-run por defecto**: login + GETs, imprime
 * las escrituras que haría y NO escribe nada. `--apply` escribe.
 *
 * ## ⚠ ADVERTENCIA — LEER ANTES DE GENERAR OTRAS ROTACIONES
 *
 * Mientras los vehículos `1616PIL`/`1616PIB`/`1616PIC` y sus conductores estén ACTIVOS, cualquier
 * `POST /rotaciones` (generar) que se lance desde el panel para este sindicato los incluirá en el
 * reparto round-robin. Al terminar el piloto (2026-10-26) —o antes de generar otras rotaciones— correr:
 *     tsx scripts/crear-piloto-linea-16.ts --desactivar --apply
 * (deja inactivos los 3 vehículos, los 3 conductores y el socio placeholder).
 *
 * Nota: cliente HTTP y login están duplicados a propósito con los otros scripts standalone de
 * `scripts/`. Las funciones PURAS (hoy en La Paz, plan de faltantes, decisión de anular, fusión del
 * archivo de credenciales) viven en `scripts/lib/piloto-linea-16.ts` con tests `node:test`.
 *
 * ## Qué crea (todo en el sindicato "Sindicato Piloto — Producción")
 *
 *   0. Un **socio** placeholder (propietario de los 3 vehículos).
 *   1. Tres **vehículos** `1616PIL`, `1616PIB`, `1616PIC` (placa PTA válida: 4 dígitos + 3 letras),
 *      `estado` activo. El esquema exige tipo/marca/modelo/color/capacidad; NO se inventan datos
 *      reales: tipo `otro` (exige admin_quivo, que es quien corre esto), marca `Piloto`, modelo
 *      `Linea 16 piloto`, color `otro`, capacidad 12 (placeholder, NO un dato del vehículo). Socio
 *      propietario placeholder "Socio Piloto Línea Dieciséis" (CI `9000116 CB`): la API exige socio
 *      para activar un vehículo. Cuando haya móviles reales, editar esos campos desde el panel.
 *   2. Tres **conductores** (CI sintéticos, nombres sin dígitos: `NombrePersonaSchema` los rechaza):
 *        1616PIL  "Piloto Línea Dieciséis"          CI 9000016 CB  LIC-9000016   (el piloto original)
 *        1616PIB  "Piloto Línea Dieciséis Bravo"    CI 9000017 CB  LIC-9000017
 *        1616PIC  "Piloto Línea Dieciséis Charlie"  CI 9000018 CB  LIC-9000018
 *   3. **Credencial móvil**: el login vigente es de UN paso (`POST /mobile/auth/sesion`): placa +
 *      **PIN del CONDUCTOR** (+ deviceId). Por default solo se fija el PIN del conductor
 *      (`PUT /mobile/credenciales/conductores/:id`); el PIN del vehículo (solo login LEGADO) se fija
 *      con `--pin-vehiculo` y solo para 1616PIL. Los PIN de conductores NUEVOS se generan con
 *      node:crypto y se escriben SOLO al archivo `QUIVO_PILOTO16_CREDS_FILE` (0600, fuera del repo),
 *      NUNCA por stdout. Si no hay archivo y hay que fijar algún PIN generado, se aborta ANTES de escribir.
 *   4. Una **rotación** (periodo `piloto-linea-16`) con una asignación por día por piloto, horario
 *      `manana`, la ruta `circuito` de la línea 16, hasta `QUIVO_PILOTO16_HASTA` (default 2026-10-26).
 *      Rango del piloto 1: `QUIVO_PILOTO16_DESDE` (default 2026-10-13). Rango de los NUEVOS:
 *      `QUIVO_PILOTO16_DESDE_NUEVOS` (default = HOY en America/La_Paz, no se crean días pasados).
 *      Queda **publicada** (el login exige rotación publicada); `horaSalida`/`horaPresentacion` null.
 *
 * ## Agregar pilotos a una rotación YA PUBLICADA: anular → agregar → publicar
 *
 * `POST /rotaciones/:id/asignaciones` exige rotación en `borrador` (rotaciones.service.ts,
 * `asegurarRotacionEditable`). Para sumar asignaciones a la publicada el script hace
 * `POST /rotaciones/:id/anular` (vuelve a borrador) → `POST .../asignaciones` por cada faltante →
 * `POST .../publicar`. Mientras está en borrador el LOGIN MÓVIL NUEVO falla (el login exige rotación
 * publicada). Una sesión YA abierta no se corta: ni el guard de sesión ni `refresh()` ni el sync
 * miran la rotación (ver `auth-movil.guard.ts` y `auth-movil.service.ts: refresh`). Condiciones:
 *   - Solo si hay asignaciones FALTANTES y las existentes coinciden con el plan. Si difieren: se
 *     informa y se aborta SIN anular. Nunca se modifica ni se borra una asignación existente.
 *   - Socio, vehículos, conductores y PIN se crean ANTES de anular: la ventana sin login es solo
 *     los POST de asignaciones + publicar.
 *   - Pre-vuelo: `GET /reportes/en-vivo` (en-vivo.controller.ts, solo lectura). Si hay una sesión
 *     activa (`activa` y `estadoFrescura` reportando/detenido) en alguno de los 3 vehículos, se
 *     aborta antes de anular, salvo `--forzar-anular` (aun así la sesión abierta no se corta; el
 *     riesgo es que un re-login/cambio de dispositivo falle durante la ventana).
 *   - `publicar` se reintenta 3 veces con backoff. Si igual falla: mensaje MUY visible con el
 *     comando exacto para re-correr y exit 1. Si falla un POST de asignación, igual se intenta
 *     publicar lo que haya para no dejar el login caído. Re-correr con la rotación propia en
 *     borrador completa lo que falte y publica (idempotente).
 *
 * ## Por qué `POST /rotaciones` (generar) y qué riesgo tiene (solo si la rotación NO existe)
 *
 * La API NO permite crear una rotación vacía: `POST /rotaciones` es `generar()` y SIEMPRE reparte
 * round-robin entre TODOS los vehículos activos del sindicato. Se usa con UNA fecha, UN horario y UNA
 * ruta (= 1 asignación) y se espera `1616PIL`; para eso en la primera corrida se crea/activa SOLO
 * el piloto 1 antes de generar, y los otros dos después. Si `generar` devuelve algo distinto de
 * exactamente 1 asignación de `1616PIL`, se BORRAN las que creó (es borrador, sin sesiones), se
 * verifica por GET y se aborta sin publicar. El conductor que le pone (el primero por nombre) se
 * corrige con `PATCH`. Es una rotación NUEVA y separada de la del piloto de 6 vehículos.
 *
 * ## Idempotencia (por lookups)
 *
 *   Socio: por CI dentro del sindicato. Sindicato: `QUIVO_SINDICATO_ID` o nombre (`QUIVO_SINDICATO_NOMBRE`,
 *   default "Sindicato Piloto — Producción"). Línea: código '16' + única ruta `circuito` activa.
 *   Vehículo: por placa normalizada. Conductor: por CI dentro del sindicato. Rotación: por `periodo`.
 *   Asignaciones: por (vehículo, fecha, horario). Re-correr con todo ya creado = 0 escrituras. Los PIN
 *   NO se regeneran si el conductor ya existía, salvo `--reset-credenciales` (afecta a los 3; rotar un
 *   PIN revoca sus sesiones activas). La API no expone si un conductor tiene PIN: si una corrida murió
 *   entre crear el conductor y fijar su PIN, usar `--reset-credenciales`.
 *
 * ## Cómo se corre (nombres de variables; los valores salen de Secret Manager, nunca se imprimen)
 *
 *   La raíz no tiene tsx: usar `packages/db/node_modules/.bin/tsx`. Proyecto GCP: quivo-control-prod.
 *     export QUIVO_ADMIN_EMAIL="$(gcloud secrets versions access latest --secret=QUIVO_PANEL_ADMIN_EMAIL --project=quivo-control-prod)"
 *     export QUIVO_ADMIN_PASSWORD="$(gcloud secrets versions access latest --secret=SEED_ADMIN_PASSWORD --project=quivo-control-prod)"
 *     export QUIVO_PILOTO16_CREDS_FILE="$HOME/.quivo-piloto16-creds"          # FUERA del repo
 *     packages/db/node_modules/.bin/tsx scripts/crear-piloto-linea-16.ts            # dry-run
 *     packages/db/node_modules/.bin/tsx scripts/crear-piloto-linea-16.ts --apply    # escribe
 *
 *   Requiere que la línea 16 ya esté cargada (`scripts/cargar-linea-16.ts --apply`): en dry-run se
 *   avisa y se sigue; con `--apply` se aborta antes de escribir.
 *
 * Variables de entorno:
 *   QUIVO_API_URL              Opcional (default: API de producción; https salvo localhost/127.0.0.1).
 *   QUIVO_ADMIN_EMAIL / QUIVO_ADMIN_PASSWORD   Obligatorias (usuario admin_quivo). Nunca se imprimen.
 *   QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE   Opcionales.
 *   QUIVO_PILOTO16_PIN         Opcional, SOLO para el conductor de 1616PIL (6-12 dígitos). Si falta, se genera.
 *   QUIVO_PILOTO16_VEHICULO_PIN  Opcional, solo con --pin-vehiculo (1616PIL). Si falta, se genera.
 *   QUIVO_PILOTO16_CREDS_FILE  Ruta ABSOLUTA fuera del repo (modo 0600) con los PIN. Se FUSIONA con lo
 *                              existente sin pisar; formato `PLACA | Conductor | pin=NNNNNNNN`.
 *   QUIVO_PILOTO16_DESDE       Opcional, YYYY-MM-DD, rango del piloto 1 (default 2026-10-13).
 *   QUIVO_PILOTO16_DESDE_NUEVOS  Opcional, rango de los pilotos nuevos (default: hoy en La Paz).
 *   QUIVO_PILOTO16_HASTA       Opcional, YYYY-MM-DD (default 2026-10-26).
 */

import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decidirAnular,
  fusionarCreds,
  hoyLaPaz,
  planearRotacion,
  rangoFechas,
  sesionesBloqueantes,
  type AccionRotacion,
  type PlanRotacion,
  type SesionEnVivoLike,
} from './lib/piloto-linea-16.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================================================
// Constantes del piloto
// ============================================================================================

const NOMBRE_SINDICATO_DEFAULT = 'Sindicato Piloto — Producción';
const LINEA_CODIGO = '16';
const SENTIDO_RUTA = 'circuito';

const VEHICULO = {
  tipo: 'otro',
  marca: 'Piloto',
  modelo: 'Linea 16 piloto',
  color: 'otro',
  colorSecundario: null,
  capacidad: 12,
} as const;

/** Socio propietario placeholder: la API EXIGE un socio para activar un vehículo ("No se puede
 * activar el vehículo. Revisa: socio propietario"). CI sintético distinto al de los conductores. */
const SOCIO = {
  nombre: 'Socio Piloto Línea Dieciséis',
  documentoIdentidad: '9000116 CB',
} as const;

interface PilotoDef {
  placa: string;
  conductor: { nombre: string; documentoIdentidad: string; licenciaConducir: string };
  /** true = piloto agregado después (rango por defecto: desde HOY, no días pasados). */
  nuevo: boolean;
}

/** El primero es el piloto original (sin cambios). El orden importa: se crea primero. */
const PILOTOS: readonly PilotoDef[] = [
  { placa: '1616PIL', conductor: { nombre: 'Piloto Línea Dieciséis', documentoIdentidad: '9000016 CB', licenciaConducir: 'LIC-9000016' }, nuevo: false },
  { placa: '1616PIB', conductor: { nombre: 'Piloto Línea Dieciséis Bravo', documentoIdentidad: '9000017 CB', licenciaConducir: 'LIC-9000017' }, nuevo: true },
  { placa: '1616PIC', conductor: { nombre: 'Piloto Línea Dieciséis Charlie', documentoIdentidad: '9000018 CB', licenciaConducir: 'LIC-9000018' }, nuevo: true },
];
const PILOTO_1 = PILOTOS[0]!;

const PERIODO = 'piloto-linea-16';
const HORARIO = 'manana';
const DESDE_DEFAULT = '2026-10-13';
const HASTA_DEFAULT = '2026-10-26';
const MAX_DIAS = 60;

const PIN_REGEX = /^\d{6,12}$/;
const PENDIENTE = 'PENDIENTE';
const CONCURRENCIA_ESCANEO = 4;
const PUBLICAR_INTENTOS = 3;
const PUBLICAR_BACKOFF_MS = [2_000, 6_000];

// ============================================================================================
// CLI y entorno (fail-closed)
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');
const RESET_CREDENCIALES = argv.includes('--reset-credenciales');
const PIN_VEHICULO = argv.includes('--pin-vehiculo');
const DESACTIVAR = argv.includes('--desactivar');
const FORZAR_ANULAR = argv.includes('--forzar-anular');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=… QUIVO_ADMIN_PASSWORD=… [QUIVO_API_URL=…] tsx scripts/crear-piloto-linea-16.ts [opciones]

Opciones:
  --apply                Escribe vía la API. Sin esto: dry-run (login + GETs, NO escribe).
  --reset-credenciales   Re-fija el PIN de los 3 conductores aunque ya existan (revoca sus sesiones activas).
  --pin-vehiculo         También fija el PIN del vehículo 1616PIL (solo lo usa el login legado).
  --forzar-anular        Anula la rotación publicada aunque haya una sesión activa en alguno de los vehículos.
  --desactivar           Fin del piloto: deja inactivos los 3 vehículos, los 3 conductores y el socio (no crea nada).
  --help                 Esta ayuda.

Opcionales: QUIVO_SINDICATO_ID, QUIVO_SINDICATO_NOMBRE, QUIVO_PILOTO16_PIN, QUIVO_PILOTO16_VEHICULO_PIN,
QUIVO_PILOTO16_CREDS_FILE, QUIVO_PILOTO16_DESDE, QUIVO_PILOTO16_DESDE_NUEVOS, QUIVO_PILOTO16_HASTA. Ver la cabecera del archivo.
`);
  process.exit(0);
}

function fallar(mensaje: string): never {
  console.error(`${mensaje} Abortando antes de tocar nada.`);
  process.exit(1);
}

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim().length === 0) fallar(`Falta la variable de entorno ${nombre}.`);
  return valor;
}

function normalizarBaseUrl(url: string): string {
  const sinBarraFinal = url.replace(/\/+$/, '');
  const host = new URL(sinBarraFinal).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!sinBarraFinal.startsWith('https://') && !local) {
    fallar(`QUIVO_API_URL debe ser https (salvo localhost/127.0.0.1): "${sinBarraFinal}".`);
  }
  return sinBarraFinal.endsWith('/v1') ? sinBarraFinal : `${sinBarraFinal}/v1`;
}

/** Fechas por placa. Piloto 1: DESDE (default 2026-10-13). Nuevos: DESDE_NUEVOS (default hoy en La Paz). */
function calcularFechas(): Map<string, string[]> {
  const hasta = (process.env.QUIVO_PILOTO16_HASTA ?? '').trim() || HASTA_DEFAULT;
  const desde1 = (process.env.QUIVO_PILOTO16_DESDE ?? '').trim() || DESDE_DEFAULT;
  const desdeNuevos = (process.env.QUIVO_PILOTO16_DESDE_NUEVOS ?? '').trim() || hoyLaPaz();
  const out = new Map<string, string[]>();
  for (const p of PILOTOS) {
    const desde = p.nuevo ? desdeNuevos : desde1;
    try {
      out.set(p.placa, rangoFechas(desde, hasta, MAX_DIAS));
    } catch (err) {
      fallar(`${p.placa}: ${err instanceof Error ? err.message : String(err)} (desde=${desde}, hasta=${hasta}).`);
    }
  }
  return out;
}

function leerPinEnv(nombre: string): string | undefined {
  const v = process.env[nombre]?.trim();
  if (!v) return undefined;
  if (!PIN_REGEX.test(v)) fallar(`${nombre} no tiene el formato esperado (6 a 12 dígitos).`);
  return v;
}

function dentroDe(base: string, destino: string): boolean {
  const rel = path.relative(base, destino);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Ruta absoluta, con realpath del directorio padre (y del archivo si existe) FUERA del repo
 * (también resuelto con realpath): evita symlinks que apunten adentro. */
function validarRutaCreds(): string | undefined {
  const v = process.env.QUIVO_PILOTO16_CREDS_FILE?.trim();
  if (!v) return undefined;
  if (!path.isAbsolute(v)) fallar('QUIVO_PILOTO16_CREDS_FILE debe ser una ruta absoluta.');
  let padre: string;
  try {
    padre = fs.realpathSync(path.dirname(v));
  } catch {
    fallar(`El directorio de QUIVO_PILOTO16_CREDS_FILE no existe: ${path.dirname(v)}.`);
  }
  const destino = fs.existsSync(v) ? fs.realpathSync(v) : path.join(padre, path.basename(v));
  const repo = fs.realpathSync(REPO_ROOT);
  if (dentroDe(repo, padre) || dentroDe(repo, destino)) {
    fallar('QUIVO_PILOTO16_CREDS_FILE debe estar FUERA del repo (los secretos no se versionan).');
  }
  return destino;
}

function generarPin(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}

// ============================================================================================
// Cliente HTTP — lecturas siempre; escrituras solo con --apply
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

function resumirBody(body: unknown): string {
  if (body === undefined || body === null) return '(sin body)';
  const resumen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    resumen[k] = k === 'pin' || k === 'password' ? '(oculto)' : v;
  }
  return JSON.stringify(resumen);
}

/** Escritura: en dry-run solo imprime; con --apply la manda. Devuelve la respuesta (o undefined). */
async function escribir<T = { id: string }>(metodo: string, ruta: string, body?: unknown): Promise<T | undefined> {
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
interface LineaApi { id: string; sindicatoId: string; codigo: string }
interface RutaApi { id: string; lineaId: string; sentido: string; estado: string }
interface VehiculoApi { id: string; sindicatoId: string; socioId: string | null; placa: string; placaNormalizada: string; estado: string }
interface SocioApi { id: string; sindicatoId: string; nombre: string; documentoIdentidad: string; estado: string }
interface ConductorApi { id: string; sindicatoId: string; nombre: string; documentoIdentidad: string; estado: string }
interface RotacionApi { id: string; sindicatoId: string; periodo: string; estado: string }
interface AsignacionApi {
  id: string;
  rotacionId: string;
  vehiculoId: string;
  conductorId: string | null;
  rutaId: string;
  fecha: string;
  horario: string;
  estado: string;
}
interface RotacionConAsignaciones extends RotacionApi { asignaciones: AsignacionApi[] }
interface VerificarPlacaApi {
  disponible: boolean;
  coincidencia: { vehiculoId: string; sindicatoId: string; sindicatoNombre: string } | null;
}

const fechaDe = (a: AsignacionApi): string => a.fecha.slice(0, 10);

// ============================================================================================
// Credenciales generadas en esta corrida: SOLO al archivo (0600), nunca por stdout
// ============================================================================================

let rutaCreds: string | undefined;
/** PIN de conductor fijados en esta corrida, por placa. */
const pinesConductor = new Map<string, { nombre: string; pin: string }>();
let pinVehiculo1: string | undefined;

function guardarCredsEnArchivo(): void {
  if (!APLICAR || !rutaCreds) return;
  // Abre (o crea) con 0600, fchmod ANTES de escribir, y FUSIONA con lo que ya había (sin pisar a otros).
  const fd = fs.openSync(rutaCreds, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    const previo = fs.readFileSync(fd, 'utf8');
    const nuevas = [...pinesConductor].map(([placa, v]) => ({ placa, nombre: v.nombre, pin: v.pin }));
    const extras: Record<string, string> = pinVehiculo1 ? { pin_vehiculo: pinVehiculo1 } : {};
    const salida = fusionarCreds(previo, nuevas, new Date().toISOString(), PILOTO_1.conductor.nombre, extras);
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, salida, 0);
  } finally {
    fs.closeSync(fd);
  }
}

// ============================================================================================
// Login y resolución del sindicato / línea / ruta
// ============================================================================================

async function login(): Promise<void> {
  console.log('--- Login (POST /v1/auth/login) ---');
  const r = (await http('POST', '/auth/login', { email: requerirEnv('QUIVO_ADMIN_EMAIL'), password: requerirEnv('QUIVO_ADMIN_PASSWORD') })) as {
    accessToken: string;
    user: { email: string; rol: string };
  };
  accessToken = r.accessToken;
  console.log(`  OK — autenticado como ${r.user.email} (rol=${r.user.rol}).`);
  if (r.user.rol !== 'admin_quivo') throw new ErrorApi(`El usuario tiene rol "${r.user.rol}"; hace falta admin_quivo.`);
}

async function resolverSindicato(): Promise<SindicatoApi> {
  console.log('\n--- Sindicato piloto (GET /v1/sindicatos) ---');
  const todos = await leer<SindicatoApi[]>('/sindicatos');
  const id = process.env.QUIVO_SINDICATO_ID?.trim();
  const nombre = process.env.QUIVO_SINDICATO_NOMBRE?.trim() || NOMBRE_SINDICATO_DEFAULT;
  const candidatos = id ? todos.filter((s) => s.id === id) : todos.filter((s) => s.nombre === nombre);
  if (candidatos.length !== 1) {
    throw new ErrorApi(
      `Se esperaba exactamente 1 sindicato (${id ? `id=${id}` : `nombre="${nombre}"`}), hay ${candidatos.length}. ` +
        `Existentes: ${todos.map((s) => `"${s.nombre}"`).join(', ') || '(ninguno)'}.`,
    );
  }
  const s = candidatos[0]!;
  if (s.estado !== 'activo') throw new ErrorApi(`El sindicato "${s.nombre}" está '${s.estado}', no 'activo'.`);
  console.log(`  "${s.nombre}" (${s.id}).`);
  return s;
}

/** Devuelve el id de la ruta `circuito` activa de la línea 16, o null si la línea 16 aún no está
 * cargada (en dry-run se avisa; en --apply se aborta). Más de una ruta o línea ambigua = error. */
async function resolverRuta16(sindicato: SindicatoApi): Promise<string | null> {
  console.log('\n--- Línea 16 y su ruta circuito (GET /v1/lineas, GET /v1/lineas/:id/rutas) ---');
  const lineas = (await leer<LineaApi[]>('/lineas')).filter((l) => l.sindicatoId === sindicato.id && l.codigo === LINEA_CODIGO);
  if (lineas.length > 1) throw new ErrorApi(`Hay ${lineas.length} líneas con código ${LINEA_CODIGO} en el sindicato; ambiguo.`);
  const linea = lineas[0];
  if (!linea) {
    console.warn(`  AVISO: la línea ${LINEA_CODIGO} NO está cargada en el sindicato (correr scripts/cargar-linea-16.ts --apply antes).`);
    return null;
  }
  const rutas = (await leer<RutaApi[]>(`/lineas/${linea.id}/rutas`)).filter((r) => r.sentido === SENTIDO_RUTA && r.estado === 'activo');
  if (rutas.length > 1) throw new ErrorApi(`Hay ${rutas.length} rutas '${SENTIDO_RUTA}' activas en la línea 16; ambiguo.`);
  const ruta = rutas[0];
  if (!ruta) {
    console.warn(`  AVISO: la línea 16 (${linea.id}) no tiene ruta '${SENTIDO_RUTA}' activa.`);
    return null;
  }
  console.log(`  Línea 16: ${linea.id} — ruta ${SENTIDO_RUTA}: ${ruta.id}.`);
  return ruta.id;
}

// ============================================================================================
// Pre-vuelo: SOLO lecturas. Descubre el estado y aborta ante cualquier cosa inesperada.
// ============================================================================================

interface PilotoEstado {
  def: PilotoDef;
  fechas: string[];
  vehiculo: VehiculoApi | null;
  conductor: ConductorApi | null;
}

interface Descubierto {
  sindicato: SindicatoApi;
  rutaId: string | null;
  socio: SocioApi | null;
  pilotos: PilotoEstado[];
  rotacion: RotacionConAsignaciones | null;
  plan: PlanRotacion | null;
  accion: AccionRotacion;
  motivoAccion: string;
}

/** Sesiones activas ahora en los 3 vehículos (GET /v1/reportes/en-vivo, solo lectura). */
async function sesionesActivasPilotos(): Promise<SesionEnVivoLike[]> {
  const sesiones = await leer<SesionEnVivoLike[]>('/reportes/en-vivo');
  return sesionesBloqueantes(sesiones, PILOTOS.map((p) => p.placa));
}

async function preVuelo(sindicato: SindicatoApi, fechasPorPlaca: Map<string, string[]>): Promise<Descubierto> {
  console.log('\n--- Pre-vuelo (solo lecturas, antes de cualquier escritura) ---');
  const rutaId = await resolverRuta16(sindicato);
  if (!rutaId && APLICAR) throw new ErrorApi('No se puede aplicar sin la ruta circuito de la línea 16 (cargarla primero con scripts/cargar-linea-16.ts --apply).');

  // --- Socio propietario (placeholder; la API lo exige para activar los vehículos) ---
  const socios = (await leer<SocioApi[]>('/socios')).filter((x) => x.sindicatoId === sindicato.id);
  const sociosDoc = socios.filter((x) => x.documentoIdentidad.toUpperCase() === SOCIO.documentoIdentidad);
  if (sociosDoc.length > 1) throw new ErrorApi(`Hay ${sociosDoc.length} socios con CI ${SOCIO.documentoIdentidad}; ambiguo.`);
  const socio = sociosDoc[0] ?? null;
  if (socio && (socio.nombre !== SOCIO.nombre || socio.estado !== 'activo')) {
    throw new ErrorApi(`El CI ${SOCIO.documentoIdentidad} pertenece a "${socio.nombre}" (${socio.id}, ${socio.estado}), no al socio piloto. Abortando.`);
  }
  if (!socio && socios.some((x) => x.nombre === SOCIO.nombre)) {
    throw new ErrorApi(`Existe un socio "${SOCIO.nombre}" con otro CI; resolver a mano.`);
  }
  console.log(socio ? `  Socio propietario: ya existe (${socio.id}).` : '  Socio propietario: no existe.');

  const vehiculos = await leer<VehiculoApi[]>('/vehiculos');
  const conductores = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id);

  const pilotos: PilotoEstado[] = [];
  for (const def of PILOTOS) {
    const placa = def.placa;
    const c = def.conductor;
    // --- Vehículo ---
    const placaV = await leer<VerificarPlacaApi>(`/vehiculos/verificar-placa?placa=${encodeURIComponent(placa)}`);
    if (placaV.coincidencia && placaV.coincidencia.sindicatoId !== sindicato.id) {
      throw new ErrorApi(`La placa ${placa} ya la usa un vehículo vigente de OTRO sindicato ("${placaV.coincidencia.sindicatoNombre}"). Abortando.`);
    }
    const propios = vehiculos.filter((v) => v.sindicatoId === sindicato.id && v.placaNormalizada === placa);
    const otrosSindicatos = vehiculos.filter((v) => v.sindicatoId !== sindicato.id && v.placaNormalizada === placa && v.estado !== 'inactivo');
    if (otrosSindicatos.length > 0) throw new ErrorApi(`La placa ${placa} ya existe vigente en otro sindicato (${otrosSindicatos[0]!.id}). Abortando.`);
    if (propios.length > 1) throw new ErrorApi(`Hay ${propios.length} vehículos con placa ${placa} en el sindicato; resolver a mano.`);
    const vehiculo = propios[0] ?? null;
    if (vehiculo) {
      if (vehiculo.estado !== 'activo' && vehiculo.estado !== 'pendiente') {
        throw new ErrorApi(`El vehículo ${placa} (${vehiculo.id}) está '${vehiculo.estado}'; no se reactiva solo. Resolver a mano.`);
      }
      if (vehiculo.socioId && (!socio || vehiculo.socioId !== socio.id)) {
        throw new ErrorApi(`El vehículo ${placa} tiene otro socio (${vehiculo.socioId}); resolver a mano.`);
      }
      console.log(`  Vehículo ${placa}: ya existe (${vehiculo.id}, ${vehiculo.estado}).`);
    } else {
      console.log(`  Vehículo ${placa}: no existe (placa disponible: ${placaV.disponible}).`);
    }

    // --- Conductor ---
    const porDoc = conductores.filter((x) => x.documentoIdentidad.toUpperCase() === c.documentoIdentidad);
    const porNombre = conductores.filter((x) => x.nombre === c.nombre);
    if (porDoc.length > 1 || porNombre.length > 1) throw new ErrorApi(`Conductor "${c.nombre}" ambiguo (CI o nombre duplicados); resolver a mano.`);
    const conductor = porDoc[0] ?? null;
    if (!conductor && porNombre[0]) {
      throw new ErrorApi(`Existe un conductor "${c.nombre}" (${porNombre[0].id}) con otro CI (${porNombre[0].documentoIdentidad}); resolver a mano.`);
    }
    if (conductor && conductor.nombre !== c.nombre) {
      throw new ErrorApi(`El CI ${c.documentoIdentidad} pertenece a "${conductor.nombre}" (${conductor.id}), no a "${c.nombre}". Abortando.`);
    }
    if (conductor && conductor.estado !== 'activo') throw new ErrorApi(`El conductor "${c.nombre}" (${conductor.id}) está '${conductor.estado}'; resolver a mano.`);
    console.log(conductor ? `  Conductor "${c.nombre}": ya existe (${conductor.id}).` : `  Conductor "${c.nombre}": no existe.`);

    pilotos.push({ def, fechas: fechasPorPlaca.get(placa)!, vehiculo, conductor });
  }

  // --- Rotaciones: la propia (por periodo) + ocupación de ESTOS vehículos en otras ---
  const rotaciones = (await leer<RotacionApi[]>('/rotaciones')).filter((r) => r.sindicatoId === sindicato.id);
  const propiasRot = rotaciones.filter((r) => r.periodo === PERIODO);
  if (propiasRot.length > 1) throw new ErrorApi(`Hay ${propiasRot.length} rotaciones con periodo '${PERIODO}'; ambiguo.`);
  let rotacion: RotacionConAsignaciones | null = null;
  if (propiasRot[0]) {
    rotacion = await leer<RotacionConAsignaciones>(`/rotaciones/${propiasRot[0].id}`);
    console.log(`  Rotación '${PERIODO}': ya existe (${rotacion.id}, ${rotacion.estado}, ${rotacion.asignaciones.length} asignación(es)).`);
  } else {
    console.log(`  Rotación '${PERIODO}': no existe.`);
  }
  const existentesVeh = pilotos.filter((p) => p.vehiculo);
  if (existentesVeh.length > 0) {
    // Se escanean TODAS las rotaciones del sindicato: `periodo` es texto libre y la API no obliga a que
    // las fechas de las asignaciones caigan dentro de él; solo cuentan las fechas reales.
    const aEscanear = rotaciones.filter((x) => x.id !== rotacion?.id);
    console.log(`  Escaneando ${aEscanear.length} de ${rotaciones.length} rotación(es) del sindicato (concurrencia ${CONCURRENCIA_ESCANEO}).`);
    let siguiente = 0;
    const choquesTotales: string[] = [];
    const trabajador = async () => {
      while (siguiente < aEscanear.length) {
        const r = aEscanear[siguiente++]!;
        const det = await leer<RotacionConAsignaciones>(`/rotaciones/${r.id}`);
        for (const p of existentesVeh) {
          const fechasSet = new Set(p.fechas);
          const n = det.asignaciones.filter((a) => a.vehiculoId === p.vehiculo!.id && a.horario === HORARIO && fechasSet.has(fechaDe(a))).length;
          if (n > 0) choquesTotales.push(`${p.def.placa}: ${n} en ${r.id} ('${r.periodo}')`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_ESCANEO, aEscanear.length) }, trabajador));
    if (choquesTotales.length > 0) {
      throw new ErrorApi(`Hay asignaciones '${HORARIO}' en el rango de estos vehículos en OTRA(S) rotación(es): ${choquesTotales.join('; ')}. Abortando.`);
    }
  }

  // --- Plan de la rotación propia y decisión (anular / completar / sin cambios / abortar) ---
  let plan: PlanRotacion | null = null;
  let sesionesActivas = 0;
  if (rotacion) {
    plan = planearRotacion(
      rotacion.asignaciones,
      pilotos.map((p) => ({ vehiculoId: p.vehiculo?.id, conductorId: p.conductor?.id, fechas: p.fechas, fueraEsDiferencia: !p.def.nuevo })),
      rutaId,
      HORARIO,
    );
    if (plan.ajenas > 0) {
      throw new ErrorApi(`La rotación '${PERIODO}' (${rotacion.id}) tiene ${plan.ajenas} asignación(es) de OTROS vehículos; inesperado. Resolver a mano.`);
    }
    if (rotacion.estado === 'publicada' && !plan.hayDiferencias && plan.hayFaltantes) {
      const bloqueantes = await sesionesActivasPilotos();
      sesionesActivas = bloqueantes.length;
      if (sesionesActivas > 0) {
        console.warn(`  Sesiones activas en los vehículos del piloto: ${bloqueantes.map((s) => `${s.vehiculoPlaca} (${s.estadoFrescura})`).join(', ')}.`);
      }
    }
  }
  const { accion, motivo } = decidirAnular({
    estado: rotacion?.estado ?? null,
    hayFaltantes: plan?.hayFaltantes ?? true,
    hayDiferencias: plan?.hayDiferencias ?? false,
    sesionesActivas,
    forzar: FORZAR_ANULAR,
  });
  if (accion === 'abortar_difiere' && rotacion && plan) {
    const detalle = plan.porPiloto.flatMap((pp, i) => pp.diferencias.map((d) => `${pilotos[i]!.def.placa}: ${d}`));
    throw new ErrorApi(
      `La rotación '${PERIODO}' (${rotacion.id}) ya está PUBLICADA y difiere del plan; este script NO la reescribe ni la anula (decide el operador):\n  - ` + detalle.join('\n  - '),
    );
  }
  if (accion === 'abortar_sesion_activa') throw new ErrorApi(`No se anula la rotación '${PERIODO}': ${motivo}.`);
  console.log(`  Decisión sobre la rotación: ${accion} — ${motivo}.`);

  // --- generar() reparte entre TODOS los vehículos activos. Solo PISTA (best-effort): la red de
  // seguridad real es la limpieza posterior a generar() en crearRotacionConGenerar. ---
  if (!rotacion) {
    const placasPiloto = new Set(PILOTOS.map((p) => p.placa));
    const otrosActivos = vehiculos.filter((v) => v.sindicatoId === sindicato.id && v.estado === 'activo' && !placasPiloto.has(v.placaNormalizada));
    const antes = otrosActivos.filter((v) => v.placa.toUpperCase() < PILOTO_1.placa);
    if (antes.length > 0) {
      console.warn(
        `  AVISO: generar() podría elegir primero a otro vehículo activo (${antes.map((v) => v.placa).join(', ')}) en vez de ${PILOTO_1.placa}. ` +
          'Si pasa, el script borra lo que generar() haya creado y aborta (no queda ninguna asignación).',
      );
    } else {
      console.log(`  Pista: ${PILOTO_1.placa} ordena antes que los ${otrosActivos.length} vehículo(s) activo(s) visibles (best-effort).`);
    }
  }

  return { sindicato, rutaId, socio, pilotos, rotacion, plan, accion, motivoAccion: motivo };
}

// ============================================================================================
// Sincronización (escrituras)
// ============================================================================================

interface IdsPiloto { vehiculoId: string; conductorId: string }

async function sincronizarSocio(d: Descubierto): Promise<string> {
  console.log('\n--- Socio (POST /v1/socios) ---');
  if (d.socio) {
    console.log(`  Socio propietario ya existe (${d.socio.id}).`);
    return d.socio.id;
  }
  const creado = await escribir<SocioApi>('POST', '/socios', { sindicatoId: d.sindicato.id, ...SOCIO });
  return creado?.id ?? PENDIENTE;
}

async function sincronizarVehiculo(d: Descubierto, p: PilotoEstado, socioId: string): Promise<string> {
  const placa = p.def.placa;
  if (p.vehiculo) {
    const id = p.vehiculo.id;
    if (!p.vehiculo.socioId) await escribir('PATCH', `/vehiculos/${id}`, { socioId });
    if (p.vehiculo.estado === 'pendiente') await escribir('PATCH', `/vehiculos/${id}/estado`, { estado: 'activo' });
    else console.log(`  ${placa} ya existe y está activo (${id}).`);
    return id;
  }
  const creado = await escribir<VehiculoApi>('POST', '/vehiculos', { sindicatoId: d.sindicato.id, socioId, placa, ...VEHICULO });
  const id = creado?.id ?? PENDIENTE;
  await escribir('PATCH', `/vehiculos/${id}/estado`, { estado: 'activo' });
  return id;
}

async function sincronizarConductor(d: Descubierto, p: PilotoEstado): Promise<string> {
  if (p.conductor) {
    console.log(`  Conductor "${p.def.conductor.nombre}" ya existe (${p.conductor.id}).`);
    return p.conductor.id;
  }
  const creado = await escribir<ConductorApi>('POST', '/conductores', { sindicatoId: d.sindicato.id, ...p.def.conductor });
  return creado?.id ?? PENDIENTE;
}

async function sincronizarCredenciales(p: PilotoEstado, vehiculoId: string, conductorId: string): Promise<void> {
  const esPiloto1 = p.def === PILOTO_1;
  const conductorNuevo = !p.conductor;
  if (conductorNuevo || RESET_CREDENCIALES) {
    const envPin = esPiloto1 ? leerPinEnv('QUIVO_PILOTO16_PIN') : undefined;
    const pin = envPin ?? generarPin();
    await escribir('PUT', `/mobile/credenciales/conductores/${conductorId}`, { pin });
    if (APLICAR) {
      pinesConductor.set(p.def.placa, { nombre: p.def.conductor.nombre, pin });
      guardarCredsEnArchivo(); // de inmediato: si algo falla después, el PIN ya no se pierde
    }
  } else {
    console.log(`  ${p.def.placa}: el conductor ya existía, PIN NO se toca (--reset-credenciales para rotarlo; revoca sus sesiones activas).`);
  }
  if (PIN_VEHICULO && esPiloto1) {
    if (!p.vehiculo || RESET_CREDENCIALES) {
      const pin = leerPinEnv('QUIVO_PILOTO16_VEHICULO_PIN') ?? generarPin();
      await escribir('PUT', `/mobile/credenciales/vehiculos/${vehiculoId}`, { pin });
      if (APLICAR) {
        pinVehiculo1 = pin;
        guardarCredsEnArchivo();
      }
    } else {
      console.log('  El vehículo ya existía: su PIN NO se toca (usar --reset-credenciales).');
    }
  }
}

/** Socio + vehículo + conductor + PIN de un piloto. Devuelve sus ids. */
async function sincronizarPiloto(d: Descubierto, p: PilotoEstado, socioId: string): Promise<IdsPiloto> {
  console.log(`\n--- Piloto ${p.def.placa} · "${p.def.conductor.nombre}" (vehículo, conductor, PIN) ---`);
  const vehiculoId = await sincronizarVehiculo(d, p, socioId);
  const conductorId = await sincronizarConductor(d, p);
  await sincronizarCredenciales(p, vehiculoId, conductorId);
  return { vehiculoId, conductorId };
}

/** `fn` con hasta `intentos` intentos y backoff (ms) entre ellos. Lanza el último error. */
async function conReintentos<T>(etiqueta: string, intentos: number, backoffMs: number[], fn: () => Promise<T>): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (i < intentos - 1) {
        const espera = backoffMs[Math.min(i, backoffMs.length - 1)] ?? 2_000;
        console.warn(`  ${etiqueta} falló (intento ${i + 1}/${intentos}): ${err instanceof Error ? err.message.split('\n')[0] : String(err)} — reintento en ${Math.round(espera / 1000)}s`);
        await esperarMs(espera);
      }
    }
  }
  throw ultimo;
}

/** Rotación que el script dejó (o puede haber dejado) en borrador con el login móvil caído. */
let rotacionEnBorrador: string | undefined;

function comandoRecorrer(): string {
  return 'packages/db/node_modules/.bin/tsx scripts/crear-piloto-linea-16.ts --apply';
}

function bannerBorrador(rotacionId: string): string {
  const linea = '!'.repeat(90);
  return [
    linea,
    `!! LA ROTACIÓN ${rotacionId} ('${PERIODO}') QUEDÓ EN BORRADOR — EL LOGIN MÓVIL NUEVO ESTÁ CAÍDO (exige rotación publicada)`,
    '!! Re-correr AHORA (completa lo que falte y publica; es idempotente):',
    `!!     ${comandoRecorrer()}`,
    `!! o publicar a mano: POST ${API_URL}/rotaciones/${rotacionId}/publicar (o "Publicar" en el panel).`,
    linea,
  ].join('\n');
}

class ErrorPublicacion extends ErrorApi {}

async function publicarConReintentos(rotacionId: string): Promise<void> {
  try {
    await conReintentos('publicar', PUBLICAR_INTENTOS, PUBLICAR_BACKOFF_MS, async () => {
      await escribir('POST', `/rotaciones/${rotacionId}/publicar`);
    });
  } catch (err) {
    throw new ErrorPublicacion(`No se pudo publicar la rotación ${rotacionId} tras ${PUBLICAR_INTENTOS} intentos: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (APLICAR) rotacionEnBorrador = undefined;
}

/** generar(): 1 fecha, 1 horario, 1 ruta = lo esperado es exactamente 1 asignación de 1616PIL. Solo
 * si la rotación NO existe. */
async function crearRotacionConGenerar(d: Descubierto, fechasPiloto1: string[], vehiculoId: string): Promise<{ rotacionId: string; existentes: AsignacionApi[] }> {
  const rutaId = d.rutaId ?? PENDIENTE;
  const generada = await escribir<RotacionConAsignaciones>('POST', '/rotaciones', {
    sindicatoId: d.sindicato.id,
    periodo: PERIODO,
    rutaIds: [rutaId],
    fechas: [fechasPiloto1[0]],
    horarios: [HORARIO],
  });
  const rotacionId = generada?.id ?? PENDIENTE;
  if (!generada) {
    // Dry-run: generar() NO se manda, pero dejaría la asignación de la primera fecha con el conductor
    // equivocado (el primero por nombre). Se simula para mostrar el PATCH.
    return {
      rotacionId,
      existentes: [{ id: PENDIENTE, rotacionId, vehiculoId, conductorId: null, rutaId, fecha: fechasPiloto1[0]!, horario: HORARIO, estado: 'vigente' }],
    };
  }
  rotacionEnBorrador = generada.id;
  const as = generada.asignaciones;
  const ok = as.length === 1 && as[0]!.vehiculoId === vehiculoId && as[0]!.rutaId === rutaId && fechaDe(as[0]!) === fechasPiloto1[0];
  if (!ok) await limpiarGenerarInesperado(generada.id, as);
  return { rotacionId, existentes: as };
}

/** Red de seguridad de generar(): si repartió algo distinto de la única asignación esperada, borra
 * TODAS las que creó (la rotación es borrador y no tienen sesiones), verifica por GET que no quedó
 * ninguna y aborta. La API no tiene DELETE de rotaciones: el borrador vacío queda (inofensivo: no se
 * puede publicar sin asignaciones, y una corrida posterior lo reutiliza). */
async function limpiarGenerarInesperado(rotacionId: string, creadas: AsignacionApi[]): Promise<never> {
  console.error(`\n  generar() devolvió ${creadas.length} asignación(es) y no la única esperada. Borrando lo que creó (rotación ${rotacionId}, borrador)...`);
  const fallos: string[] = [];
  for (const a of creadas) {
    try {
      await escribir('DELETE', `/rotaciones/${rotacionId}/asignaciones/${a.id}`);
    } catch (err) {
      fallos.push(`${a.id}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  const resto = (await leer<RotacionConAsignaciones>(`/rotaciones/${rotacionId}`)).asignaciones;
  const msg =
    resto.length === 0
      ? `Se borraron las ${creadas.length} asignación(es); verificado por GET: la rotación ${rotacionId} quedó vacía (borrador, sin DELETE de rotaciones en la API).`
      : `ATENCIÓN: quedaron ${resto.length} asignación(es) en la rotación ${rotacionId} (${resto.map((a) => `${a.vehiculoId}@${fechaDe(a)}`).join(', ')}). Fallos: ${fallos.join('; ') || '(ninguno)'}. Resolver a mano.`;
  throw new ErrorApi(
    `generar() no eligió a ${PILOTO_1.placa} como único vehículo (el orden de reparto no era el supuesto). ${msg} Nada se publicó. Abortando.`,
  );
}

/** Completa las asignaciones de TODOS los pilotos sobre una rotación en BORRADOR y la publica. Si
 * `desdePublicada`, la rotación ya fue anulada por el llamador (ventana sin login abierta): ante un
 * fallo de un POST igual se intenta publicar lo que haya. */
async function completarYPublicar(
  d: Descubierto,
  rotacionId: string,
  existentes: AsignacionApi[],
  ids: IdsPiloto[],
  desdePublicada: boolean,
): Promise<void> {
  const rutaId = d.rutaId ?? PENDIENTE;
  let errorAgregando: unknown;
  try {
    for (const [i, p] of d.pilotos.entries()) {
      const { vehiculoId, conductorId } = ids[i]!;
      const propias = existentes.filter((a) => a.vehiculoId === vehiculoId);
      const porFecha = new Map(propias.map((a) => [fechaDe(a), a]));
      const faltan = p.fechas.filter((f) => !porFecha.has(f));
      const corregir = propias.filter((a) => p.fechas.includes(fechaDe(a)) && (a.conductorId !== conductorId || a.rutaId !== rutaId || a.horario !== HORARIO));
      const fuera = propias.filter((a) => !p.fechas.includes(fechaDe(a)));
      if (fuera.length > 0) console.warn(`  AVISO ${p.def.placa}: ${fuera.length} asignación(es) fuera del rango (${fuera.map(fechaDe).join(', ')}): NO se tocan (nunca se borra).`);
      console.log(`  ${p.def.placa}: ${faltan.length} asignación(es) por crear${corregir.length > 0 ? `, ${corregir.length} por corregir (borrador propio)` : ''}.`);
      for (const a of corregir) {
        await escribir('PATCH', `/rotaciones/${rotacionId}/asignaciones/${a.id}`, { conductorId, rutaId, horario: HORARIO });
      }
      for (const f of faltan) {
        await escribir('POST', `/rotaciones/${rotacionId}/asignaciones`, {
          vehiculoId,
          conductorId,
          rutaId,
          fecha: f,
          horario: HORARIO,
          orden: p.fechas.indexOf(f) + 1,
        });
      }
    }
  } catch (err) {
    errorAgregando = err;
    if (!desdePublicada) throw err; // borrador propio: queda borrador, igual que antes; re-correr completa
    console.error(`\n  Falló agregar asignaciones con la rotación anulada: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}. Se publica lo que haya para NO dejar el login caído.`);
  }
  await publicarConReintentos(rotacionId);
  if (errorAgregando) {
    throw new ErrorApi(
      `La rotación ${rotacionId} se volvió a publicar, pero NO se pudieron agregar todas las asignaciones (${errorAgregando instanceof Error ? errorAgregando.message.split('\n')[0] : String(errorAgregando)}). Re-correr para completar (volverá a anular/publicar).`,
    );
  }
}

async function sincronizarRotacion(d: Descubierto, ids: IdsPiloto[]): Promise<string> {
  console.log(`\n--- Rotación '${PERIODO}' y asignaciones (/rotaciones, /anular, /asignaciones, /publicar) ---`);
  if (!d.rotacion) throw new Error('sincronizarRotacion: la rotación debe existir (la crea main con generar()).');
  const rotacionId = d.rotacion.id;
  const existentes = d.rotacion.asignaciones;
  if (d.accion === 'sin_cambios') {
    console.log(`  Rotación ya publicada y coincide con el plan (${existentes.length} asignación(es)): sin cambios.`);
    return rotacionId;
  }
  if (d.accion === 'completar_borrador') {
    console.log('  Rotación en borrador (corrida anterior incompleta): se completa y se publica.');
    rotacionEnBorrador = rotacionId;
    await completarYPublicar(d, rotacionId, existentes, ids, false);
    return rotacionId;
  }
  if (d.accion !== 'anular') throw new Error(`Acción inesperada: ${d.accion}`);

  // Re-chequeo de sesiones activas justo antes de anular (el pre-vuelo pudo ser hace un rato).
  if (!FORZAR_ANULAR) {
    const bloqueantes = await sesionesActivasPilotos();
    if (bloqueantes.length > 0) {
      throw new ErrorApi(`No se anula: sesión(es) activa(s) justo antes de anular (${bloqueantes.map((s) => s.vehiculoPlaca).join(', ')}). Reintentar luego o usar --forzar-anular.`);
    }
  }
  const total = d.plan!.porPiloto.reduce((n, pp) => n + pp.faltan.length, 0);
  console.log(`  ${APLICAR ? 'ANULANDO' : 'ANULARÍA'} la rotación ${rotacionId} (ventana SIN login móvil nuevo) → ${total} asignación(es) → publicar.`);
  await escribir('POST', `/rotaciones/${rotacionId}/anular`);
  if (APLICAR) rotacionEnBorrador = rotacionId;
  await completarYPublicar(d, rotacionId, existentes, ids, true);
  return rotacionId;
}

// ============================================================================================
// Verificación final (solo lecturas)
// ============================================================================================

async function verificar(sindicato: SindicatoApi, rutaId: string, rotacionId: string, pilotos: PilotoEstado[]): Promise<void> {
  console.log('\n--- Verificación final (solo lecturas) ---');
  const rot = await leer<RotacionConAsignaciones>(`/rotaciones/${rotacionId}`);
  if (rot.estado !== 'publicada') throw new Error(`La rotación ${rot.id} está '${rot.estado}', no 'publicada'.`);
  const vehiculosApi = (await leer<VehiculoApi[]>('/vehiculos')).filter((v) => v.sindicatoId === sindicato.id);
  const conductoresApi = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id);
  // Hoy en America/La_Paz: una asignación de un día PASADO puede estar 'vencida' (cron marcarVencidas);
  // de hoy en adelante debe seguir 'vigente'.
  const hoyBo = hoyLaPaz();
  const estadoOk = (a: AsignacionApi): boolean => (fechaDe(a) < hoyBo ? a.estado === 'vigente' || a.estado === 'vencida' : a.estado === 'vigente');
  const idsVeh = new Set<string>();

  for (const p of pilotos) {
    const { placa, conductor: c } = p.def;
    const vs = vehiculosApi.filter((v) => v.placaNormalizada === placa);
    if (vs.length !== 1 || vs[0]!.estado !== 'activo') throw new Error(`Vehículo ${placa}: se esperaba 1 activo, hay ${vs.length} (${vs[0]?.estado}).`);
    const veh = vs[0]!;
    idsVeh.add(veh.id);
    const cs = conductoresApi.filter((x) => x.documentoIdentidad.toUpperCase() === c.documentoIdentidad);
    if (cs.length !== 1 || cs[0]!.estado !== 'activo') throw new Error(`Conductor "${c.nombre}": se esperaba 1 activo, hay ${cs.length}.`);
    const cond = cs[0]!;
    const propias = rot.asignaciones.filter((a) => a.vehiculoId === veh.id);
    const esperadas = new Set(p.fechas);
    const dentro = propias.filter((a) => esperadas.has(fechaDe(a)));
    if (dentro.length !== p.fechas.length || new Set(dentro.map(fechaDe)).size !== p.fechas.length) {
      throw new Error(`${placa}: asignaciones en el rango ${dentro.length}, esperadas ${p.fechas.length} (una por día).`);
    }
    const malas = dentro.filter((a) => a.conductorId !== cond.id || a.rutaId !== rutaId || a.horario !== HORARIO || !estadoOk(a));
    if (malas.length > 0) throw new Error(`${placa}: ${malas.length} asignación(es) con conductor/ruta/horario/estado incorrectos (${malas.map(fechaDe).join(', ')}).`);
    console.log(`  ${placa} (${veh.id}) + "${cond.nombre}" (${cond.id}): activos; ${dentro.length} asignaciones ${HORARIO} (${p.fechas[0]} … ${p.fechas[p.fechas.length - 1]}).`);
  }
  const ajenas = rot.asignaciones.filter((a) => !idsVeh.has(a.vehiculoId));
  if (ajenas.length > 0) throw new Error(`La rotación tiene ${ajenas.length} asignación(es) de otros vehículos.`);
  console.log(`  Rotación ${rot.id}: publicada, ${rot.asignaciones.length} asignación(es) en total, ruta ${rutaId}.`);
  console.log('  Credenciales: la API no expone si hay PIN fijado (solo guarda el hash); un login móvil crearía una sesión, por eso NO se prueba acá.');
}

// ============================================================================================
// main
// ============================================================================================

const ADVERTENCIA_ROTACIONES =
  `ADVERTENCIA: mientras los vehículos ${PILOTOS.map((p) => p.placa).join('/')} y sus conductores estén ACTIVOS, cualquier POST /rotaciones (generar) lanzado desde el panel ` +
  'para este sindicato los incluirá en el reparto. Cuando termine el piloto (2026-10-26) o antes de generar otras rotaciones, correr:\n' +
  '    tsx scripts/crear-piloto-linea-16.ts --desactivar --apply';

/** Fin del piloto: deja inactivos los 3 vehículos, los 3 conductores y el socio. Idempotente, no crea nada. */
async function desactivar(sindicato: SindicatoApi): Promise<void> {
  console.log('\n--- Desactivar piloto (PATCH estado → inactivo) ---');
  const vehiculos = (await leer<VehiculoApi[]>('/vehiculos')).filter((v) => v.sindicatoId === sindicato.id);
  const conductores = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id);
  const soc = (await leer<SocioApi[]>('/socios')).find((x) => x.sindicatoId === sindicato.id && x.documentoIdentidad.toUpperCase() === SOCIO.documentoIdentidad && x.nombre === SOCIO.nombre);
  const encontrados: { veh?: VehiculoApi; cond?: ConductorApi; def: PilotoDef }[] = PILOTOS.map((def) => ({
    def,
    veh: vehiculos.find((v) => v.placaNormalizada === def.placa),
    cond: conductores.find((c) => c.documentoIdentidad.toUpperCase() === def.conductor.documentoIdentidad && c.nombre === def.conductor.nombre),
  }));
  if (!soc && encontrados.every((e) => !e.veh && !e.cond)) console.log('  No existe nada del piloto: nada que desactivar.');
  for (const { def, veh, cond } of encontrados) {
    if (veh) {
      if (veh.estado === 'inactivo') console.log(`  Vehículo ${def.placa}: ya inactivo.`);
      else await escribir('PATCH', `/vehiculos/${veh.id}/estado`, { estado: 'inactivo', motivo: 'Fin del piloto línea 16' });
    }
    if (cond) {
      if (cond.estado === 'inactivo') console.log(`  Conductor "${def.conductor.nombre}": ya inactivo.`);
      else await escribir('PATCH', `/conductores/${cond.id}`, { estado: 'inactivo' });
    }
  }
  if (soc) {
    if (soc.estado === 'inactivo') console.log('  Socio placeholder: ya inactivo.');
    else await escribir('PATCH', `/socios/${soc.id}`, { estado: 'inactivo' });
  }
  if (APLICAR) {
    const v2 = await leer<VehiculoApi[]>('/vehiculos');
    const c2 = await leer<ConductorApi[]>('/conductores');
    const s2 = (await leer<SocioApi[]>('/socios')).find((x) => x.id === soc?.id);
    const mal =
      encontrados.some(({ veh, cond }) => (veh && v2.find((v) => v.id === veh.id)?.estado !== 'inactivo') || (cond && c2.find((c) => c.id === cond.id)?.estado !== 'inactivo')) ||
      (soc && s2?.estado !== 'inactivo');
    if (mal) throw new Error('Verificación: vehículos/conductores/socio del piloto no quedaron inactivos.');
    console.log('  Verificado por GET: vehículos, conductores y socio del piloto inactivos.');
  }
  console.log('  Las asignaciones ya creadas no se borran (el login exige vehículo y conductor activos).');
}

async function main(): Promise<void> {
  API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL || 'https://quivo-api-741758083365.southamerica-west1.run.app');
  requerirEnv('QUIVO_ADMIN_EMAIL');
  requerirEnv('QUIVO_ADMIN_PASSWORD');
  const fechasPorPlaca = calcularFechas();
  rutaCreds = validarRutaCreds();
  leerPinEnv('QUIVO_PILOTO16_PIN');
  leerPinEnv('QUIVO_PILOTO16_VEHICULO_PIN');

  console.log('='.repeat(90));
  console.log(`Piloto línea 16 (3 trufis) — API ${API_URL} — modo: ${APLICAR ? 'APPLY (escribe vía la API)' : 'DRY-RUN (solo lecturas; no escribe nada)'}`);
  for (const p of PILOTOS) {
    const f = fechasPorPlaca.get(p.placa)!;
    console.log(`  ${p.placa} · "${p.conductor.nombre}" · ${f.length} día(s): ${f[0]} … ${f[f.length - 1]} · horario ${HORARIO}`);
  }
  if (RESET_CREDENCIALES) console.log('--reset-credenciales: se re-fijará el PIN de los 3 conductores.');
  if (FORZAR_ANULAR) console.log('--forzar-anular: se ignoran sesiones activas al anular.');
  console.log(ADVERTENCIA_ROTACIONES.replace(/^/gm, '  '));
  console.log('='.repeat(90));

  try {
    await login();
    const sindicato = await resolverSindicato();
    if (DESACTIVAR) {
      await desactivar(sindicato);
      console.log(APLICAR ? `\nOK. ${escriturasEjecutadas} escritura(s) ejecutada(s).` : `\nDRY-RUN: ${escriturasPlaneadas} escritura(s) planeada(s), 0 enviadas.`);
      return;
    }
    const d = await preVuelo(sindicato, fechasPorPlaca);

    // Los PIN generados van SOLO al archivo: sin archivo no se escribe nada (ni en dry-run se calla).
    const pinesPorFijar = d.pilotos.filter((p) => (!p.conductor || RESET_CREDENCIALES) && !(p.def === PILOTO_1 && process.env.QUIVO_PILOTO16_PIN?.trim()));
    if (pinesPorFijar.length > 0 && !rutaCreds) {
      throw new ErrorApi(
        `Hay ${pinesPorFijar.length} PIN de conductor por generar (${pinesPorFijar.map((p) => p.def.placa).join(', ')}) y falta QUIVO_PILOTO16_CREDS_FILE (ruta absoluta fuera del repo): los PIN no se imprimen por stdout.`,
      );
    }

    const socioId = await sincronizarSocio(d);
    const ids: IdsPiloto[] = [];
    let rotacionId: string;
    if (d.accion === 'crear') {
      // generar() reparte entre TODOS los activos: antes de llamarlo solo existe el piloto 1.
      ids.push(await sincronizarPiloto(d, d.pilotos[0]!, socioId));
      console.log(`\n--- Rotación '${PERIODO}' (POST /v1/rotaciones: generar) ---`);
      const g = await crearRotacionConGenerar(d, d.pilotos[0]!.fechas, ids[0]!.vehiculoId);
      for (const p of d.pilotos.slice(1)) ids.push(await sincronizarPiloto(d, p, socioId));
      rotacionId = g.rotacionId;
      await completarYPublicar(d, rotacionId, g.existentes, ids, false);
    } else {
      for (const p of d.pilotos) ids.push(await sincronizarPiloto(d, p, socioId));
      rotacionId = await sincronizarRotacion(d, ids);
    }

    if (APLICAR) {
      await verificar(sindicato, d.rutaId!, rotacionId, d.pilotos);
      console.log(`\nOK. ${escriturasEjecutadas} escritura(s) ejecutada(s).`);
      if (pinesConductor.size > 0) console.log(`PIN de ${pinesConductor.size} conductor(es) guardados en ${rutaCreds} (modo 0600); no se imprimen.`);
      console.log('\n' + '!'.repeat(90) + '\n' + ADVERTENCIA_ROTACIONES + '\n' + '!'.repeat(90));
    } else {
      console.log(`\nDRY-RUN: ${escriturasPlaneadas} escritura(s) planeada(s), 0 enviadas. Para aplicar: agregar --apply.`);
    }
  } catch (err) {
    console.error('\nAbortado.');
    console.error(err instanceof Error ? err.message : err);
    if (rotacionEnBorrador) console.error('\n' + bannerBorrador(rotacionEnBorrador));
    console.error(`(escrituras ejecutadas antes del error: ${escriturasEjecutadas}; el script es idempotente: re-correr para completar)`);
    process.exitCode = 1;
  }
}

// Ctrl+C con la rotación anulada: no se puede publicar de forma fiable desde el handler; avisar fuerte.
process.on('SIGINT', () => {
  if (rotacionEnBorrador) console.error('\n' + bannerBorrador(rotacionEnBorrador));
  process.exit(130);
});

void main();
