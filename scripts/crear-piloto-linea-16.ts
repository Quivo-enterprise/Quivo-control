/**
 * Crea el **piloto de la línea 16** en el sindicato piloto de producción, **hablando SOLO con la
 * API HTTP pública** (nunca con la base: Cloud SQL es de IP privada). Mismo patrón que
 * `sembrar-piloto-produccion.ts` / `cargar-linea-16.ts`: login de admin por variables de entorno
 * (fail-closed), 401 aborta, 429 con reintento, idempotente por lookups (los ids los pone el
 * servidor), pre-vuelo de SOLO LECTURA que aborta antes de la primera escritura si el estado es
 * inesperado, y verificación final de solo lectura. **Dry-run por defecto**: login + GETs, imprime
 * las escrituras que haría y NO escribe nada. `--apply` escribe.
 *
 * ## ⚠ ADVERTENCIA — LEER ANTES DE GENERAR OTRAS ROTACIONES
 *
 * Mientras el vehículo `1616PIL` y el conductor piloto estén ACTIVOS, cualquier `POST /rotaciones`
 * (generar) que se lance desde el panel para este sindicato los incluirá en el reparto round-robin.
 * Al terminar el piloto (2026-10-26) —o antes de generar otras rotaciones— correr:
 *     tsx scripts/crear-piloto-linea-16.ts --desactivar --apply
 * (deja inactivos el vehículo, el conductor y el socio placeholder).
 *
 * Nota: cliente HTTP, geometría y login están duplicados a propósito con los otros scripts
 * standalone de `scripts/` (extraer un `scripts/lib` queda fuera de alcance).
 *
 * ## Qué crea (todo en el sindicato "Sindicato Piloto — Producción")
 *
 *   0. Un **socio** placeholder (propietario del vehículo).
 *   1. Un **vehículo** `1616PIL` (placa PTA válida: 4 dígitos + 3 letras; "1616" + "PIL"oto),
 *      `estado` activo. El esquema exige tipo/marca/modelo/color/capacidad; NO se inventan datos
 *      reales: tipo `otro` (el tipo real del móvil de la 16 no está confirmado; `otro` exige
 *      admin_quivo, que es quien corre esto), marca `Piloto`, modelo `Linea 16 piloto`, color `otro`,
 *      capacidad 12 (> 0; es un placeholder, NO un dato del vehículo). Con un socio propietario placeholder "Socio Piloto Línea Dieciséis" (CI `9000116 CB`): la API exige socio para activar un vehículo.
 *      Cuando haya un móvil real, editar esos campos desde el panel.
 *   2. Un **conductor** "Piloto Línea Dieciséis" (CI sintético `9000016 CB`, licencia
 *      `LIC-9000016`). El nombre NO lleva "16" en dígitos: `NombrePersonaSchema` rechaza números.
 *   3. **Credencial móvil**: el login móvil vigente es de UN paso (`POST /mobile/auth/sesion`):
 *      placa + **PIN del CONDUCTOR** (+ deviceId). El vehículo NO tiene contraseña: solo un PIN de
 *      6-12 dígitos que únicamente usa el login LEGADO (`MOBILE_LEGACY_AUTH_ENABLED`). Por eso, por
 *      default solo se fija el PIN del conductor (`PUT /mobile/credenciales/conductores/:id`); el
 *      PIN del vehículo se fija solo con `--pin-vehiculo`. Para entrar a la app: placa `1616PIL` +
 *      el PIN del conductor.
 *   4. Una **rotación** (periodo `piloto-linea-16`) con una asignación por día, horario `manana`,
 *      vehículo 1616PIL + conductor piloto + la ruta `circuito` de la línea 16, desde
 *      `QUIVO_PILOTO16_DESDE` (default 2026-10-13) hasta `QUIVO_PILOTO16_HASTA` (default
 *      2026-10-26), ambos inclusive = 14 días. Queda **publicada** (el login exige rotación
 *      publicada); `horaSalida`/`horaPresentacion` quedan null.
 *
 * ## Por qué `POST /rotaciones` (generar) y qué riesgo tiene
 *
 * La API NO permite crear una rotación vacía: `POST /rotaciones` es `generar()` y SIEMPRE reparte
 * round-robin entre TODOS los vehículos activos del sindicato. Este script lo usa con UNA fecha, UN
 * horario y UNA ruta (= exactamente 1 asignación) y espera que el vehículo elegido sea `1616PIL`
 * (primero por `placa asc`). El pre-vuelo solo AVISA si cree que otro ordena antes (pista de mejor
 * esfuerzo: `GET /vehiculos` omite filas corruptas y el orden de Postgres puede diferir del de JS).
 * LA RED DE SEGURIDAD es posterior: si `generar` devuelve algo distinto de exactamente 1 asignación de
 * `1616PIL`, se BORRAN todas las que creó (la rotación es borrador y no tienen sesiones), se verifica
 * por GET que no quedó ninguna y se aborta sin publicar (la API no tiene DELETE de rotaciones: queda
 * un borrador vacío, inofensivo, que una corrida posterior reutiliza). El conductor que `generar` le
 * pone (el primero por nombre) se corrige con `PATCH`. El resto de los días entra con
 * `POST /rotaciones/:id/asignaciones`. Es una rotación NUEVA y separada de la del piloto de 6 vehículos.
 * Una rotación propia YA PUBLICADA nunca se reescribe: si difiere del plan, se informa y se aborta.
 *
 * ## Idempotencia (por lookups)
 *
 *   Socio: por CI dentro del sindicato. Sindicato: `QUIVO_SINDICATO_ID` o nombre (`QUIVO_SINDICATO_NOMBRE`, default "Sindicato Piloto —
 *   Producción"). Línea: código '16' + única ruta `circuito` activa. Vehículo: por placa
 *   normalizada (`GET /vehiculos` + `GET /vehiculos/verificar-placa` para otros sindicatos).
 *   Conductor: por CI dentro del sindicato. Rotación: por `periodo`. Asignaciones: por
 *   (vehículo, fecha, horario). Re-correr con todo ya creado = 0 escrituras. Los PIN NO se
 *   regeneran si el conductor ya existía, salvo `--reset-credenciales` (rotar un PIN revoca sus
 *   sesiones activas). La API no expone si un conductor tiene PIN: si una corrida anterior murió
 *   entre crear el conductor y fijar su PIN, usar `--reset-credenciales`.
 *   Lo que sobra (asignaciones fuera del rango) solo se REPORTA: nunca se borra (el DELETE duro de
 *   una asignación con sesión devuelve 500, ver handoff).
 *
 * ## Cómo se corre (nombres de variables; los valores salen de Secret Manager, nunca se imprimen)
 *
 *   La raíz no tiene tsx: usar `packages/db/node_modules/.bin/tsx`. Proyecto GCP: quivo-control-prod.
 *     export QUIVO_ADMIN_EMAIL="$(gcloud secrets versions access latest --secret=QUIVO_PANEL_ADMIN_EMAIL --project=quivo-control-prod)"
 *     export QUIVO_ADMIN_PASSWORD="$(gcloud secrets versions access latest --secret=SEED_ADMIN_PASSWORD --project=quivo-control-prod)"
 *     export QUIVO_PILOTO16_CREDS_FILE="$HOME/.quivo-piloto16-creds"          # opcional, FUERA del repo
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
 *   QUIVO_PILOTO16_PIN         Opcional. PIN del conductor (6-12 dígitos). Si falta, se genera uno de
 *                              8 dígitos con node:crypto.
 *   QUIVO_PILOTO16_VEHICULO_PIN  Opcional, solo con --pin-vehiculo. Si falta, se genera.
 *   QUIVO_PILOTO16_CREDS_FILE  Opcional. Ruta ABSOLUTA fuera del repo donde guardar (modo 0600) las
 *                              credenciales generadas en esta corrida.
 *   QUIVO_PILOTO16_DESDE / QUIVO_PILOTO16_HASTA   Opcionales, YYYY-MM-DD (default 2026-10-13 / 2026-10-26).
 *
 * Las credenciales nuevas se imprimen UNA vez al final de un `--apply` (nunca en dry-run).
 */

