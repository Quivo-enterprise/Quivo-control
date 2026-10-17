/**
 * Extiende las asignaciones del piloto en la base de **producción real**, hablando SOLO con la
 * API HTTP pública (nunca con la base directo). Corre en la máquina del CTO.
 *
 * ## Para qué
 *
 * `scripts/sembrar-piloto-produccion.ts` sembró 21 días de asignaciones `manana` (1 vehículo
 * por conductor). Al vencer, el login móvil Nivel 1 (`auth-movil.service.ts`: asignación
 * `estado: 'vigente'` con `fecha` = hoy en Bolivia y rotación `publicada`) deja de encontrar
 * candidatos y los conductores ven "no tenés rotaciones hoy". Este script agrega, por vehículo
 * y por día del rango, la asignación `manana` que falte, con el MISMO conductor y ruta.
 *
 * ## Contrato real de la API (leído del código, no supuesto)
 *
 *   - `POST /v1/rotaciones/:id/asignaciones` exige la rotación en **borrador**
 *     (`asegurarRotacionEditable`, rotaciones.service.ts) -> hay que anular antes de crear.
 *   - No existe endpoint bulk: 1 POST por asignación.
 *   - `anular` (publicada -> borrador) y `publicar` (borrador -> publicada) se pueden repetir
 *     las veces que haga falta (solo chequean el estado actual). `publicar` exige >= 1
 *     asignación en la rotación.
 *   - La unicidad `@@unique([vehiculoId, fecha, horario])` es GLOBAL (no por rotación): un 409
 *     al crear = esa fila ya existe -> se cuenta como existente. Si la fila existente vive en
 *     OTRA rotación, no aparece en la lectura de la rotación objetivo y la verificación final
 *     la reporta como hueco (exit 1): no se oculta.
 *   - Límite global de 100 req/min/IP (ThrottlerModule): 429 -> espera `Retry-After` (o 60 s) y
 *     reintenta; además hay un throttle fijo entre requests (`QUIVO_THROTTLE_MS`, 700 ms).
 *
 * ## VENTANA DESPUBLICADA = CAÍDA DE SERVICIO
 *
 * Mientras la rotación está en borrador NADIE puede loguearse. Por eso: anular -> crear ->
 * publicar, con el publicar en un `finally` incondicional (se ejecuta aunque la creación falle
 * a mitad, o aunque el `anular` haya dado un error ambiguo de red), con relectura del estado
 * real y reintentos. Si aun así no logra publicar, termina con un mensaje explícito y exit 2:
 * hay que publicar a mano (`POST /v1/rotaciones/<id>/publicar`) YA. Si se mata el proceso
 * (Ctrl-C / kill -9) a mitad, la rotación puede quedar en borrador: re-correr el script (detecta
 * borrador, completa lo que falte y publica) o publicar a mano.
 *
 * ## Cómo se corre
 *
 *   QUIVO_ADMIN_EMAIL=... QUIVO_ADMIN_PASSWORD=... \
 *     pnpm piloto:extender-asignaciones                  # DRY-RUN (default, solo lecturas)
 *
 *   QUIVO_ADMIN_EMAIL=... QUIVO_ADMIN_PASSWORD=... \
 *     pnpm piloto:extender-asignaciones -- --apply       # escribe de verdad
 *
 * (equivale a `packages/db/node_modules/.bin/tsx scripts/extender-asignaciones-piloto.ts ...`).
 * El dry-run SÍ hace login y GETs (necesita leer el estado real para calcular el plan); nunca
 * manda POST de escritura.
 *
 * Variables de entorno:
 *   QUIVO_API_URL        Opcional. Default: API de producción (`/v1` se agrega si falta).
 *   QUIVO_ADMIN_EMAIL     Obligatoria. Usuario `admin_quivo` o `admin_sindicato`.
 *   QUIVO_ADMIN_PASSWORD  Obligatoria. NUNCA se imprime.
 *   QUIVO_THROTTLE_MS     Opcional. Pausa mínima entre requests (default 700; 0 la desactiva).
 *
 * Opciones:
 *   --apply                  Escribe. Sin esto, dry-run.
 *   --desde=YYYY-MM-DD       Default: hoy en America/La_Paz.
 *   --hasta=YYYY-MM-DD       Default: 2026-11-30.
 *   --rotacion-id=<uuid>     Obligatoria si hay más de una rotación candidata (ver abajo).
 *   --placas=A,B             Limita plan/creación/verificación a esas placas (p. ej. 9001TST,9004TST).
  --vehiculos-esperados=N  Default 6 (ignorado con --placas). Aborta si la rotación tiene otro número de vehículos.
 *
 * Selección de rotación: sin `--rotacion-id`, la única rotación listada por `GET /v1/rotaciones`
 * (admin_quivo ve todos los sindicatos; admin_sindicato solo el suyo). Si hay 0 o >1, aborta
 * listando candidatas (id, periodo, estado) — nunca adivina.
 *
 * Exit codes: 0 ok · 1 error/verificación fallida/entorno · 2 no se pudo republicar (URGENTE).
 */

