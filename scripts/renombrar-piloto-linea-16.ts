/**
 * Renombra IN SITU los trufis sintéticos del piloto línea 16 (`crear-piloto-linea-16.ts`) con los datos
 * REALES: PATCH de la placa del vehículo y del nombre del conductor (mismos ids, mismas asignaciones y PIN).
 * Además puede DESACTIVAR un piloto (fila `PLACA<TAB>-<TAB>-`: vehículo + conductor → inactivo, p. ej. 1616PKD).
 * Habla SOLO con la API HTTP pública. **Dry-run por defecto** (login + GETs); `--apply` escribe.
 *
 * Los datos reales son PII y viven FUERA del repo (nunca se versionan):
 *   QUIVO_PILOTO16_REALES_FILE  Ruta ABSOLUTA, fuera del repo. Líneas `placa_actual<TAB>placa_real<TAB>nombre_real`
 *                               (`#` = comentario). `placa_actual` = la sintética (1616PJA…). `-` en las dos
 *                               columnas = desactivar ese piloto.
 *   QUIVO_PILOTO16_CREDS_FILE   Ruta ABSOLUTA fuera del repo (0600), formato de `crear-piloto-linea-16.ts`. Con
 *                               --apply se reescriben las líneas de los renombrados a `placa_real | nombre_real | pin=<mismo>`.
 *   QUIVO_ADMIN_EMAIL / QUIVO_ADMIN_PASSWORD (admin_quivo), QUIVO_API_URL, QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE.
 *
 * Flujo: 1) parsea y valida TODAS las filas (sin red) y aborta si hay inválidas; 2) pre-vuelo de SOLO LECTURA
 * que aborta antes de la primera escritura; 3) plan por fila; 4) con --apply, PATCHes + reescritura de creds;
 * 5) verificación final de solo lectura (placa, nombre, estado y asignaciones 2026-10-29..2026-11-02).
 *
 * ## Identificación idempotente (tras renombrar ya no existe la placa sintética)
 * El CONDUCTOR se halla por su CI sintético (mapa placa_actual→CI de `PILOTOS`; el CI no cambia). El VEHÍCULO,
 * por placa_actual (pendiente de renombrar) o, si ya no está, por placa_real SOLO si es el vehículo al que la
 * rotación `piloto-linea-16` asigna a ese conductor (así un vehículo ajeno con esa placa nunca se confunde con
 * el del piloto). Si placa_real la tiene otro vehículo vigente (de cualquier sindicato) → aborta sin escribir.
 *
 * Nota API: `PATCH /vehiculos/:id` ({placa}) valida unicidad (409 si otro vehículo VIGENTE la tiene) y re-valida
 * requisitos de activación del vehículo ya activo (los cumple). `PATCH /conductores/:id` ({nombre}) no tiene
 * efectos laterales. Cliente HTTP/login duplicados a propósito con los otros scripts standalone.
 *
 * Uso:  tsx scripts/renombrar-piloto-linea-16.ts [--validar] [--apply]
 *   --validar  Solo parsea/valida el TSV (sin red); imprime conteos y filas inválidas, nunca nombres.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hoyLaPaz, parsearReales, PILOTOS, reescribirCreds, rangoFechas, type FilaReal } from './lib/piloto-linea-16.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const NOMBRE_SINDICATO_DEFAULT = 'Sindicato Piloto — Producción';
const PERIODO = 'piloto-linea-16';
const FECHAS_VERIFICAR = rangoFechas('2026-10-29', '2026-11-02', 10);

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');
const SOLO_VALIDAR = argv.includes('--validar');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=… QUIVO_ADMIN_PASSWORD=… QUIVO_PILOTO16_REALES_FILE=… QUIVO_PILOTO16_CREDS_FILE=… tsx scripts/renombrar-piloto-linea-16.ts [opciones]

Opciones:
  --validar  Solo parsea y valida el TSV de datos reales (sin red). No imprime nombres.
  --apply    Escribe vía la API (PATCH placa/nombre/estado) y reescribe el archivo de credenciales. Sin esto: dry-run.
  --help     Esta ayuda.

TSV: placa_actual<TAB>placa_real<TAB>nombre_real  ('#' comentario; '-' en las dos últimas columnas = desactivar). Ver la cabecera del archivo.
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

function dentroDe(base: string, destino: string): boolean {
  const rel = path.relative(base, destino);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Ruta absoluta FUERA del repo (realpath del padre y del archivo si existe: evita symlinks hacia adentro). */