import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================================================
// Constantes del piloto
// ============================================================================================

const NOMBRE_SINDICATO_DEFAULT = 'Sindicato Piloto — Producción';
const LINEA_CODIGO = '16';
const SENTIDO_RUTA = 'circuito';

const PLACA = '1616PIL';
const VEHICULO = {
  tipo: 'otro',
  marca: 'Piloto',
  modelo: 'Linea 16 piloto',
  color: 'otro',
  colorSecundario: null,
  capacidad: 12,
} as const;

/** Socio propietario placeholder: la API EXIGE un socio para activar un vehículo ("No se puede
 * activar el vehículo. Revisa: socio propietario"). CI sintético distinto al del conductor. */
const SOCIO = {
  nombre: 'Socio Piloto Línea Dieciséis',
  documentoIdentidad: '9000116 CB',
} as const;

const CONDUCTOR = {
  nombre: 'Piloto Línea Dieciséis',
  documentoIdentidad: '9000016 CB',
  licenciaConducir: 'LIC-9000016',
} as const;

const PERIODO = 'piloto-linea-16';
const HORARIO = 'manana';
const DESDE_DEFAULT = '2026-10-13';
const HASTA_DEFAULT = '2026-10-26';
const MAX_DIAS = 60;

const PIN_REGEX = /^\d{6,12}$/;
const PENDIENTE = 'PENDIENTE';
const CONCURRENCIA_ESCANEO = 4;

// ============================================================================================
// CLI y entorno (fail-closed)
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');
const RESET_CREDENCIALES = argv.includes('--reset-credenciales');
const PIN_VEHICULO = argv.includes('--pin-vehiculo');
const DESACTIVAR = argv.includes('--desactivar');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=… QUIVO_ADMIN_PASSWORD=… [QUIVO_API_URL=…] tsx scripts/crear-piloto-linea-16.ts [opciones]