import {
  calcularFaltantes,
  derivarPares,
  filtrarParesPorPlacas,
  parsearPlacas,
  ejecutarConReautenticacion,
  fechaActualLaPaz,
  generarRangoFechas,
  normalizarBaseUrl,
  renovarSesion,
  verificarCobertura,
  type AsignacionApi,
  type Faltante,
  type ParVehiculo,
} from './lib/asignaciones-piloto.js';

const HORARIO = 'manana';
const HASTA_DEFAULT = '2026-11-30';
const ORDEN = 1; // mismo `orden` que usó la siembra original

// ============================================================================================
// CLI + entorno
// ============================================================================================

function valorFlag(nombre: string, argv: string[]): string | undefined {
  const i = argv.findIndex((a) => a === `--${nombre}` || a.startsWith(`--${nombre}=`));
  if (i === -1) return undefined;
  const arg = argv[i]!;
  if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
  return argv[i + 1];
}

function fatal(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=... QUIVO_ADMIN_PASSWORD=... pnpm piloto:extender-asignaciones [-- opciones]

Opciones:
  --apply                  Escribe de verdad (anula, crea, republica). Sin esto: dry-run.
  --desde=YYYY-MM-DD       Default: hoy en America/La_Paz.
  --hasta=YYYY-MM-DD       Default: ${HASTA_DEFAULT}.
  --rotacion-id=<uuid>     Obligatoria si hay más de una rotación.
  --vehiculos-esperados=N  Default 6.
  --help                   Esta ayuda.

Env: QUIVO_API_URL (opc.), QUIVO_ADMIN_EMAIL, QUIVO_ADMIN_PASSWORD, QUIVO_THROTTLE_MS (opc.)
Ver cabecera del archivo para el detalle.
`);
  process.exit(0);
}

const APLICAR = argv.includes('--apply');
const HOY = fechaActualLaPaz();
const DESDE = valorFlag('desde', argv) ?? HOY;
const HASTA = valorFlag('hasta', argv) ?? HASTA_DEFAULT;
const ROTACION_ID_ARG = valorFlag('rotacion-id', argv);
const PLACAS_ARG = valorFlag('placas', argv);
const PLACAS = PLACAS_ARG ? parsearPlacas(PLACAS_ARG) : undefined;
if (PLACAS_ARG !== undefined && (PLACAS?.length ?? 0) === 0) fatal('--placas está vacío.');
const ESPERADOS = Number(valorFlag('vehiculos-esperados', argv) ?? 6);
if (!Number.isInteger(ESPERADOS) || ESPERADOS < 1)
  fatal('--vehiculos-esperados debe ser un entero positivo.');

let FECHAS: string[];
try {
  FECHAS = generarRangoFechas(DESDE, HASTA);
} catch (err) {
  fatal(err instanceof Error ? err.message : String(err));
}

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim().length === 0)
    fatal(`Falta la variable de entorno ${nombre}. Abortando antes de tocar nada.`);
  return valor;
}

const API_URL = normalizarBaseUrl(
  process.env.QUIVO_API_URL ?? 'https://quivo-api-741758083365.southamerica-west1.run.app',
);
const ADMIN_EMAIL = requerirEnv('QUIVO_ADMIN_EMAIL');
const ADMIN_PASSWORD = requerirEnv('QUIVO_ADMIN_PASSWORD');
const THROTTLE_MS = Number(process.env.QUIVO_THROTTLE_MS ?? 700);
if (!Number.isFinite(THROTTLE_MS) || THROTTLE_MS < 0)
  fatal('QUIVO_THROTTLE_MS debe ser un número >= 0.');

// ============================================================================================
// Cliente HTTP — throttle, 429 con backoff, reintento de 5xx/red. Nunca loguea el body enviado
// (puede llevar password en el login) ni tokens.
// ============================================================================================

const RATE_LIMIT_ESPERA_MS = 60_000;
const RATE_LIMIT_MAX_REINTENTOS = 6;
const REINTENTOS_5XX = 3;
const TIMEOUT_MS = 30_000;

class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly status?: number,
  ) {
    super(mensaje);
  }
}

let accessToken: string | undefined;
let refreshToken: string | undefined;
let ultimoRequestMs = 0;
let requests = 0;
let reintentos429 = 0;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface OpcionesLlamada {
  /** Status 4xx que NO son error para este llamador (p. ej. 409 al crear). */
  aceptar?: number[];
  /** Reintentar 5xx/errores de red (solo para llamadas seguras de repetir). */
  reintentar5xx?: boolean;
}

interface Respuesta<T> {
  status: number;
  cuerpo: T;
}

async function llamarSinAuth<T = unknown>(
  metodo: string,
  ruta: string,
  body?: unknown,
  opts: OpcionesLlamada = {},
): Promise<Respuesta<T>> {
  let intento429 = 0;
  let intento5xx = 0;
  for (;;) {
    const espera = ultimoRequestMs + THROTTLE_MS - Date.now();
    if (espera > 0) await dormir(espera);
    ultimoRequestMs = Date.now();
    requests++;

    let res: Response;
    try {
      res = await fetch(`${API_URL}${ruta}`, {
        method: metodo,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (opts.reintentar5xx && intento5xx < REINTENTOS_5XX) {
        intento5xx++;
        console.warn(
          `  red/timeout en ${metodo} ${ruta} (${err instanceof Error ? err.name : 'error'}) — reintento ${intento5xx}/${REINTENTOS_5XX}`,
        );
        await dormir(2_000 * intento5xx);
        continue;
      }
      throw new ErrorApi(
        `${metodo} ${ruta} -> fallo de red/timeout (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    if (res.status === 429) {
      if (intento429 >= RATE_LIMIT_MAX_REINTENTOS) {
        throw new ErrorApi(`${metodo} ${ruta} -> HTTP 429 tras ${intento429} reintentos`, 429);
      }
      const ra = Number(res.headers.get('retry-after'));
      const esperaMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RATE_LIMIT_ESPERA_MS;
      intento429++;
      reintentos429++;
      console.warn(
        `  429 en ${metodo} ${ruta} — espero ${Math.round(esperaMs / 1000)}s (reintento ${intento429}/${RATE_LIMIT_MAX_REINTENTOS})`,
      );
      await dormir(esperaMs);
      continue;
    }

    if (res.status >= 500 && opts.reintentar5xx && intento5xx < REINTENTOS_5XX) {
      intento5xx++;
      console.warn(
        `  HTTP ${res.status} en ${metodo} ${ruta} — reintento ${intento5xx}/${REINTENTOS_5XX}`,
      );
      await dormir(2_000 * intento5xx);
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
    if (!res.ok && !(opts.aceptar ?? []).includes(res.status)) {
      const detalle = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
      throw new ErrorApi(
        `${metodo} ${ruta} -> HTTP ${res.status} ${detalle?.slice(0, 500) ?? ''}`,
        res.status,
      );
    }
    return { status: res.status, cuerpo: cuerpo as T };
  }
}

/** Llamada autenticada: ante 401 renueva la sesión (refresh token; si falla, re-login con las
 * credenciales de env) y reintenta UNA vez. El access token dura ~15 min y un run largo lo
 * supera; sin esto el publicar del `finally` podría fallar con la rotación ya anulada. */
async function llamar<T = unknown>(
  metodo: string,
  ruta: string,
  body?: unknown,
  opts: OpcionesLlamada = {},
): Promise<Respuesta<T>> {
  const esAuth = ruta.startsWith('/auth/');
  const aceptar = esAuth ? opts.aceptar : [...(opts.aceptar ?? []), 401];
  const respuesta = await ejecutarConReautenticacion(
    () => llamarSinAuth<T>(metodo, ruta, body, { ...opts, aceptar }),
    renovar,
  );
  if (!esAuth && respuesta.status === 401 && !(opts.aceptar ?? []).includes(401)) {
    throw new ErrorApi(`${metodo} ${ruta} -> HTTP 401 (sesión no renovable)`, 401);
  }
  return respuesta;
}

// ============================================================================================
// Lecturas
// ============================================================================================

interface RotacionApi {
  id: string;
  sindicatoId: string;
  periodo: string;
  estado: string;
}
interface RotacionConAsignaciones extends RotacionApi {
  asignaciones: AsignacionApi[];
}
interface VehiculoApi {
  id: string;
  placa: string;
  estado: string;
}
interface ConductorApi {
  id: string;
  estado: string;
}

interface TokensApi {
  accessToken: string;
  refreshToken: string;
}

async function login(): Promise<void> {
  const { cuerpo } = await llamarSinAuth<TokensApi>('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  accessToken = cuerpo.accessToken;
  refreshToken = cuerpo.refreshToken;
}

async function refrescar(): Promise<boolean> {
  if (!refreshToken) return false;
  const { status, cuerpo } = await llamarSinAuth<TokensApi>(
    'POST',
    '/auth/refresh',
    { refreshToken },
    { aceptar: [400, 401] },
  );
  if (status !== 200 && status !== 201) return false;
  accessToken = cuerpo.accessToken;
  refreshToken = cuerpo.refreshToken; // el refresh token rota en cada uso
  return true;
}

async function renovar(): Promise<void> {
  console.warn('  401 — renovando sesión...');
  await renovarSesion({ refrescar, loguear: login });
}

async function loginInicial(): Promise<void> {
  console.log('--- Login (POST /v1/auth/login) ---');
  await login();
  console.log('  OK — autenticado.');
}

async function elegirRotacion(): Promise<RotacionApi> {
  const { cuerpo: rotaciones } = await llamar<RotacionApi[]>('GET', '/rotaciones', undefined, {
    reintentar5xx: true,
  });
  if (ROTACION_ID_ARG) {
    const r = rotaciones.find((x) => x.id === ROTACION_ID_ARG);
    if (!r) fatal(`--rotacion-id ${ROTACION_ID_ARG} no aparece en GET /v1/rotaciones.`);
    return r;
  }
  if (rotaciones.length !== 1) {
    const lista = rotaciones
      .map((r) => `    ${r.id}  periodo=${r.periodo}  estado=${r.estado}`)
      .join('\n');
    fatal(
      `GET /v1/rotaciones devolvió ${rotaciones.length} rotación(es); se esperaba exactamente 1. ` +
        `Pasá --rotacion-id=<uuid>. Candidatas:\n${lista || '    (ninguna)'}`,
    );
  }
  return rotaciones[0]!;
}

async function leerRotacion(id: string): Promise<RotacionConAsignaciones> {
  const { cuerpo } = await llamar<RotacionConAsignaciones>('GET', `/rotaciones/${id}`, undefined, {
    reintentar5xx: true,
  });
  return cuerpo;
}

// ============================================================================================
// Escritura: anular -> crear -> publicar (en finally)
// ============================================================================================

interface ResultadoCreacion {
  creadas: number;
  yaExistian: number;
  porVehiculo: Map<string, { creadas: number; yaExistian: number }>;
}

async function crearFaltantes(
  rotacionId: string,
  faltantes: Faltante[],
): Promise<ResultadoCreacion> {
  const resultado: ResultadoCreacion = { creadas: 0, yaExistian: 0, porVehiculo: new Map() };
  let n = 0;
  for (const f of faltantes) {
    const { status } = await llamar(
      'POST',
      `/rotaciones/${rotacionId}/asignaciones`,
      {
        vehiculoId: f.vehiculoId,
        conductorId: f.conductorId,
        rutaId: f.rutaId,
        fecha: f.fecha,
        horario: HORARIO,
        orden: ORDEN,
      },
      { aceptar: [409], reintentar5xx: true },
    );
    const acc = resultado.porVehiculo.get(f.vehiculoId) ?? { creadas: 0, yaExistian: 0 };
    if (status === 409) {
      resultado.yaExistian++;
      acc.yaExistian++;
    } else {
      resultado.creadas++;
      acc.creadas++;
    }
    resultado.porVehiculo.set(f.vehiculoId, acc);
    n++;
    if (n % 25 === 0) console.log(`  ... ${n}/${faltantes.length}`);
  }
  return resultado;
}

/** Deja la rotación en `publicada`. Relee el estado real antes de cada intento (un error de red
 * en `anular`/`publicar` puede haberse aplicado igual). Devuelve true si quedó publicada. */
async function asegurarPublicada(rotacionId: string): Promise<boolean> {
  const MAX = 6;
  for (let intento = 1; intento <= MAX; intento++) {
    try {
      const { cuerpo } = await llamar<RotacionApi>('GET', `/rotaciones/${rotacionId}`, undefined, {
        reintentar5xx: true,
      });
      if (cuerpo.estado === 'publicada') return true;
      await llamar('POST', `/rotaciones/${rotacionId}/publicar`, undefined, {
        reintentar5xx: true,
      });
      console.log(`  Rotación republicada (intento ${intento}).`);
      return true;
    } catch (err) {
      console.error(
        `  publicar falló (intento ${intento}/${MAX}): ${err instanceof Error ? err.message : String(err)}`,
      );
      await dormir(Math.min(2_000 * intento, 10_000));
    }
  }
  return false;
}

// ============================================================================================
// Main
// ============================================================================================

function etiqueta(v: ParVehiculo, vehiculos: Map<string, VehiculoApi>): string {
  return vehiculos.get(v.vehiculoId)?.placa ?? v.vehiculoId.slice(0, 8);
}

async function main(): Promise<number> {
  console.log(
    `Extender asignaciones del piloto — ${APLICAR ? 'APPLY (escribe)' : 'DRY-RUN (solo lecturas)'}`,
  );
  console.log(`API: ${API_URL}`);
  console.log(
    `Rango: ${DESDE} .. ${HASTA} (${FECHAS.length} días) · horario=${HORARIO} · hoy en La Paz: ${HOY}`,
  );

  await loginInicial();

  console.log('\n--- Descubrimiento ---');
  const rotacionBase = await elegirRotacion();
  const rotacion = await leerRotacion(rotacionBase.id);
  console.log(
    `  Rotación ${rotacion.id} periodo=${rotacion.periodo} estado=${rotacion.estado} asignaciones=${rotacion.asignaciones.length}`,
  );

  const todosLosPares = derivarPares(rotacion.asignaciones, HORARIO);
  const { cuerpo: listaVehiculos } = await llamar<VehiculoApi[]>('GET', '/vehiculos', undefined, {
    reintentar5xx: true,
  });
  const vehiculos = new Map(listaVehiculos.map((v) => [v.id, v]));

  let pares = todosLosPares;
  if (PLACAS) {
    try {
      pares = filtrarParesPorPlacas(
        todosLosPares,
        new Map(listaVehiculos.map((v) => [v.id, v.placa])),
        PLACAS,
      );
    } catch (err) {
      fatal(`${err instanceof Error ? err.message : String(err)}. No toco nada.`);
    }
    console.log(
      `  Limitado a --placas: ${PLACAS.join(', ')} (${pares.length} de ${todosLosPares.length} vehículos)`,
    );
  } else if (pares.length !== ESPERADOS) {
    fatal(
      `Se derivaron ${pares.length} vehículo(s) con conductor en "${HORARIO}", se esperaban ${ESPERADOS} (--vehiculos-esperados). No toco nada.`,
    );
  }
  const conductoresDistintos = new Set(pares.map((p) => p.conductorId));
  if (conductoresDistintos.size !== pares.length) {
    fatal(
      'Dos vehículos comparten conductor en sus asignaciones más recientes: el diseño 1:1 no se cumple. No toco nada.',
    );
  }
  const { cuerpo: listaConductores } = await llamar<ConductorApi[]>(
    'GET',
    '/conductores',
    undefined,
    { reintentar5xx: true },
  );
  const conductores = new Map(listaConductores.map((c) => [c.id, c]));

  for (const p of pares) {
    const v = vehiculos.get(p.vehiculoId);
    const c = conductores.get(p.conductorId);
    const avisos: string[] = [];
    if (!v) avisos.push('vehículo no visible en GET /vehiculos');
    else if (v.estado !== 'activo') avisos.push(`vehículo estado=${v.estado}`);
    if (!c) avisos.push('conductor no visible en GET /conductores');
    else if (c.estado !== 'activo') avisos.push(`conductor estado=${c.estado}`);
    console.log(
      `  ${etiqueta(p, vehiculos)}  vehiculo=${p.vehiculoId.slice(0, 8)} conductor=${p.conductorId.slice(0, 8)} ruta=${p.rutaId.slice(0, 8)} última=${p.fechaReferencia}${avisos.length ? `  ⚠ ${avisos.join('; ')}` : ''}`,
    );
  }

  const faltantes = calcularFaltantes(pares, rotacion.asignaciones, FECHAS, HORARIO);
  const faltantesPorVehiculo = new Map<string, number>();
  for (const f of faltantes)
    faltantesPorVehiculo.set(f.vehiculoId, (faltantesPorVehiculo.get(f.vehiculoId) ?? 0) + 1);

  console.log('\n--- Plan ---');
  for (const p of pares) {
    const n = faltantesPorVehiculo.get(p.vehiculoId) ?? 0;
    console.log(
      `  ${etiqueta(p, vehiculos)}: crear ${n}, ya existen ${FECHAS.length - n} (rango ${DESDE}..${HASTA})`,
    );
  }
  const necesitaAnular = faltantes.length > 0 && rotacion.estado === 'publicada';
  console.log(
    `  Total a crear: ${faltantes.length} (≈ ${Math.ceil((faltantes.length * Math.max(THROTTLE_MS, 1)) / 1000)} s con throttle de ${THROTTLE_MS} ms)`,
  );
  console.log(
    `  Estado de la rotación: ${rotacion.estado} · ¿anular? ${necesitaAnular ? 'SÍ (ventana despublicada durante la creación; se republica en finally)' : faltantes.length === 0 ? 'no (nada que crear)' : 'no (ya está en borrador)'}`,
  );
  if (rotacion.estado !== 'publicada' && rotacion.estado !== 'borrador') {
    fatal(`Estado inesperado de la rotación: ${rotacion.estado}`);
  }

  if (!APLICAR) {
    console.log('\nDRY-RUN: no se escribió nada. Re-correr con --apply para aplicar.');
    return rotacion.estado === 'publicada' ? 0 : 1;
  }

  // ---- escritura ----
  let resultado: ResultadoCreacion | undefined;
  let errorCreacion: unknown;
  let publicada = true;
  if (faltantes.length > 0 || rotacion.estado === 'borrador') {
    console.log('\n--- Aplicar ---');
    try {
      if (rotacion.estado === 'publicada') {
        console.log(
          '  Anulando rotación (publicada -> borrador)... SERVICIO DE LOGIN CAÍDO hasta republicar.',
        );
        await llamar('POST', `/rotaciones/${rotacion.id}/anular`);
      } else {
        console.log(
          '  La rotación ya está en borrador (¿corrida previa interrumpida?): se completa y se publica.',
        );
      }
      resultado = await crearFaltantes(rotacion.id, faltantes);
    } catch (err) {
      errorCreacion = err;
      console.error(
        `\n  ERROR durante la creación: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      console.log('  Republicando (finally)...');
      const ok = await asegurarPublicada(rotacion.id);
      publicada = ok;
    }
    if (!publicada) {
      console.error(
        `\n!!!! URGENTE: la rotación ${rotacion.id} QUEDÓ EN BORRADOR y NADIE puede loguearse. ` +
          `Publicar a mano ya: POST ${API_URL}/rotaciones/${rotacion.id}/publicar (admin autenticado).`,
      );
      return 2;
    }
    if (resultado) {
      console.log(`  Creadas: ${resultado.creadas} · ya existían (409): ${resultado.yaExistian}`);
      for (const p of pares) {
        const r = resultado.porVehiculo.get(p.vehiculoId);
        if (r)
          console.log(`    ${etiqueta(p, vehiculos)}: creadas ${r.creadas}, 409 ${r.yaExistian}`);
      }
    }
  } else {
    console.log('\nNada que crear.');
  }

  // ---- verificación de lectura ----
  console.log('\n--- Verificación ---');
  const final = await leerRotacion(rotacion.id);
  let ok = final.estado === 'publicada' && errorCreacion === undefined;
  console.log(
    `  Rotación ${final.id}: estado=${final.estado} · asignaciones=${final.asignaciones.length}`,
  );
  const cobertura = verificarCobertura(pares, final.asignaciones, FECHAS, HORARIO, HOY);
  for (const c of cobertura) {
    const par = pares.find((p) => p.vehiculoId === c.vehiculoId)!;
    const mal = c.sinCubrir.length > 0 || c.conductorDistinto.length > 0;
    if (mal) ok = false;
    console.log(
      `  ${etiqueta(par, vehiculos)}: vigentes ${c.vigentes}/${FECHAS.length}` +
        (c.sinCubrir.length
          ? `  SIN CUBRIR: ${c.sinCubrir.length} (${c.sinCubrir.slice(0, 5).join(', ')}${c.sinCubrir.length > 5 ? ', ...' : ''})`
          : '') +
        (c.conductorDistinto.length
          ? `  CONDUCTOR DISTINTO: ${c.conductorDistinto.length} (${c.conductorDistinto.slice(0, 5).join(', ')})`
          : ''),
    );
  }
  console.log(`  Requests: ${requests} · reintentos por 429: ${reintentos429}`);
  console.log(ok ? '\nOK — rotación publicada y cobertura completa.' : '\nFALLÓ — ver arriba.');
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