function rutaFueraDelRepo(env: string, debeExistir: boolean): string {
  const v = requerirEnv(env).trim();
  if (!path.isAbsolute(v)) fallar(`${env} debe ser una ruta absoluta.`);
  let padre: string;
  try {
    padre = fs.realpathSync(path.dirname(v));
  } catch {
    fallar(`El directorio de ${env} no existe.`);
  }
  if (debeExistir && !fs.existsSync(v)) fallar(`${env}: el archivo no existe.`);
  const destino = fs.existsSync(v) ? fs.realpathSync(v) : path.join(padre, path.basename(v));
  const repo = fs.realpathSync(REPO_ROOT);
  if (dentroDe(repo, padre) || dentroDe(repo, destino)) fallar(`${env} debe estar FUERA del repo (datos personales/secretos).`);
  return destino;
}

function normalizarBaseUrl(url: string): string {
  const sinBarraFinal = url.replace(/\/+$/, '');
  const host = new URL(sinBarraFinal).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!sinBarraFinal.startsWith('https://') && !local) fallar(`QUIVO_API_URL debe ser https (salvo localhost/127.0.0.1): "${sinBarraFinal}".`);
  return sinBarraFinal.endsWith('/v1') ? sinBarraFinal : `${sinBarraFinal}/v1`;
}

// ============================================================================================
// Paso 1: parseo y validación del TSV (sin red)
// ============================================================================================

function cargarFilas(rutaReales: string): FilaReal[] {
  const { filas, errores } = parsearReales(fs.readFileSync(rutaReales, 'utf8'));
  const ren = filas.filter((f) => f.accion === 'renombrar').length;
  const des = filas.length - ren;
  console.log(`TSV: ${filas.length} fila(s) válida(s) (${ren} a renombrar, ${des} a desactivar), ${errores.length} inválida(s).`);
  for (const e of errores) console.error(`  línea ${e.linea} (${e.placa}): ${e.motivo}`);
  if (errores.length > 0) fallar('Hay filas inválidas en el archivo de datos reales.');
  if (filas.length === 0) fallar('El archivo de datos reales no tiene filas.');
  return filas;
}

if (SOLO_VALIDAR) {
  cargarFilas(rutaFueraDelRepo('QUIVO_PILOTO16_REALES_FILE', true));
  console.log('OK (--validar: sin red, no se escribió nada).');
  process.exit(0);
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
      if (intento >= RATE_LIMIT_MAX_REINTENTOS) throw new ErrorApi(`${metodo} ${ruta} → HTTP 429 (rate limit) tras ${intento} reintento(s). Abortando.`);
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

/** Escritura: en dry-run solo cuenta; con --apply la manda. El body no se imprime (lleva PII). */
async function escribir(metodo: string, ruta: string, body: unknown, etiqueta: string): Promise<void> {
  escriturasPlaneadas++;
  if (!APLICAR) return;
  console.log(`  ${metodo} ${ruta}  (${etiqueta})`);
  await http(metodo, ruta, body);
  escriturasEjecutadas++;
}

// ============================================================================================
// Tipos de la API (solo los campos que usamos)
// ============================================================================================

interface SindicatoApi { id: string; nombre: string; estado: string }
interface VehiculoApi { id: string; sindicatoId: string; placa: string; placaNormalizada: string; estado: string }
interface ConductorApi { id: string; sindicatoId: string; nombre: string; documentoIdentidad: string; estado: string }
interface RotacionApi { id: string; sindicatoId: string; periodo: string; estado: string }
interface AsignacionApi { vehiculoId: string; conductorId: string | null; fecha: string }
interface RotacionConAsignaciones extends RotacionApi { asignaciones: AsignacionApi[] }
interface VerificarPlacaApi { disponible: boolean; coincidencia: { vehiculoId: string; sindicatoId: string; sindicatoNombre: string } | null }

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
  const todos = await leer<SindicatoApi[]>('/sindicatos');
  const id = process.env.QUIVO_SINDICATO_ID?.trim();
  const nombre = process.env.QUIVO_SINDICATO_NOMBRE?.trim() || NOMBRE_SINDICATO_DEFAULT;
  const candidatos = id ? todos.filter((s) => s.id === id) : todos.filter((s) => s.nombre === nombre);
  if (candidatos.length !== 1) throw new ErrorApi(`Se esperaba exactamente 1 sindicato (${id ? `id=${id}` : `nombre="${nombre}"`}), hay ${candidatos.length}.`);
  const s = candidatos[0]!;
  if (s.estado !== 'activo') throw new ErrorApi(`El sindicato "${s.nombre}" está '${s.estado}', no 'activo'.`);
  console.log(`  Sindicato "${s.nombre}" (${s.id}).`);
  return s;
}