Opciones:
  --apply                Escribe vía la API. Sin esto: dry-run (login + GETs, NO escribe).
  --reset-credenciales   Re-fija el PIN del conductor aunque ya exista (revoca sus sesiones activas).
  --pin-vehiculo         También fija el PIN del vehículo (solo lo usa el login legado).
  --desactivar           Fin del piloto: deja inactivos vehículo, conductor y socio placeholder (no crea nada).
  --help                 Esta ayuda.

Opcionales: QUIVO_SINDICATO_ID, QUIVO_SINDICATO_NOMBRE, QUIVO_PILOTO16_PIN, QUIVO_PILOTO16_VEHICULO_PIN,
QUIVO_PILOTO16_CREDS_FILE, QUIVO_PILOTO16_DESDE, QUIVO_PILOTO16_HASTA. Ver la cabecera del archivo.
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

function fechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function calcularFechas(): string[] {
  const desde = (process.env.QUIVO_PILOTO16_DESDE ?? '').trim() || DESDE_DEFAULT;
  const hasta = (process.env.QUIVO_PILOTO16_HASTA ?? '').trim() || HASTA_DEFAULT;
  if (!fechaValida(desde) || !fechaValida(hasta)) fallar(`QUIVO_PILOTO16_DESDE/HASTA deben ser YYYY-MM-DD válidas (${desde} / ${hasta}).`);
  if (desde > hasta) fallar(`QUIVO_PILOTO16_DESDE (${desde}) es posterior a HASTA (${hasta}).`);
  const fechas: string[] = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    fechas.push(f);
    if (fechas.length > MAX_DIAS) fallar(`El rango supera ${MAX_DIAS} días.`);
  }
  return fechas;
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
// Credenciales generadas en esta corrida (se imprimen UNA vez al final de un --apply)
// ============================================================================================

interface CredencialesNuevas {
  placa: string;
  pinConductor?: { valor: string; origen: 'generado' | 'env' };
  pinVehiculo?: { valor: string; origen: 'generado' | 'env' };
}
const credencialesNuevas: CredencialesNuevas = { placa: PLACA };
let rutaCreds: string | undefined;
let credsImpresas = false;

function guardarCredsEnArchivo(): void {
  if (!APLICAR || !rutaCreds) return;
  // Abre (o crea) con 0600, fchmod ANTES de escribir, y fusiona con lo que ya había.
  const fd = fs.openSync(rutaCreds, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    const previo = fs.readFileSync(fd, 'utf8');
    const claves = new Map<string, string>();
    for (const linea of previo.split('\n')) {
      const m = /^([a-z_]+)=(.*)$/.exec(linea.trim());
      if (m) claves.set(m[1]!, m[2]!);
    }
    claves.set('placa', credencialesNuevas.placa);
    if (credencialesNuevas.pinConductor) claves.set('pin_conductor', credencialesNuevas.pinConductor.valor);
    if (credencialesNuevas.pinVehiculo) claves.set('pin_vehiculo', credencialesNuevas.pinVehiculo.valor);
    claves.set('actualizado', new Date().toISOString());
    const salida = `# Piloto línea 16 — credenciales móviles\n` + [...claves].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, salida, 0);
  } finally {
    fs.closeSync(fd);
  }
  console.log(`  Credenciales guardadas en ${rutaCreds} (modo 0600).`);
}

function imprimirCredenciales(): void {
  if (!APLICAR || credsImpresas) return;
  if (!credencialesNuevas.pinConductor && !credencialesNuevas.pinVehiculo) return;
  credsImpresas = true;
  console.log('\n' + '#'.repeat(90));
  console.log('# CREDENCIALES MÓVILES — SE MUESTRAN UNA SOLA VEZ (la API solo guarda el hash). Anotarlas ahora.');
  console.log(`#   placa:           ${credencialesNuevas.placa}`);
  if (credencialesNuevas.pinConductor) {
    const c = credencialesNuevas.pinConductor;
    console.log(`#   PIN conductor:   ${c.origen === 'env' ? '(el provisto por QUIVO_PILOTO16_PIN)' : c.valor}`);
  }
  if (credencialesNuevas.pinVehiculo) {
    const c = credencialesNuevas.pinVehiculo;
    console.log(`#   PIN vehículo:    ${c.origen === 'env' ? '(el provisto por QUIVO_PILOTO16_VEHICULO_PIN)' : c.valor} (solo login legado)`);
  }
  console.log('#   Login en la app: placa + PIN del conductor.');
  console.log('#'.repeat(90));
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

/** Diferencias entre las asignaciones existentes del piloto y el plan (rango completo, mismo
 * conductor/ruta/horario). Vacío = coincide. */
function diferenciasRotacion(
  existentes: AsignacionApi[],
  fechas: string[],
  vehiculoId: string | undefined,
  conductorId: string | undefined,
  rutaId: string | null,
): string[] {
  const dif: string[] = [];
  const propias = existentes.filter((a) => a.vehiculoId === vehiculoId);
  const porFecha = new Map(propias.map((a) => [fechaDe(a), a]));
  const faltan = fechas.filter((f) => !porFecha.has(f));
  if (faltan.length > 0) dif.push(`faltan ${faltan.length} día(s): ${faltan.join(', ')}`);
  for (const f of fechas) {
    const a = porFecha.get(f);
    if (!a) continue;
    if (!conductorId || a.conductorId !== conductorId) dif.push(`${f}: conductor distinto al piloto (${a.conductorId})`);
    if (rutaId && a.rutaId !== rutaId) dif.push(`${f}: ruta distinta (${a.rutaId})`);
    if (a.horario !== HORARIO) dif.push(`${f}: horario '${a.horario}' en vez de '${HORARIO}'`);
  }
  const fuera = propias.filter((a) => !fechas.includes(fechaDe(a)));
  if (fuera.length > 0) dif.push(`${fuera.length} asignación(es) fuera del rango (${fuera.map(fechaDe).join(', ')})`);
  return dif;
}

// ============================================================================================
// Pre-vuelo: SOLO lecturas. Descubre el estado y aborta ante cualquier cosa inesperada.
// ============================================================================================

interface Descubierto {
  sindicato: SindicatoApi;
  rutaId: string | null;
  vehiculo: VehiculoApi | null;
  socio: SocioApi | null;
  conductor: ConductorApi | null;
  rotacion: RotacionConAsignaciones | null;
}

async function preVuelo(sindicato: SindicatoApi, fechas: string[]): Promise<Descubierto> {
  console.log('\n--- Pre-vuelo (solo lecturas, antes de cualquier escritura) ---');
  const rutaId = await resolverRuta16(sindicato);
  if (!rutaId && APLICAR) throw new ErrorApi('No se puede aplicar sin la ruta circuito de la línea 16 (cargarla primero con scripts/cargar-linea-16.ts --apply).');

  // --- Vehículo ---
  const vehiculos = await leer<VehiculoApi[]>('/vehiculos');
  const placaV = await leer<VerificarPlacaApi>(`/vehiculos/verificar-placa?placa=${encodeURIComponent(PLACA)}`);
  if (placaV.coincidencia && placaV.coincidencia.sindicatoId !== sindicato.id) {
    throw new ErrorApi(`La placa ${PLACA} ya la usa un vehículo vigente de OTRO sindicato ("${placaV.coincidencia.sindicatoNombre}"). Abortando.`);
  }
  const propios = vehiculos.filter((v) => v.sindicatoId === sindicato.id && v.placaNormalizada === PLACA);
  const otrosSindicatos = vehiculos.filter((v) => v.sindicatoId !== sindicato.id && v.placaNormalizada === PLACA && v.estado !== 'inactivo');
  if (otrosSindicatos.length > 0) throw new ErrorApi(`La placa ${PLACA} ya existe vigente en otro sindicato (${otrosSindicatos[0]!.id}). Abortando.`);
  if (propios.length > 1) throw new ErrorApi(`Hay ${propios.length} vehículos con placa ${PLACA} en el sindicato; resolver a mano.`);
  const vehiculo = propios[0] ?? null;
  if (vehiculo) {
    if (vehiculo.estado !== 'activo' && vehiculo.estado !== 'pendiente') {
      throw new ErrorApi(`El vehículo ${PLACA} (${vehiculo.id}) está '${vehiculo.estado}'; no se reactiva solo. Resolver a mano.`);
    }
    console.log(`  Vehículo ${PLACA}: ya existe (${vehiculo.id}, ${vehiculo.estado}).`);
  } else {
    console.log(`  Vehículo ${PLACA}: no existe (placa disponible: ${placaV.disponible}).`);
  }

  // --- Socio propietario (placeholder; la API lo exige para activar el vehículo) ---
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
  if (vehiculo && vehiculo.socioId && (!socio || vehiculo.socioId !== socio.id)) {
    throw new ErrorApi(`El vehículo ${PLACA} tiene otro socio (${vehiculo.socioId}); resolver a mano.`);
  }

  // --- Conductor ---
  const conductores = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id);
  const porDoc = conductores.filter((c) => c.documentoIdentidad.toUpperCase() === CONDUCTOR.documentoIdentidad);
  const porNombre = conductores.filter((c) => c.nombre === CONDUCTOR.nombre);
  if (porDoc.length > 1 || porNombre.length > 1) throw new ErrorApi('Conductor piloto ambiguo (CI o nombre duplicados); resolver a mano.');
  const conductor = porDoc[0] ?? null;
  if (!conductor && porNombre[0]) {
    throw new ErrorApi(`Existe un conductor "${CONDUCTOR.nombre}" (${porNombre[0].id}) con otro CI (${porNombre[0].documentoIdentidad}); resolver a mano.`);
  }
  if (conductor && conductor.nombre !== CONDUCTOR.nombre) {
    throw new ErrorApi(`El CI ${CONDUCTOR.documentoIdentidad} pertenece a "${conductor.nombre}" (${conductor.id}), no al conductor piloto. Abortando.`);
  }
  if (conductor && conductor.estado !== 'activo') throw new ErrorApi(`El conductor piloto (${conductor.id}) está '${conductor.estado}'; resolver a mano.`);
  console.log(conductor ? `  Conductor: ya existe (${conductor.id}).` : '  Conductor: no existe.');
  if (RESET_CREDENCIALES && !conductor && APLICAR) {
    console.log('  (--reset-credenciales: el conductor se crea ahora, su PIN se fija igual.)');
  }

  // --- Rotaciones: la propia (por periodo) + ocupación de ESTE vehículo en otras ---
  const rotaciones = (await leer<RotacionApi[]>('/rotaciones')).filter((r) => r.sindicatoId === sindicato.id);
  const propiasRot = rotaciones.filter((r) => r.periodo === PERIODO);
  if (propiasRot.length > 1) throw new ErrorApi(`Hay ${propiasRot.length} rotaciones con periodo '${PERIODO}'; ambiguo.`);
  let rotacion: RotacionConAsignaciones | null = null;
  if (propiasRot[0]) {
    rotacion = await leer<RotacionConAsignaciones>(`/rotaciones/${propiasRot[0].id}`);
    const ajenas = rotacion.asignaciones.filter((a) => !vehiculo || a.vehiculoId !== vehiculo.id);
    if (ajenas.length > 0) {
      throw new ErrorApi(`La rotación '${PERIODO}' (${rotacion.id}) tiene ${ajenas.length} asignación(es) de OTROS vehículos; inesperado. Resolver a mano.`);
    }
    console.log(`  Rotación '${PERIODO}': ya existe (${rotacion.id}, ${rotacion.estado}, ${rotacion.asignaciones.length} asignación(es)).`);
  } else {
    console.log(`  Rotación '${PERIODO}': no existe.`);
  }
  if (vehiculo) {
    const fechasSet = new Set(fechas);
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
        const n = det.asignaciones.filter((a) => a.vehiculoId === vehiculo.id && a.horario === HORARIO && fechasSet.has(fechaDe(a))).length;
        if (n > 0) choquesTotales.push(`${n} en ${r.id} ('${r.periodo}')`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_ESCANEO, aEscanear.length) }, trabajador));
    if (choquesTotales.length > 0) {
      throw new ErrorApi(`El vehículo ${PLACA} ya tiene asignaciones '${HORARIO}' en el rango en OTRA(S) rotación(es): ${choquesTotales.join('; ')}. Abortando.`);
    }
  }

  // --- Rotación propia YA PUBLICADA: nunca se reescribe. Si difiere del plan, se informa y se aborta ---
  if (rotacion && rotacion.estado === 'publicada') {
    const dif = diferenciasRotacion(rotacion.asignaciones, fechas, vehiculo?.id, conductor?.id, rutaId);
    if (dif.length > 0) {
      throw new ErrorApi(
        `La rotación '${PERIODO}' (${rotacion.id}) ya está PUBLICADA y difiere del plan; este script NO la reescribe (decide el operador):\n  - ` +
          dif.join('\n  - '),
      );
    }
  }

  // --- generar() reparte entre TODOS los vehículos activos. Esto es solo una PISTA de mejor esfuerzo
  // (GET /vehiculos omite filas corruptas y el orden de Postgres puede diferir del de JS): la red de
  // seguridad real es la limpieza posterior a generar() en sincronizarRotacion. ---
  if (!rotacion) {
    const otrosActivos = vehiculos.filter((v) => v.sindicatoId === sindicato.id && v.estado === 'activo' && v.placaNormalizada !== PLACA);
    const antes = otrosActivos.filter((v) => v.placa.toUpperCase() < PLACA);
    if (antes.length > 0) {
      console.warn(
        `  AVISO: generar() podría elegir primero a otro vehículo activo (${antes.map((v) => v.placa).join(', ')}) en vez de ${PLACA}. ` +
          'Si pasa, el script borra lo que generar() haya creado y aborta (no queda ninguna asignación).',
      );
    } else {
      console.log(`  Pista: ${PLACA} ordena antes que los ${otrosActivos.length} vehículo(s) activo(s) visibles (best-effort; la limpieza post-generar es la red de seguridad).`);
    }
  }

  return { sindicato, rutaId, vehiculo, socio, conductor, rotacion };
}