// ============================================================================================
// Paso 2: pre-vuelo (SOLO lecturas) y plan
// ============================================================================================

interface Plan {
  fila: FilaReal;
  veh: VehiculoApi;
  cond: ConductorApi;
  /** Qué escrituras faltan. */
  patchPlaca: boolean;
  patchNombre: boolean;
  desactivarVeh: boolean;
  desactivarCond: boolean;
  /** Conductor sintético original (para mostrar "nombre_actual"). */
  nombreSintetico: string;
}

const fechaDe = (a: AsignacionApi): string => a.fecha.slice(0, 10);

async function preVuelo(sindicato: SindicatoApi, filas: FilaReal[]): Promise<Plan[]> {
  console.log('\n--- Pre-vuelo (solo lecturas, antes de cualquier escritura) ---');
  const vehiculos = await leer<VehiculoApi[]>('/vehiculos');
  const propios = vehiculos.filter((v) => v.sindicatoId === sindicato.id);
  const conductores = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id);
  const rots = (await leer<RotacionApi[]>('/rotaciones')).filter((r) => r.sindicatoId === sindicato.id && r.periodo === PERIODO);
  if (rots.length !== 1) throw new ErrorApi(`Se esperaba 1 rotación '${PERIODO}', hay ${rots.length}.`);
  const rot = await leer<RotacionConAsignaciones>(`/rotaciones/${rots[0]!.id}`);
  console.log(`  Rotación '${PERIODO}': ${rot.id} (${rot.estado}, ${rot.asignaciones.length} asignación(es)).`);

  const planes: Plan[] = [];
  for (const fila of filas) {
    const def = PILOTOS.find((p) => p.placa === fila.placaActual)!;
    const ci = def.conductor.documentoIdentidad;
    const porCi = conductores.filter((c) => c.documentoIdentidad.toUpperCase() === ci);
    if (porCi.length !== 1) throw new ErrorApi(`${fila.placaActual}: se esperaba 1 conductor con CI ${ci}, hay ${porCi.length}.`);
    const cond = porCi[0]!;
    const vehsDelConductor = new Set(rot.asignaciones.filter((a) => a.conductorId === cond.id).map((a) => a.vehiculoId));
    const vehActual = propios.filter((v) => v.placaNormalizada === fila.placaActual);
    if (vehActual.length > 1) throw new ErrorApi(`${fila.placaActual}: ${vehActual.length} vehículos con esa placa; resolver a mano.`);

    if (fila.accion === 'desactivar') {
      const veh = vehActual[0];
      if (!veh) throw new ErrorApi(`${fila.placaActual}: no se halló el vehículo a desactivar.`);
      if (vehsDelConductor.size > 0 && !(vehsDelConductor.size === 1 && vehsDelConductor.has(veh.id))) {
        throw new ErrorApi(`${fila.placaActual}: el conductor está asignado a un vehículo distinto del hallado; resolver a mano.`);
      }
      planes.push({ fila, veh, cond, patchPlaca: false, patchNombre: false, desactivarVeh: veh.estado !== 'inactivo', desactivarCond: cond.estado !== 'inactivo', nombreSintetico: def.conductor.nombre });
      continue;
    }

    const vehReal = vehiculos.filter((v) => v.placaNormalizada === fila.placaReal && v.estado !== 'inactivo');
    if (vehReal.length > 1) throw new ErrorApi(`${fila.placaActual}: placa_real en ${vehReal.length} vehículos vigentes; resolver a mano.`);
    let veh: VehiculoApi;
    let patchPlaca: boolean;
    if (vehActual[0]) {
      veh = vehActual[0];
      if (vehReal[0]) throw new ErrorApi(`${fila.placaActual}: placa_real ya la tiene OTRO vehículo vigente (${vehReal[0].id}). Abortando sin escribir.`);
      const v = await leer<VerificarPlacaApi>(`/vehiculos/verificar-placa?placa=${encodeURIComponent(fila.placaReal)}`);
      if (v.coincidencia) throw new ErrorApi(`${fila.placaActual}: placa_real no está disponible (la usa un vehículo de "${v.coincidencia.sindicatoNombre}"). Abortando sin escribir.`);
      patchPlaca = true;
    } else {
      // Ya no existe la placa sintética: ¿ya renombrado? Solo si placa_real es el vehículo asignado a ese conductor.
      const r = vehReal[0];
      if (!r) throw new ErrorApi(`${fila.placaActual}: no existe ni el vehículo con la placa sintética ni uno con la placa_real; resolver a mano.`);
      if (!(vehsDelConductor.size === 1 && vehsDelConductor.has(r.id))) {
        throw new ErrorApi(`${fila.placaActual}: el vehículo con placa_real (${r.id}) no es el asignado a ese conductor en la rotación; podría ser ajeno. Abortando sin escribir.`);
      }
      veh = r;
      patchPlaca = false;
    }
    if (vehsDelConductor.size > 0 && !(vehsDelConductor.size === 1 && vehsDelConductor.has(veh.id))) {
      throw new ErrorApi(`${fila.placaActual}: el conductor está asignado a un vehículo distinto del hallado; resolver a mano.`);
    }
    if (veh.estado !== 'activo' && veh.estado !== 'pendiente') throw new ErrorApi(`${fila.placaActual}: el vehículo (${veh.id}) está '${veh.estado}'; resolver a mano.`);
    if (cond.estado !== 'activo') throw new ErrorApi(`${fila.placaActual}: el conductor (${cond.id}) está '${cond.estado}'; resolver a mano.`);
    if (cond.nombre !== def.conductor.nombre && cond.nombre !== fila.nombreReal) {
      throw new ErrorApi(`${fila.placaActual}: el conductor (${cond.id}) tiene un nombre que no es ni el sintético ni el real; resolver a mano.`);
    }
    planes.push({ fila, veh, cond, patchPlaca, patchNombre: cond.nombre !== fila.nombreReal, desactivarVeh: false, desactivarCond: false, nombreSintetico: def.conductor.nombre });
  }

  console.log('\n--- Plan ---');
  for (const p of planes) {
    const f = p.fila;
    if (f.accion === 'desactivar') {
      const hecho = !p.desactivarVeh && !p.desactivarCond;
      console.log(`  ${f.placaActual}: ${hecho ? 'ya aplicado (inactivo)' : `DESACTIVAR${p.desactivarVeh ? ' vehículo' : ''}${p.desactivarCond ? ' conductor' : ''}`}`);
    } else if (!p.patchPlaca && !p.patchNombre) {
      console.log(`  ${f.placaActual} → ${f.placaReal}: ya aplicado`);
    } else {
      console.log(`  ${f.placaActual} → ${f.placaReal}${p.patchPlaca ? '' : ' (placa ya aplicada)'} | "${p.cond.nombre}" → "${f.nombreReal}"${p.patchNombre ? '' : ' (nombre ya aplicado)'}`);
    }
  }
  return planes;
}