// ============================================================================================
// Sincronización (escrituras)
// ============================================================================================

async function sincronizarVehiculo(d: Descubierto): Promise<string> {
  console.log('\n--- Socio y vehículo (POST /v1/socios, POST /v1/vehiculos, PATCH /v1/vehiculos/:id[/estado]) ---');
  let socioId: string;
  if (d.socio) {
    socioId = d.socio.id;
    console.log(`  Socio propietario ya existe (${socioId}).`);
  } else {
    const creado = await escribir<SocioApi>('POST', '/socios', { sindicatoId: d.sindicato.id, ...SOCIO });
    socioId = creado?.id ?? PENDIENTE;
  }
  let id: string;
  if (d.vehiculo) {
    id = d.vehiculo.id;
    if (!d.vehiculo.socioId) await escribir('PATCH', `/vehiculos/${id}`, { socioId });
    if (d.vehiculo.estado === 'pendiente') await escribir('PATCH', `/vehiculos/${id}/estado`, { estado: 'activo' });
    else console.log(`  ${PLACA} ya existe y está activo (${id}).`);
    return id;
  }
  const creado = await escribir<VehiculoApi>('POST', '/vehiculos', { sindicatoId: d.sindicato.id, socioId, placa: PLACA, ...VEHICULO });
  id = creado?.id ?? PENDIENTE;
  await escribir('PATCH', `/vehiculos/${id}/estado`, { estado: 'activo' });
  return id;
}

async function sincronizarConductor(d: Descubierto): Promise<string> {
  console.log('\n--- Conductor (POST /v1/conductores) ---');
  if (d.conductor) {
    console.log(`  Ya existe (${d.conductor.id}).`);
    return d.conductor.id;
  }
  const creado = await escribir<ConductorApi>('POST', '/conductores', { sindicatoId: d.sindicato.id, ...CONDUCTOR });
  return creado?.id ?? PENDIENTE;
}

async function sincronizarCredenciales(d: Descubierto, vehiculoId: string, conductorId: string): Promise<void> {
  console.log('\n--- Credenciales móviles (PUT /v1/mobile/credenciales/...) ---');
  const conductorNuevo = !d.conductor;
  const fijarConductor = conductorNuevo || RESET_CREDENCIALES;
  if (fijarConductor) {
    const envPin = leerPinEnv('QUIVO_PILOTO16_PIN');
    const pin = envPin ?? generarPin();
    await escribir('PUT', `/mobile/credenciales/conductores/${conductorId}`, { pin });
    if (APLICAR) {
      credencialesNuevas.pinConductor = { valor: pin, origen: envPin ? 'env' : 'generado' };
      guardarCredsEnArchivo(); // de inmediato: si algo falla después, el PIN ya no se pierde
    }
  } else {
    console.log('  El conductor ya existía: PIN NO se toca (usar --reset-credenciales para rotarlo; revoca sus sesiones activas).');
  }
  if (PIN_VEHICULO) {
    if (!d.vehiculo || RESET_CREDENCIALES) {
      const envPin = leerPinEnv('QUIVO_PILOTO16_VEHICULO_PIN');
      const pin = envPin ?? generarPin();
      await escribir('PUT', `/mobile/credenciales/vehiculos/${vehiculoId}`, { pin });
      if (APLICAR) {
        credencialesNuevas.pinVehiculo = { valor: pin, origen: envPin ? 'env' : 'generado' };
        guardarCredsEnArchivo();
      }
    } else {
      console.log('  El vehículo ya existía: su PIN NO se toca (usar --reset-credenciales).');
    }
  } else {
    console.log('  PIN del vehículo: no se fija (el login vigente de un paso solo usa el PIN del conductor; --pin-vehiculo para el login legado).');
  }
}

async function sincronizarRotacion(d: Descubierto, fechas: string[], vehiculoId: string, conductorId: string): Promise<string> {
  console.log(`\n--- Rotación '${PERIODO}' y asignaciones (POST /v1/rotaciones, /asignaciones, /publicar) ---`);
  const rutaId = d.rutaId ?? PENDIENTE;
  let rotacionId: string;
  let existentes: AsignacionApi[];

  if (d.rotacion) {
    rotacionId = d.rotacion.id;
    existentes = d.rotacion.asignaciones;
    if (d.rotacion.estado === 'publicada') {
      // El pre-vuelo ya abortó si difería del plan: acá solo queda "sin cambios". Nunca se reescribe.
      console.log(`  Rotación ya publicada y coincide con el plan (${existentes.length} asignación(es)): sin cambios.`);
      return rotacionId;
    }
    console.log('  Rotación en borrador (corrida anterior incompleta): se completa y se publica.');
  } else {
    // generar(): 1 fecha, 1 horario, 1 ruta = lo esperado es exactamente 1 asignación.
    const generada = await escribir<RotacionConAsignaciones>('POST', '/rotaciones', {
      sindicatoId: d.sindicato.id,
      periodo: PERIODO,
      rutaIds: [rutaId],
      fechas: [fechas[0]],
      horarios: [HORARIO],
    });
    rotacionId = generada?.id ?? PENDIENTE;
    existentes = [];
    if (generada) {
      const as = generada.asignaciones;
      const ok = as.length === 1 && as[0]!.vehiculoId === vehiculoId && as[0]!.rutaId === rutaId && fechaDe(as[0]!) === fechas[0];
      if (!ok) await limpiarGenerarInesperado(generada.id, as);
      existentes = as;
    } else {
      // Dry-run: generar() NO se manda, pero dejaría la asignación de la primera fecha con el
      // conductor equivocado (el primero por nombre). Se simula para mostrar el PATCH.
      existentes = [
        { id: PENDIENTE, rotacionId, vehiculoId, conductorId: null, rutaId, fecha: fechas[0]!, horario: HORARIO, estado: 'vigente' },
      ];
    }
  }

  const porFecha = new Map(existentes.map((a) => [fechaDe(a), a]));
  const faltan = fechas.filter((f) => !porFecha.has(f));
  const corregir = existentes.filter(
    (a) => fechas.includes(fechaDe(a)) && (a.conductorId !== conductorId || a.rutaId !== rutaId || a.horario !== HORARIO),
  );
  const fuera = existentes.filter((a) => !fechas.includes(fechaDe(a)));
  if (fuera.length > 0) {
    console.warn(`  AVISO: ${fuera.length} asignación(es) fuera del rango (${fuera.map(fechaDe).join(', ')}): NO se tocan (nunca se borra).`);
  }
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
      orden: fechas.indexOf(f) + 1,
    });
  }
  await escribir('POST', `/rotaciones/${rotacionId}/publicar`);
  return rotacionId;
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
    `generar() no eligió a ${PLACA} como único vehículo (el orden de reparto no era el supuesto). ${msg} Nada se publicó. Abortando.`,
  );
}