// ============================================================================================
// Paso 4: escrituras + credenciales
// ============================================================================================

/** Qué se aplicó de una fila: entra al array cuando la placa ya está; `nombre` solo cuando el nombre también. */
interface Hecha { fila: FilaReal; nombre: boolean }

/** Reescribe el archivo de credenciales de forma atómica (tmp 0600 + rename), conservando PIN y demás líneas. */
function actualizarCreds(rutaCreds: string, hechas: Hecha[]): void {
  const ren = hechas
    .filter((h) => h.fila.accion === 'renombrar')
    .map((h) => ({ placaActual: h.fila.placaActual, placaReal: h.fila.placaReal, nombreReal: h.fila.nombreReal, nombreAplicado: h.nombre }));
  if (ren.length === 0) return;
  const { texto, sinLinea } = reescribirCreds(fs.readFileSync(rutaCreds, 'utf8'), ren, new Date().toISOString());
  const tmp = `${rutaCreds}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, texto, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, rutaCreds);
  console.log(`  Credenciales: ${ren.length - sinLinea.length} línea(s) reescrita(s) (PIN intactos, no se imprimen).`);
  if (sinLinea.length > 0) console.warn(`  AVISO: sin línea de credenciales para ${sinLinea.join(', ')} (no se tocó nada para ellos).`);
}

async function aplicar(planes: Plan[], rutaCreds: string): Promise<void> {
  console.log(`\n--- ${APLICAR ? 'Aplicando' : 'Dry-run (nada se escribe)'} ---`);
  const hechas: Hecha[] = [];
  try {
    for (const p of planes) {
      const f = p.fila;
      if (p.patchPlaca) await escribir('PATCH', `/vehiculos/${p.veh.id}`, { placa: f.placaReal }, `placa ${f.placaActual}`);
      const h: Hecha = { fila: f, nombre: false };
      hechas.push(h);
      if (p.patchNombre) await escribir('PATCH', `/conductores/${p.cond.id}`, { nombre: f.nombreReal }, `nombre de ${f.placaActual}`);
      h.nombre = true;
      if (p.desactivarVeh) await escribir('PATCH', `/vehiculos/${p.veh.id}/estado`, { estado: 'inactivo', motivo: 'Fin del piloto línea 16' }, `desactivar vehículo ${f.placaActual}`);
      if (p.desactivarCond) await escribir('PATCH', `/conductores/${p.cond.id}`, { estado: 'inactivo' }, `desactivar conductor ${f.placaActual}`);
    }
  } finally {
    // También si algo falló a mitad: lo ya renombrado queda reflejado en el archivo de credenciales.
    if (APLICAR && hechas.length > 0) actualizarCreds(rutaCreds, hechas);
  }
}

// ============================================================================================
// Paso 5: verificación final (solo lecturas)
// ============================================================================================

async function verificar(sindicato: SindicatoApi, planes: Plan[]): Promise<void> {
  console.log('\n--- Verificación final (solo lecturas) ---');
  const vehiculos = (await leer<VehiculoApi[]>('/vehiculos')).filter((v) => v.sindicatoId === sindicato.id);
  const conductores = (await leer<ConductorApi[]>('/conductores')).filter((c) => c.sindicatoId === sindicato.id);
  const rots = (await leer<RotacionApi[]>('/rotaciones')).filter((r) => r.sindicatoId === sindicato.id && r.periodo === PERIODO);
  const rot = await leer<RotacionConAsignaciones>(`/rotaciones/${rots[0]!.id}`);
  const hoy = hoyLaPaz();
  for (const p of planes) {
    const f = p.fila;
    const v = vehiculos.find((x) => x.id === p.veh.id);
    const c = conductores.find((x) => x.id === p.cond.id);
    if (!v || !c) throw new Error(`${f.placaActual}: vehículo o conductor no encontrado tras aplicar.`);
    if (f.accion === 'renombrar') {
      if (v.placaNormalizada !== f.placaReal || v.estado !== 'activo') throw new Error(`${f.placaActual}: el vehículo no quedó con la placa real y activo.`);
      if (c.nombre !== f.nombreReal || c.estado !== 'activo') throw new Error(`${f.placaActual}: el conductor no quedó con el nombre real y activo.`);
    } else if (v.estado !== 'inactivo' || c.estado !== 'inactivo') {
      throw new Error(`${f.placaActual}: vehículo/conductor no quedaron inactivos.`);
    }
    const propias = rot.asignaciones.filter((a) => a.vehiculoId === v.id);
    // Se exige TODO el rango fijo: los días pasados pueden figurar vencidas pero siguen existiendo.
    const faltan = FECHAS_VERIFICAR.filter((d) => !propias.some((a) => fechaDe(a) === d && a.conductorId === c.id));
    if (faltan.length > 0) throw new Error(`${f.placaActual}: faltan asignaciones (conductor original) en ${faltan.join(', ')}.`);
    console.log(`  ${f.placaActual}: OK (${f.accion === 'renombrar' ? 'placa y nombre reales, activo' : 'inactivo'}; ${FECHAS_VERIFICAR.length} asignaciones ${FECHAS_VERIFICAR[0]}…${FECHAS_VERIFICAR[FECHAS_VERIFICAR.length - 1]} intactas; hoy=${hoy}).`);
  }
}

async function main(): Promise<void> {
  const rutaReales = rutaFueraDelRepo('QUIVO_PILOTO16_REALES_FILE', true);
  const rutaCreds = rutaFueraDelRepo('QUIVO_PILOTO16_CREDS_FILE', true);
  API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL || 'https://quivo-api-741758083365.southamerica-west1.run.app');
  requerirEnv('QUIVO_ADMIN_EMAIL');
  requerirEnv('QUIVO_ADMIN_PASSWORD');
  const filas = cargarFilas(rutaReales);
  console.log(`Renombrar piloto línea 16 — API ${API_URL} — modo: ${APLICAR ? 'APPLY (escribe vía la API)' : 'DRY-RUN (solo lecturas)'}`);
  try {
    await login();
    const sindicato = await resolverSindicato();
    const planes = await preVuelo(sindicato, filas);
    await aplicar(planes, rutaCreds);
    if (APLICAR) {
      await verificar(sindicato, planes);
      console.log(`\nOK. ${escriturasEjecutadas} escritura(s) ejecutada(s).`);
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

void main();