// ============================================================================================
// Verificación final (solo lecturas)
// ============================================================================================

async function verificar(sindicato: SindicatoApi, rutaId: string, fechas: string[], rotacionId: string): Promise<void> {
  console.log('\n--- Verificación final (solo lecturas) ---');
  const vehiculos = (await leer<VehiculoApi[]>('/vehiculos')).filter((v) => v.sindicatoId === sindicato.id && v.placaNormalizada === PLACA);
  if (vehiculos.length !== 1 || vehiculos[0]!.estado !== 'activo') throw new Error(`Vehículo ${PLACA}: se esperaba 1 activo, hay ${vehiculos.length} (${vehiculos[0]?.estado}).`);
  const veh = vehiculos[0]!;
  console.log(`  Vehículo ${PLACA}: ${veh.id}, activo.`);

  const conductores = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id && c.documentoIdentidad.toUpperCase() === CONDUCTOR.documentoIdentidad);
  if (conductores.length !== 1 || conductores[0]!.estado !== 'activo') throw new Error(`Conductor piloto: se esperaba 1 activo, hay ${conductores.length}.`);
  const cond = conductores[0]!;
  console.log(`  Conductor "${cond.nombre}": ${cond.id}, activo.`);

  const rot = await leer<RotacionConAsignaciones>(`/rotaciones/${rotacionId}`);
  if (rot.estado !== 'publicada') throw new Error(`La rotación ${rot.id} está '${rot.estado}', no 'publicada'.`);
  const propias = rot.asignaciones.filter((a) => a.vehiculoId === veh.id);
  const esperadas = new Set(fechas);
  const dentro = propias.filter((a) => esperadas.has(fechaDe(a)));
  if (dentro.length !== fechas.length || new Set(dentro.map(fechaDe)).size !== fechas.length) {
    throw new Error(`Asignaciones del piloto en el rango: ${dentro.length}, esperadas ${fechas.length} (una por día).`);
  }
  // Hoy en America/La_Paz (UTC-4): una asignación de un día PASADO puede estar 'vencida' (cron
  // marcarVencidas); de hoy en adelante debe seguir 'vigente'.
  const hoyBo = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
  const estadoOk = (a: AsignacionApi): boolean => (fechaDe(a) < hoyBo ? a.estado === 'vigente' || a.estado === 'vencida' : a.estado === 'vigente');
  const malas = dentro.filter((a) => a.conductorId !== cond.id || a.rutaId !== rutaId || a.horario !== HORARIO || !estadoOk(a));
  if (malas.length > 0) throw new Error(`${malas.length} asignación(es) con conductor/ruta/horario/estado incorrectos (${malas.map(fechaDe).join(', ')}).`);
  const ajenas = rot.asignaciones.filter((a) => a.vehiculoId !== veh.id);
  if (ajenas.length > 0) throw new Error(`La rotación tiene ${ajenas.length} asignación(es) de otros vehículos.`);
  console.log(`  Rotación ${rot.id}: publicada, ${dentro.length} asignaciones ${HORARIO} (${fechas[0]} … ${fechas[fechas.length - 1]}) con la ruta ${rutaId}.`);
  console.log('  Credenciales: la API no expone si hay PIN fijado (solo guarda el hash); un login móvil crearía una sesión, por eso NO se prueba acá.');
}

// ============================================================================================
// main
// ============================================================================================

const ADVERTENCIA_ROTACIONES =
  `ADVERTENCIA: mientras el vehículo ${PLACA} y el conductor piloto estén ACTIVOS, cualquier POST /rotaciones (generar) lanzado desde el panel para este ` +
  'sindicato los incluirá en el reparto. Cuando termine el piloto (2026-10-26) o antes de generar otras rotaciones, correr:\n' +
  '    tsx scripts/crear-piloto-linea-16.ts --desactivar --apply';

/** Fin del piloto: deja inactivos vehículo, conductor y socio placeholder. Idempotente, no crea nada. */
async function desactivar(sindicato: SindicatoApi): Promise<void> {
  console.log('\n--- Desactivar piloto (PATCH estado → inactivo) ---');
  const veh = (await leer<VehiculoApi[]>('/vehiculos')).find((v) => v.sindicatoId === sindicato.id && v.placaNormalizada === PLACA);
  const cond = (await leer<ConductorApi[]>('/conductores')).find((c) => c.sindicatoId === sindicato.id && c.documentoIdentidad.toUpperCase() === CONDUCTOR.documentoIdentidad && c.nombre === CONDUCTOR.nombre);
  const soc = (await leer<SocioApi[]>('/socios')).find((x) => x.sindicatoId === sindicato.id && x.documentoIdentidad.toUpperCase() === SOCIO.documentoIdentidad && x.nombre === SOCIO.nombre);
  if (!veh && !cond && !soc) console.log('  No existe nada del piloto: nada que desactivar.');
  if (veh) {
    if (veh.estado === 'inactivo') console.log(`  Vehículo ${PLACA}: ya inactivo.`);
    else await escribir('PATCH', `/vehiculos/${veh.id}/estado`, { estado: 'inactivo', motivo: 'Fin del piloto línea 16' });
  }
  if (cond) {
    if (cond.estado === 'inactivo') console.log('  Conductor piloto: ya inactivo.');
    else await escribir('PATCH', `/conductores/${cond.id}`, { estado: 'inactivo' });
  }
  if (soc) {
    if (soc.estado === 'inactivo') console.log('  Socio placeholder: ya inactivo.');
    else await escribir('PATCH', `/socios/${soc.id}`, { estado: 'inactivo' });
  }
  if (APLICAR) {
    const v2 = (await leer<VehiculoApi[]>('/vehiculos')).find((v) => v.sindicatoId === sindicato.id && v.placaNormalizada === PLACA);
    const c2 = (await leer<ConductorApi[]>('/conductores')).find((c) => c.id === cond?.id);
    const s2 = (await leer<SocioApi[]>('/socios')).find((x) => x.id === soc?.id);
    if ((veh && v2?.estado !== 'inactivo') || (cond && c2?.estado !== 'inactivo') || (soc && s2?.estado !== 'inactivo')) {
      throw new Error('Verificación: vehículo/conductor/socio del piloto no quedaron inactivos.');
    }
    console.log('  Verificado por GET: vehículo, conductor y socio del piloto inactivos.');
  }
  console.log('  Las asignaciones ya creadas no se borran (el login exige vehículo y conductor activos).');
}

async function main(): Promise<void> {
  API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL || 'https://quivo-api-741758083365.southamerica-west1.run.app');
  requerirEnv('QUIVO_ADMIN_EMAIL');
  requerirEnv('QUIVO_ADMIN_PASSWORD');
  const fechas = calcularFechas();
  rutaCreds = validarRutaCreds();
  leerPinEnv('QUIVO_PILOTO16_PIN');
  leerPinEnv('QUIVO_PILOTO16_VEHICULO_PIN');

  console.log('='.repeat(90));
  console.log(`Piloto línea 16 — API ${API_URL} — modo: ${APLICAR ? 'APPLY (escribe vía la API)' : 'DRY-RUN (solo lecturas; no escribe nada)'}`);
  console.log(`Vehículo ${PLACA} · conductor "${CONDUCTOR.nombre}" · ${fechas.length} día(s): ${fechas[0]} … ${fechas[fechas.length - 1]} · horario ${HORARIO}`);
  if (RESET_CREDENCIALES) console.log('--reset-credenciales: se re-fijará el PIN del conductor.');
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
    const d = await preVuelo(sindicato, fechas);

    const vehiculoId = await sincronizarVehiculo(d);
    const conductorId = await sincronizarConductor(d);
    await sincronizarCredenciales(d, vehiculoId, conductorId);
    const rotacionId = await sincronizarRotacion(d, fechas, vehiculoId, conductorId);

    if (APLICAR) {
      await verificar(sindicato, d.rutaId!, fechas, rotacionId);
      console.log(`\nOK. ${escriturasEjecutadas} escritura(s) ejecutada(s).`);
      imprimirCredenciales();
      console.log('\n' + '!'.repeat(90) + '\n' + ADVERTENCIA_ROTACIONES + '\n' + '!'.repeat(90));
    } else {
      console.log(`\nDRY-RUN: ${escriturasPlaneadas} escritura(s) planeada(s), 0 enviadas. Para aplicar: agregar --apply.`);
    }
  } catch (err) {
    console.error('\nAbortado.');
    console.error(err instanceof Error ? err.message : err);
    console.error(`(escrituras ejecutadas antes del error: ${escriturasEjecutadas}; el script es idempotente: re-correr para completar)`);
    imprimirCredenciales(); // si ya se fijó un PIN antes del error, no se pierde
    process.exitCode = 1;
  }
}

void main();
