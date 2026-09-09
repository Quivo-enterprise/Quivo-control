/**
 * Siembra el piloto en la base de **producción real**, hablando SOLO con la API HTTP pública
 * (`https://quivo-api-741758083365.southamerica-west1.run.app/v1` por default) — nunca con la
 * base directo. Corre en la máquina del CTO, no dentro de ningún contenedor.
 *
 * Crea, en este orden exacto: 1 sindicato → 2 socios (uno por vehículo) → 2 líneas (Z12/120,
 * con branding) → 2 rutas con geometría real → puntos de control → 2 vehículos (nacen
 * `pendiente`) → los activa → 6 conductores → les fija PIN → 1 rotación en borrador → las
 * asignaciones (3 conductores por vehículo por día, `DIAS_ROTACION` días desde hoy) → publica
 * la rotación.
 *
 * ## Cómo se corre
 *
 *   QUIVO_ADMIN_EMAIL=admin_quivo@... QUIVO_ADMIN_PASSWORD=... \
 *   QUIVO_PIN_1=123456 QUIVO_PIN_2=234567 QUIVO_PIN_3=345678 \
 *   QUIVO_PIN_4=456789 QUIVO_PIN_5=567890 QUIVO_PIN_6=678901 \
 *     packages/db/node_modules/.bin/tsx scripts/sembrar-piloto-produccion.ts        # dry-run
 *
 *   ...(mismas env vars)... \
 *     packages/db/node_modules/.bin/tsx scripts/sembrar-piloto-produccion.ts --apply  # aplica
 *
 * (`packages/db/node_modules/.bin/tsx` porque el root del monorepo no declara `tsx` como
 * dependencia propia — mismo motivo que el resto de `scripts/`: standalone, sin acoplarse al
 * build de ningún workspace. También funciona con `pnpm --filter @quivo/db exec tsx
 * ../../scripts/sembrar-piloto-produccion.ts` si se prefiere.)
 *
 * Variables de entorno:
 *   QUIVO_API_URL        Opcional. Default: la URL de producción de arriba.
 *   QUIVO_ADMIN_EMAIL     Obligatoria. Email del usuario `admin_quivo` ya existente.
 *   QUIVO_ADMIN_PASSWORD  Obligatoria. Su contraseña. NUNCA se loguea, ni en modo verbose.
 *   QUIVO_PIN_1..QUIVO_PIN_6  Obligatorias. PIN de cada conductor (string, 6-12 dígitos,
 *     pueden tener ceros a la izquierda — viajan como string en todo momento). Deben ser
 *     los 6 distintos entre sí (dos PIN iguales en el mismo vehículo hacen que el login
 *     móvil devuelva 401 a ambos conductores). NUNCA se loguean.
 *   QUIVO_DIAS_ROTACION   Opcional. Default 21. Cuántos días de asignaciones sembrar, desde
 *     hoy (calendario Bolivia).
 *
 * `--apply` es obligatorio para escribir algo. Sin él, el script imprime exactamente qué
 * llamadas haría (cuántas, a qué endpoint, con qué forma de datos — ocultando PIN/password) y
 * no manda ningún POST/PATCH/PUT/DELETE. Para el primer error se detiene mostrando el status
 * HTTP y el cuerpo de la respuesta — no sigue de largo.
 *
 * ## Reanudable e idempotente vía estado local — LEER ANTES DE BORRAR `scripts/.estado-
 * siembra-produccion.json`
 *
 * Ninguno de los endpoints que este script usa para crear (`POST /v1/sindicatos`,
 * `/v1/socios`, `/v1/lineas`, `/v1/lineas/:id/rutas`, `/v1/rutas/:id/puntos-control`,
 * `/v1/vehiculos`, `/v1/conductores`, `/v1/rotaciones/:id/asignaciones`) acepta un `id` — el
 * servidor siempre genera uno nuevo (`randomUUID()` en cada `*.service.ts`, confirmado
 * leyendo el código). A diferencia de los scripts que hablan con Postgres directo
 * (`cargar-circuito-z12.ts`, `crear-credenciales-piloto.ts`, que usan ids fijos + `ON
 * CONFLICT ... DO UPDATE`), este script **no puede** ser idempotente por id determinista.
 * Tampoco existe un endpoint DELETE para sindicatos/socios/líneas/rutas/puntos de
 * control/vehículos/conductores (si existe, la nota de abajo lo corrige — ver "Correcciones
 * sobre el brief").
 *
 * La única forma de que una segunda corrida no duplique todo es que el script recuerde qué ya
 * creó. Por eso, cada vez que un POST/PUT que crea o fija algo tiene éxito en modo `--apply`,
 * el id (o el hecho de que ya se hizo) se escribe DE INMEDIATO a `scripts/.estado-siembra-
 * produccion.json` (no al final — si el proceso muere a mitad de camino, lo ya escrito ahí
 * queda). Al arrancar, el script LEE ese archivo y saltea cualquier paso que ya conste. Si se
 * borra ese archivo (o se corre desde otra máquina sin copiarlo) antes de una segunda corrida
 * con `--apply`, el script no tiene forma de saber qué ya existe en producción y VA A
 * DUPLICAR filas que después no se pueden borrar. Tratarlo como el único source of truth de
 * qué ya se aplicó — no borrarlo "para probar de nuevo".
 *
 * ## Correcciones sobre el brief — LEER ANTES DE CORRER CON `--apply`
 *
 * Investigando el código real de la API antes de escribir este script aparecieron dos
 * diferencias entre lo que el brief asumía y el contrato real de los endpoints. Ninguna de
 * las dos se resolvió "por las mías" sin dejar rastro — quedan documentadas acá, en el
 * código de los pasos afectados, y se repiten en el reporte final para que el CTO las revise
 * antes de ejecutar contra producción real.
 *
 * ### 1) `POST /v1/rotaciones` NO crea un borrador vacío — genera y auto-asigna
 *
 * El brief (paso 10) asume que `POST /v1/rotaciones` crea una rotación vacía en `borrador`,
 * lista para que el paso 11 le cuelgue las asignaciones a mano una por una. Leyendo
 * `apps/api/src/modules/rotaciones/rotaciones.controller.ts` y `rotaciones.service.ts`: ese
 * único POST está mapeado a `generar()`, valida contra `GenerarRotacionSchema`
 * (`rutaIds`/`fechas`/`horarios` obligatorios, mínimo 1 cada uno) y, en la misma llamada,
 * reparte round-robin TODOS los vehículos/conductores activos del sindicato entre esas
 * rutas/fechas/horarios — no hay forma de pedirle una rotación vacía. Además ese reparto
 * round-robin explícitamente busca que cada vehículo cubra cada ruta pedida al menos una vez
 * (`rotacionesService.generar`, comentario "se prefiere el que todavía no cubrió esa
 * ruta/variante de línea") — corrido con las fechas/horarios reales de este piloto terminaría
 * cruzando el vehículo Z12 con la ruta 120 (y viceversa) en algunos turnos, y repartiendo los
 * 6 conductores con un round-robin ciego que ignora el split "1-3 en Z12, 4-6 en 120" que pide
 * el brief — ambas cosas incompatibles con lo pedido.
 *
 * Resolución implementada (Paso 10, `crearRotacionBorrador`): se llama a `generar()` con el
 * mínimo posible (`rutaIds`: las 2 rutas reales, para de paso verificar que las dos son
 * visibles para este tenant; `fechas`: [hoy]; `horarios`: ['manana']) SOLO para obtener un
 * `id` de rotación en `borrador` — es la única forma de conseguir uno. Los 1-2 asignaciones
 * que esa llamada crea de paso (para hoy/mañana) se borran de inmediato con `DELETE
 * /v1/rotaciones/:id/asignaciones/:asignacionId` (ese endpoint SÍ existe — ver punto 2) antes
 * de que el Paso 11 cree, a mano y una por una, las asignaciones reales con el
 * vehículo/conductor/ruta exactos que pide el brief. El resultado final (rotación en
 * `borrador`, con exactamente las asignaciones que el brief especifica, publicada al final)
 * es el que el brief pide — el camino para llegar ahí no es el que asumía.
 *
 * ### 2) SÍ existe un DELETE — pero solo para asignaciones, no para el resto
 *
 * El brief dice en general "no hay endpoint DELETE" como justificación del diseño reanudable
 * de este script. Es cierto para sindicatos/socios/líneas/rutas/puntos de control/
 * vehículos/conductores (confirmado leyendo cada controller — solo GET/POST/PATCH). Pero
 * `rotaciones.controller.ts` SÍ expone `DELETE /v1/rotaciones/:id/asignaciones/:asignacionId`
 * (solo mientras la rotación está en `borrador`) — es justo lo que este script usa en el
 * punto 1 de arriba para limpiar el auto-generado de `generar()`. No cambia el diseño
 * reanudable del resto del script (todo lo demás sigue sin DELETE), pero corrige la premisa.
 *
 * ## Otras decisiones tomadas para poder ejecutar el brief — revisar
 *
 *   - **Geometría Z12** (paso 4): el brief pide replicar `cargar-circuito-z12.ts:110-136`
 *     (subida + conector interpolado cada ~50 m vía la parada "Salomón" + bajada). Ese script
 *     ubica a Salomón dinámicamente como "el punto de control obligatorio ya activo en la
 *     ruta real, más cercano al inicio de la traza de bajada" — funciona porque edita una
 *     ruta que YA tenía puntos de control obligatorios cargados de antes. Acá no hay ruta
 *     previa (sindicato nuevo desde cero), así que no hay de dónde leer esa coordenada en
 *     vivo. Se usa la coordenada real de Salomón tal como quedó en producción
 *     (`[-66.2285535, -17.3174191]`, id `c7d48c43-...` en el snapshot
 *     `scripts/backups-z12/2026-09-08T14-30-54-529Z/puntos-control-ruta-objetivo-antes.json`)
 *     como constante — verificado en esta misma tarea que es el punto obligatorio activo más
 *     cercano al inicio de `bajada_simp.json` (201.7 m, mismo orden de magnitud que los ~200 m
 *     que documenta `cargar-circuito-z12.ts`) y que los 26 puntos de control de ese mismo
 *     snapshot caen a ≤79 m de la geometría reconstruida acá (tolerancia del servidor: 100 m,
 *     `RUTA_PROXIMIDAD_TOLERANCIA_METROS` en `apps/api/src/common/geo/proximidad-ruta.ts`) —
 *     no es un número inventado, es el dato real verificado contra la geometría que este
 *     script realmente construye.
 *   - **Puntos de control Z12** (paso 5): el brief dice "los que use cargar-circuito-z12.ts
 *     para la Z12" — ese script no trae su propio JSON de puntos, los toma de los que YA
 *     existen en la ruta real de producción. Se usan esos mismos 26 puntos (coordenada,
 *     `radioToleranciaM`, `obligatorio`), extraídos del mismo snapshot de arriba y guardados
 *     en `scripts/data/z12-circuito/puntos-control.json` para que este script sea
 *     autocontenido (no lee backups de otra corrida en tiempo de ejecución).
 *   - **Puntos de control 120 — 4 de los 16 de `puntos-control-andry.json` NO se mandan**
 *     (paso 5): `A2`, `A3`, `C2`, `C3` están sobre los ramales "Barrio Flores" y "Collpapampa"
 *     del sindicato real — a 1.2, 2.6, 2.6 y 2.7 km de la geometría tronco-only que este
 *     script crea para la línea 120 (ida + vuelta concatenadas, SIN los 8 ramales — el brief
 *     pide "dos rutas", no diez). `validarCercaniaARuta`
 *     (`apps/api/src/common/geo/proximidad-ruta.ts`) rechaza con 400 cualquier punto a más de
 *     100 m de la geometría de su ruta — confirmado calculando la distancia real
 *     punto-a-polilínea de los 16 puntos contra la geometría tronco antes de escribir este
 *     script (A1/C1/N1..N10 quedan todos a <15 m; A2/A3/C2/C3 dan 1.2-2.7 km). Mandarlos
 *     igual haría abortar el script en el primer 400. Se mandan los 12 restantes (`A1`,
 *     `N1`..`N10`, `C1`) con `orden` 0..11 en secuencia de recorrido real (terminal norte →
 *     ida → terminal sur → retorno; `C1` al final, mismo lugar físico que `A1` a ~12 m). Si
 *     el CTO quiere los 4 puntos de ramal igual, hace falta crear esas 2 rutas-ramal aparte
 *     (fuera del alcance "dos rutas" de este brief) — no se improvisó esa extensión acá.
 *   - **Socios**: se crea 1 socio por vehículo (2 en total) — el brief deja "los que hagan
 *     falta para colgar los vehículos" sin fijar la cantidad exacta.
 *   - **Reparto de conductor por turno** (paso 11): fijo por horario, no rotativo día a día —
 *     conductor #1/#4 siempre `manana`, #2/#5 siempre `tarde`, #3/#6 siempre `noche`, para su
 *     vehículo. Simple, determinístico, cumple "3 conductores por vehículo por día" tal como
 *     lo pide el brief.
 *
 * ## Qué hace, en orden (ver detalle de cada paso en su función)
 *
 *   1. `crearSindicato`            — POST /v1/sindicatos
 *   2. `crearSocios`               — POST /v1/socios × 2
 *   3. `crearLineas`               — POST /v1/lineas × 2 (Z12, 120 — con branding)
 *   4. `crearRutas`                — POST /v1/lineas/:id/rutas × 2 (geometría real)
 *   5. `crearPuntosControl`        — POST /v1/rutas/:id/puntos-control × (26 + 12)
 *   6. `crearVehiculos`            — POST /v1/vehiculos × 2 (nacen `pendiente`)
 *   7. `activarVehiculos`          — PATCH /v1/vehiculos/:id/estado × 2 (a `activo`)
 *   8. `crearConductores`          — POST /v1/conductores × 6
 *   9. `fijarPines`                — PUT /v1/mobile/credenciales/conductores/:id × 6
 *   10. `crearRotacionBorrador`    — POST /v1/rotaciones (+ limpieza del auto-generado)
 *   11. `crearAsignaciones`        — POST /v1/rotaciones/:id/asignaciones × (2×3×DIAS_ROTACION)
 *   12. `publicarRotacion`         — POST /v1/rotaciones/:id/publicar
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================================
// Resolución de rutas — mismo patrón que el resto de scripts/: independiente del cwd desde
// donde se invoque.
// ============================================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const ESTADO_PATH = path.join(REPO_ROOT, 'scripts/.estado-siembra-produccion.json');
const Z12_SUBIDA_PATH = path.join(REPO_ROOT, 'scripts/data/z12-circuito/subida_simp.json');
const Z12_BAJADA_PATH = path.join(REPO_ROOT, 'scripts/data/z12-circuito/bajada_simp.json');
const Z12_PUNTOS_PATH = path.join(REPO_ROOT, 'scripts/data/z12-circuito/puntos-control.json');
const KML_120_PATH = path.join(REPO_ROOT, 'scripts/data/linea-120/linea-120-my-maps.kml');
const PUNTOS_120_PATH = path.join(REPO_ROOT, 'scripts/data/linea-120/puntos-control-andry.json');

// ============================================================================================
// CLI args + config de entorno
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=... QUIVO_ADMIN_PASSWORD=... QUIVO_PIN_1=... .. QUIVO_PIN_6=... \\
    packages/db/node_modules/.bin/tsx scripts/sembrar-piloto-produccion.ts [opciones]

Opciones:
  --apply    Aplica de verdad contra la API (POST/PATCH/PUT/DELETE reales). Sin esto, siempre
             dry-run: imprime el plan y no manda ninguna escritura.
  --help     Esta ayuda.

Variables de entorno (ver cabecera del archivo para el detalle completo):
  QUIVO_API_URL         Opcional. Default: API de producción.
  QUIVO_ADMIN_EMAIL      Obligatoria.
  QUIVO_ADMIN_PASSWORD   Obligatoria. Nunca se loguea.
  QUIVO_PIN_1..QUIVO_PIN_6  Obligatorias, 6 dígitos distintos entre sí. Nunca se loguean.
  QUIVO_DIAS_ROTACION    Opcional. Default 21.
`);
  process.exit(0);
}

const API_URL = (process.env.QUIVO_API_URL ?? 'https://quivo-api-741758083365.southamerica-west1.run.app').replace(/\/+$/, '');

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim().length === 0) {
    console.error(`Falta la variable de entorno ${nombre}. Abortando antes de tocar nada.`);
    process.exit(1);
  }
  return valor;
}

const ADMIN_EMAIL = requerirEnv('QUIVO_ADMIN_EMAIL');
const ADMIN_PASSWORD = requerirEnv('QUIVO_ADMIN_PASSWORD');
const PINES_RAW = [1, 2, 3, 4, 5, 6].map((n) => requerirEnv(`QUIVO_PIN_${n}`));

const PIN_REGEX = /^\d{6,12}$/;
for (const [i, pin] of PINES_RAW.entries()) {
  if (!PIN_REGEX.test(pin)) {
    console.error(`QUIVO_PIN_${i + 1} no tiene el formato esperado (6 a 12 dígitos). Abortando.`);
    process.exit(1);
  }
}
if (new Set(PINES_RAW).size !== PINES_RAW.length) {
  console.error(
    'Dos o más de QUIVO_PIN_1..QUIVO_PIN_6 son iguales. Dos conductores del mismo vehículo con ' +
      'el mismo PIN hacen que el login móvil devuelva 401 a ambos. Abortando antes de tocar nada.',
  );
  process.exit(1);
}
// PINES_RAW ya tiene longitud 6 fija (un requerirEnv por índice 1..6) — el cast documenta esa
// invariante para TS (noUncheckedIndexedAccess no lo puede inferir de un .map).
const PINES = PINES_RAW as [string, string, string, string, string, string];

const DIAS_ROTACION_RAW = process.env.QUIVO_DIAS_ROTACION;
const DIAS_ROTACION = DIAS_ROTACION_RAW ? Number(DIAS_ROTACION_RAW) : 21;
if (!Number.isInteger(DIAS_ROTACION) || DIAS_ROTACION < 1) {
  console.error(`QUIVO_DIAS_ROTACION debe ser un entero positivo, se recibió "${DIAS_ROTACION_RAW}". Abortando.`);
  process.exit(1);
}

// ============================================================================================
// Estado local (reanudabilidad) — ver "Reanudable e idempotente" en la cabecera.
// ============================================================================================

interface EstadoSiembra {
  sindicatoId?: string;
  socios?: { z12?: string; l120?: string };
  lineas?: { z12?: string; l120?: string };
  rutas?: { z12?: string; l120?: string };
  /** Ids devueltos por cada POST de punto de control, en el mismo orden/índice que la lista
   * fuente correspondiente (`PUNTOS_Z12`/`PUNTOS_120_A_ENVIAR`) — permite reanudar a mitad de
   * un loop de 26 o 12 llamadas. */
  puntosControl?: { z12?: (string | undefined)[]; l120?: (string | undefined)[] };
  vehiculos?: { z12?: string; l120?: string };
  vehiculosActivados?: { z12?: boolean; l120?: boolean };
  /** 6 entradas, índice 0..5 = conductor 1..6. */
  conductores?: (string | undefined)[];
  pinesFijados?: (boolean | undefined)[];
  rotacionId?: string;
  rotacionJunkLimpiado?: boolean;
  /** Clave `${vehiculoId}|${fechaIso}|${horario}` -> id de asignación. */
  asignaciones?: Record<string, string>;
  rotacionPublicada?: boolean;
}

function cargarEstado(): EstadoSiembra {
  if (!fs.existsSync(ESTADO_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8')) as EstadoSiembra;
  } catch (err) {
    console.error(`No se pudo leer/parsear ${ESTADO_PATH} — corrupto. Abortando (revisar a mano antes de continuar).`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const estado: EstadoSiembra = cargarEstado();

function guardarEstado(): void {
  // Solo en --apply: en dry-run el estado nunca se toca (ni se lee dos veces distinto, ni se
  // escribe), para que un dry-run nunca tenga efectos secundarios en disco.
  if (!APLICAR) return;
  fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2) + '\n');
}

// ============================================================================================
// Cliente HTTP mínimo — un solo punto de entrada para todas las llamadas, para que el
// contrato "para en el primer error con status+body" y "nunca loguea pin/password" se cumpla
// en un solo lugar en vez de repetirse en cada paso.
// ============================================================================================

let accessToken: string | undefined;
let llamadasPlaneadas = 0;
let llamadasEjecutadas = 0;

function redactar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(redactar);
  if (valor && typeof valor === 'object') {
    const copia: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      copia[k] = k === 'pin' || k === 'password' ? '(oculto)' : redactar(v);
    }
    return copia;
  }
  return valor;
}

/** Resumen compacto de un body para el plan de dry-run — nunca el JSON completo de geometrías
 * (podrían ser miles de vértices), solo sus claves "livianas" + el conteo de vértices si
 * corresponde. */
function resumirBody(body: unknown): string {
  if (body === undefined) return '(sin body)';
  const redactado = redactar(body) as Record<string, unknown>;
  const resumen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(redactado)) {
    if (k === 'geometria' && v && typeof v === 'object' && 'coordinates' in v) {
      const coords = (v as { coordinates: unknown[] }).coordinates;
      resumen[k] = `LineString(${coords.length} vértices)`;
    } else {
      resumen[k] = v;
    }
  }
  return JSON.stringify(resumen);
}

class ErrorApi extends Error {}

/** Único punto desde el que este script habla con la API. En dry-run nunca llama a `fetch` —
 * solo cuenta y, si `logPlan` no es false, imprime la línea del plan. En `--apply`, hace la
 * llamada real y para el script entero (throw) en el primer error, con status + cuerpo. */
async function llamar(metodo: string, path: string, body?: unknown, opts: { logPlan?: boolean } = {}): Promise<unknown> {
  llamadasPlaneadas++;
  if (!APLICAR) {
    if (opts.logPlan !== false) {
      console.log(`  SE HARÍA: ${metodo} ${path}  body=${resumirBody(body)}`);
    }
    return undefined;
  }

  llamadasEjecutadas++;
  const res = await fetch(`${API_URL}${path}`, {
    method: metodo,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

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
    const cuerpoTexto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo, null, 2);
    throw new ErrorApi(`${metodo} ${path} → HTTP ${res.status}\n${cuerpoTexto}`);
  }
  return cuerpo;
}

// ============================================================================================
// Login — POST /v1/auth/login (5 intentos/min, se llama UNA sola vez por corrida).
// ============================================================================================

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; rol: string; sindicatoId: string | null };
}

async function login(): Promise<void> {
  console.log('--- Login (POST /v1/auth/login) ---');
  if (!APLICAR) {
    llamadasPlaneadas++;
    console.log('  SE HARÍA: POST /v1/auth/login  body={"email":"(oculto)","password":"(oculto)"}');
    console.log('  (dry-run: no se autentica de verdad, los pasos siguientes solo listan lo que harían)');
    return;
  }
  const respuesta = (await llamar('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { logPlan: false })) as LoginResponse;
  accessToken = respuesta.accessToken;
  console.log(`  OK — autenticado como ${respuesta.user.email} (rol=${respuesta.user.rol}).`);
  if (respuesta.user.rol !== 'admin_quivo') {
    console.warn(
      `  ⚠ El usuario autenticado tiene rol "${respuesta.user.rol}", no "admin_quivo". Varios pasos de este ` +
        'script (crear sindicato, generar rotación) exigen admin_quivo — es probable que fallen más adelante.',
    );
  }
}

// ============================================================================================
// Geometría — Z12 (subida + conector interpolado vía Salomón + bajada) y 120 (ida + vuelta,
// concatenadas sin deduplicar). Helpers copiados a propósito de cargar-circuito-z12.ts /
// cargar-linea-120.ts (mismo motivo que esos dos: este script es standalone, no importa nada
// de packages/ en runtime).
// ============================================================================================

type Coord = [number, number]; // [lon, lat], GeoJSON estándar (RFC 7946)

const RADIO_TIERRA_METROS = 6_371_000;

function haversineMetros(a: Coord, b: Coord): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h = senoLat * senoLat + Math.cos(latA * rad) * Math.cos(latB * rad) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function redondear(n: number): number {
  return Math.round(n * 1e7) / 1e7; // ~1.1 cm de precisión
}

/** Copiado de cargar-circuito-z12.ts — interpola una línea recta (lon/lat lineal, no
 * geodésica) entre `inicio` y `fin`, vértices espaciados ~`espaciadoM` metros. Solo los
 * puntos INTERIORES (sin `inicio` ni `fin`), para que el llamador no duplique vértices. */
function interpolarRecta(inicio: Coord, fin: Coord, espaciadoM: number): Coord[] {
  const distanciaTotal = haversineMetros(inicio, fin);
  const segmentos = Math.max(1, Math.round(distanciaTotal / espaciadoM));
  const puntos: Coord[] = [];
  for (let i = 1; i < segmentos; i++) {
    const t = i / segmentos;
    puntos.push([redondear(inicio[0] + (fin[0] - inicio[0]) * t), redondear(inicio[1] + (fin[1] - inicio[1]) * t)]);
  }
  return puntos;
}

function cargarLineStringJson(rutaArchivo: string): Coord[] {
  const contenido = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8')) as { type: string; coordinates: Coord[] };
  if (contenido.type !== 'LineString' || !Array.isArray(contenido.coordinates) || contenido.coordinates.length < 2) {
    throw new Error(`${rutaArchivo} no es un GeoJSON LineString válido (>= 2 vértices).`);
  }
  return contenido.coordinates.map(([lon, lat]) => [redondear(lon), redondear(lat)] as Coord);
}

const CONECTOR_ESPACIADO_M = 50;

/** Coordenada real de la parada "Salomón" — ver "Otras decisiones" en la cabecera del
 * archivo para de dónde sale este número y cómo se verificó. */
const SALOMON_COORD: Coord = [-66.2285535, -17.3174191];

interface GeometriaZ12 {
  coordinates: Coord[];
}

function construirGeometriaZ12(): GeometriaZ12 {
  const subida = cargarLineStringJson(Z12_SUBIDA_PATH);
  const bajada = cargarLineStringJson(Z12_BAJADA_PATH);
  const subidaFin = subida[subida.length - 1]!;
  const bajadaInicio = bajada[0]!;

  const conectorTramo1 = interpolarRecta(subidaFin, SALOMON_COORD, CONECTOR_ESPACIADO_M);
  const conectorTramo2 = interpolarRecta(SALOMON_COORD, bajadaInicio, CONECTOR_ESPACIADO_M);
  const coordinates: Coord[] = [...subida, ...conectorTramo1, SALOMON_COORD, ...conectorTramo2, ...bajada];

  console.log(
    `  Z12: subida ${subida.length} + conector ${conectorTramo1.length + 1 + conectorTramo2.length} ` +
      `(vía Salomón) + bajada ${bajada.length} = ${coordinates.length} vértices.`,
  );
  return { coordinates };
}

// --- Parser mínimo del KML de la 120 — regex sobre texto crudo, mismo motivo que
// cargar-linea-120.ts (no hay librería XML en node_modules del repo). Acá solo se necesitan
// las 2 LineString del tronco, no las 8 de ramal ni las 10 paradas.
function extraerLineStringKml(kmlTexto: string, nombrePlacemark: string): Coord[] {
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;
  while ((match = placemarkRegex.exec(kmlTexto)) !== null) {
    const bloque = match[1]!;
    const nombreMatch = bloque.match(/<name>([\s\S]*?)<\/name>/);
    const nombre = nombreMatch ? nombreMatch[1]!.trim() : '';
    if (nombre !== nombrePlacemark) continue;
    const lsMatch = bloque.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!lsMatch) throw new Error(`Placemark "${nombrePlacemark}" no tiene <LineString><coordinates>.`);
    const coords = lsMatch[1]!
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
    if (coords.length < 2) throw new Error(`Placemark "${nombrePlacemark}": menos de 2 vértices.`);
    return coords;
  }
  throw new Error(`No se encontró el Placemark "${nombrePlacemark}" en ${KML_120_PATH}.`);
}

const KML_TRONCO_IDA_120 = 'RUTA 120 DE NORTE A SUD';
const KML_TRONCO_VUELTA_120 = 'RETORNO LINEA 120 SUD A NORTE';

function construirGeometria120(): GeometriaZ12 {
  const kmlTexto = fs.readFileSync(KML_120_PATH, 'utf8');
  const ida = extraerLineStringKml(kmlTexto, KML_TRONCO_IDA_120);
  const vuelta = extraerLineStringKml(kmlTexto, KML_TRONCO_VUELTA_120);
  // Concatenados TAL CUAL, sin deduplicar ningún vértice (brief explícito) — mismo criterio
  // que la corrida real de cargar-linea-120.ts documenta para su ruta "circuito".
  const coordinates: Coord[] = [...ida, ...vuelta];
  console.log(`  120: ida ${ida.length} + vuelta ${vuelta.length} (sin deduplicar) = ${coordinates.length} vértices.`);
  return { coordinates };
}

// ============================================================================================
// Puntos de control — datos fuente
// ============================================================================================

interface PuntoControlFuente {
  id: string;
  lon: number;
  lat: number;
  radioToleranciaM: number;
  obligatorio: boolean;
}

function cargarPuntosZ12(): PuntoControlFuente[] {
  const contenido = JSON.parse(fs.readFileSync(Z12_PUNTOS_PATH, 'utf8')) as {
    puntos: { orden: number; lon: number; lat: number; radioToleranciaM: number; obligatorio: boolean }[];
  };
  return contenido.puntos
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((p) => ({ id: `z12-orden-${p.orden}`, lon: p.lon, lat: p.lat, radioToleranciaM: p.radioToleranciaM, obligatorio: p.obligatorio }));
}

interface PuntoControlAndry {
  id: string;
  lat: number;
  lon: number;
  nota: string;
}

/** Los 12 de los 16 puntos de `puntos-control-andry.json` que SÍ caen a <100 m de la
 * geometría tronco-only de la 120 (ver "Otras decisiones" en la cabecera) — en secuencia real
 * de recorrido: terminal norte → ida norte→sud → terminal sur → retorno sud→norte, con `C1`
 * (mismo lugar físico que `A1`, ~12 m) al final. `A2`/`A3`/`C2`/`C3` (ramales) quedan afuera
 * a propósito — no se mandan, se documenta por qué en la cabecera del archivo. */
const ORDEN_PUNTOS_120 = ['A1', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'C1'] as const;
const PUNTOS_120_OMITIDOS = ['A2', 'A3', 'C2', 'C3'] as const;

/** `radioToleranciaM`/`obligatorio` para los puntos de la 120 — mismo criterio que documenta
 * `cargar-linea-120.ts` para el tronco real: 150 m de tolerancia (igual que los puntos activos
 * de la Z12 de este mismo script); `obligatorio = true` en los dos extremos geométricos
 * (`A1` terminal norte, `N10` cierre del retorno) y en `N6` (terminal sur, donde arranca el
 * regreso) — el resto, intermedios, en `false`. `C1` (mismo lugar físico que `A1`) va en
 * `false`: ya está cubierto por `A1` como extremo obligatorio, no hace falta duplicarlo. */
const RADIO_TOLERANCIA_120_M = 150;
const OBLIGATORIOS_120 = new Set(['A1', 'N6', 'N10']);

function cargarPuntos120(): { aEnviar: PuntoControlFuente[]; omitidos: PuntoControlAndry[] } {
  const contenido = JSON.parse(fs.readFileSync(PUNTOS_120_PATH, 'utf8')) as { puntos: PuntoControlAndry[] };
  const porId = new Map(contenido.puntos.map((p) => [p.id, p]));

  const aEnviar: PuntoControlFuente[] = ORDEN_PUNTOS_120.map((id) => {
    const p = porId.get(id);
    if (!p) throw new Error(`${PUNTOS_120_PATH}: no se encontró el punto "${id}" esperado por ORDEN_PUNTOS_120.`);
    return {
      id: p.id,
      lon: p.lon,
      lat: p.lat,
      radioToleranciaM: RADIO_TOLERANCIA_120_M,
      obligatorio: OBLIGATORIOS_120.has(p.id),
    };
  });

  const omitidos = PUNTOS_120_OMITIDOS.map((id) => {
    const p = porId.get(id);
    if (!p) throw new Error(`${PUNTOS_120_PATH}: no se encontró el punto "${id}" esperado por PUNTOS_120_OMITIDOS.`);
    return p;
  });

  return { aEnviar, omitidos };
}

// ============================================================================================
// Fechas — copiado del mismo patrón que crear-credenciales-piloto.ts/cargar-linea-120.ts
// (calendario Bolivia, viajan como texto 'YYYY-MM-DD').
// ============================================================================================

const BOLIVIA_UTC_OFFSET_HOURS = 4;

function fechaActualBolivia(ahora: Date = new Date()): Date {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}

function sumarDiasUtc(fecha: Date, dias: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + dias));
}

function fechaIsoDeUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

// ============================================================================================
// Datos de las entidades a crear — nombres/documentos ficticios pero válidos (ver regex de
// cada schema en packages/shared/src/entities/*.ts e identidad-bolivia.ts).
// ============================================================================================

const NOMBRE_SINDICATO = 'Sindicato Piloto — Producción';

const SOCIOS = [
  { clave: 'z12' as const, nombre: 'Ramiro Quispe Mamani', documentoIdentidad: '9000101 CB' },
  { clave: 'l120' as const, nombre: 'Teodora Choque Flores', documentoIdentidad: '9000102 CB' },
];

const CONDUCTORES = [
  { nombre: 'Marco Antonio Villca Poma', documentoIdentidad: '9000001 CB', licenciaConducir: 'LIC-9000001' },
  { nombre: 'Elena Rocío Fernández Quispe', documentoIdentidad: '9000002 CB', licenciaConducir: 'LIC-9000002' },
  { nombre: 'Juan Carlos Mamani Rojas', documentoIdentidad: '9000003 CB', licenciaConducir: 'LIC-9000003' },
  { nombre: 'Betty Choquehuanca Yucra', documentoIdentidad: '9000004 CB', licenciaConducir: 'LIC-9000004' },
  { nombre: 'Gonzalo Iván Torrez Salazar', documentoIdentidad: '9000005 CB', licenciaConducir: 'LIC-9000005' },
  { nombre: 'Rosa Ninoska Aguilar Vargas', documentoIdentidad: '9000006 CB', licenciaConducir: 'LIC-9000006' },
] as const;

const HORARIOS = ['manana', 'tarde', 'noche'] as const;

// ============================================================================================
// Paso 1 — Sindicato
// ============================================================================================

async function crearSindicato(): Promise<string> {
  console.log('\n--- Paso 1: sindicato (POST /v1/sindicatos) ---');
  if (estado.sindicatoId) {
    console.log(`  Ya existe (estado local): ${estado.sindicatoId} — se omite.`);
    return estado.sindicatoId;
  }
  const body = { nombre: NOMBRE_SINDICATO, estado: 'activo' };
  const respuesta = (await llamar('POST', '/sindicatos', body)) as { id: string } | undefined;
  if (!APLICAR) return 'PENDIENTE:sindicato';
  estado.sindicatoId = respuesta!.id;
  guardarEstado();
  console.log(`  Creado: ${estado.sindicatoId}`);
  return estado.sindicatoId;
}

// ============================================================================================
// Paso 2 — Socios
// ============================================================================================

async function crearSocios(sindicatoId: string): Promise<{ z12: string; l120: string }> {
  console.log('\n--- Paso 2: socios (POST /v1/socios) ---');
  estado.socios ??= {};
  for (const socio of SOCIOS) {
    if (estado.socios[socio.clave]) {
      console.log(`  Socio ${socio.clave} ya existe (estado local): ${estado.socios[socio.clave]} — se omite.`);
      continue;
    }
    const body = { sindicatoId, nombre: socio.nombre, documentoIdentidad: socio.documentoIdentidad };
    const respuesta = (await llamar('POST', '/socios', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.socios[socio.clave] = respuesta!.id;
      guardarEstado();
      console.log(`  Socio ${socio.clave} creado: ${estado.socios[socio.clave]}`);
    }
  }
  return {
    z12: estado.socios.z12 ?? 'PENDIENTE:socio-z12',
    l120: estado.socios.l120 ?? 'PENDIENTE:socio-120',
  };
}

// ============================================================================================
// Paso 3 — Líneas (con branding)
// ============================================================================================

interface BrandingLinea {
  color: string;
  colorSecundario: string;
  colorTexto: string;
  colorTerciario: string;
  colorFondo: string;
  nombreCorto: string;
  lema: string;
  descripcion: string;
  distintivoTipo: 'numero';
  distintivoValor: string;
  cartelSuperior: string;
  cartelFormato: 'doble_clasico';
  cartelTitulo: string;
  cartelDetalle: string;
  cartelNumeroPosicion: 'izquierda';
  cartelLogoPosicion: 'ninguno';
  cartelColorTitulo: string;
  cartelColorDetalle: string;
  cartelColorNumero: string;
  cartelColorBorde: string;
}

const BRANDING_Z12: BrandingLinea = {
  color: '#E4572E',
  colorSecundario: '#1B1B1E',
  colorTexto: '#FFFFFF',
  colorTerciario: '#F2A93B',
  colorFondo: '#FFF4E8',
  nombreCorto: 'Z12',
  lema: 'Circuito Villa Armonía — Univalle — Salomón',
  descripcion: 'Circuito real del sindicato piloto, cargado con geometría GPS real.',
  distintivoTipo: 'numero',
  distintivoValor: 'Z12',
  cartelSuperior: 'Z12',
  cartelFormato: 'doble_clasico',
  cartelTitulo: 'Z12',
  cartelDetalle: 'Circuito',
  cartelNumeroPosicion: 'izquierda',
  cartelLogoPosicion: 'ninguno',
  cartelColorTitulo: '#FFFFFF',
  cartelColorDetalle: '#FFF4E8',
  cartelColorNumero: '#FFFFFF',
  cartelColorBorde: '#1B1B1E',
};

const BRANDING_120: BrandingLinea = {
  color: '#2864DC',
  colorSecundario: '#0F766E',
  colorTexto: '#FFFFFF',
  colorTerciario: '#FD9E15',
  colorFondo: '#EFF6FF',
  nombreCorto: '120',
  lema: 'Norte–Sud, ida y vuelta',
  descripcion: 'Tronco norte-sud del sindicato piloto (ida + vuelta), geometría real del KML del sindicato.',
  distintivoTipo: 'numero',
  distintivoValor: '120',
  cartelSuperior: '120',
  cartelFormato: 'doble_clasico',
  cartelTitulo: '120',
  cartelDetalle: 'Norte-Sud',
  cartelNumeroPosicion: 'izquierda',
  cartelLogoPosicion: 'ninguno',
  cartelColorTitulo: '#FFFFFF',
  cartelColorDetalle: '#EFF6FF',
  cartelColorNumero: '#FFFFFF',
  cartelColorBorde: '#0F766E',
};

const CIUDAD_ID = 'cochabamba';

async function crearLineas(sindicatoId: string): Promise<{ z12: string; l120: string }> {
  console.log('\n--- Paso 3: líneas Z12 y 120, con branding (POST /v1/lineas) ---');
  estado.lineas ??= {};

  const crear = async (clave: 'z12' | 'l120', codigo: string, nombre: string, branding: BrandingLinea) => {
    if (estado.lineas![clave]) {
      console.log(`  Línea ${codigo} ya existe (estado local): ${estado.lineas![clave]} — se omite.`);
      return;
    }
    const body = { sindicatoId, cityId: CIUDAD_ID, codigo, nombre, ...branding };
    const respuesta = (await llamar('POST', '/lineas', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.lineas![clave] = respuesta!.id;
      guardarEstado();
      console.log(`  Línea ${codigo} creada: ${estado.lineas![clave]}`);
    }
  };

  await crear('z12', 'Z12', 'Zona 12', BRANDING_Z12);
  await crear('l120', '120', 'Línea 120', BRANDING_120);

  return {
    z12: estado.lineas.z12 ?? 'PENDIENTE:linea-z12',
    l120: estado.lineas.l120 ?? 'PENDIENTE:linea-120',
  };
}

// ============================================================================================
// Paso 4 — Rutas con geometría real
// ============================================================================================

async function crearRutas(lineaZ12Id: string, linea120Id: string): Promise<{ z12: string; l120: string }> {
  console.log('\n--- Paso 4: rutas con geometría real (POST /v1/lineas/:lineaId/rutas) ---');
  estado.rutas ??= {};

  if (!estado.rutas.z12) {
    const geometria = construirGeometriaZ12();
    const body = { sentido: 'circuito', geometria: { type: 'LineString', coordinates: geometria.coordinates }, estado: 'activo' };
    const respuesta = (await llamar('POST', `/lineas/${lineaZ12Id}/rutas`, body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.rutas.z12 = respuesta!.id;
      guardarEstado();
      console.log(`  Ruta Z12 creada: ${estado.rutas.z12}`);
    }
  } else {
    console.log(`  Ruta Z12 ya existe (estado local): ${estado.rutas.z12} — se omite.`);
  }

  if (!estado.rutas.l120) {
    const geometria = construirGeometria120();
    const body = { sentido: 'circuito', geometria: { type: 'LineString', coordinates: geometria.coordinates }, estado: 'activo' };
    const respuesta = (await llamar('POST', `/lineas/${linea120Id}/rutas`, body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.rutas.l120 = respuesta!.id;
      guardarEstado();
      console.log(`  Ruta 120 creada: ${estado.rutas.l120}`);
    }
  } else {
    console.log(`  Ruta 120 ya existe (estado local): ${estado.rutas.l120} — se omite.`);
  }

  return {
    z12: estado.rutas.z12 ?? 'PENDIENTE:ruta-z12',
    l120: estado.rutas.l120 ?? 'PENDIENTE:ruta-120',
  };
}

// ============================================================================================
// Paso 5 — Puntos de control
// ============================================================================================

async function crearPuntosControlPorRuta(rutaId: string, puntos: PuntoControlFuente[], destino: (string | undefined)[]): Promise<void> {
  for (let i = 0; i < puntos.length; i++) {
    if (destino[i]) {
      console.log(`    [${i}] ${puntos[i]!.id}: ya existe (estado local): ${destino[i]} — se omite.`);
      continue;
    }
    const punto = puntos[i]!;
    const body = {
      orden: i,
      coord: { type: 'Point', coordinates: [punto.lon, punto.lat] },
      radioToleranciaM: punto.radioToleranciaM,
      obligatorio: punto.obligatorio,
      estado: 'activo',
    };
    const respuesta = (await llamar('POST', `/rutas/${rutaId}/puntos-control`, body, { logPlan: false })) as { id: string } | undefined;
    if (APLICAR) {
      destino[i] = respuesta!.id;
      guardarEstado();
    }
  }
}

async function crearPuntosControl(rutaZ12Id: string, ruta120Id: string): Promise<void> {
  console.log('\n--- Paso 5: puntos de control (POST /v1/rutas/:rutaId/puntos-control) ---');

  const puntosZ12 = cargarPuntosZ12();
  const { aEnviar: puntos120, omitidos } = cargarPuntos120();

  console.log(`  Z12: ${puntosZ12.length} puntos (de scripts/data/z12-circuito/puntos-control.json).`);
  console.log(`  120: ${puntos120.length} puntos a enviar (${ORDEN_PUNTOS_120.join(', ')}).`);
  console.log(
    `  120: ${omitidos.length} puntos OMITIDOS a propósito (quedan a >1 km de la geometría tronco-only): ` +
      omitidos.map((p) => p.id).join(', ') +
      ' — ver "Otras decisiones" en la cabecera del archivo.',
  );

  estado.puntosControl ??= {};
  estado.puntosControl.z12 ??= new Array(puntosZ12.length).fill(undefined);
  estado.puntosControl.l120 ??= new Array(puntos120.length).fill(undefined);

  if (!APLICAR) {
    const pendientesZ12 = puntosZ12.filter((_, i) => !estado.puntosControl!.z12![i]).length;
    const pendientes120 = puntos120.filter((_, i) => !estado.puntosControl!.l120![i]).length;
    llamadasPlaneadas += pendientesZ12 + pendientes120;
    console.log(`  SE HARÍAN: ${pendientesZ12} POST /v1/rutas/${rutaZ12Id}/puntos-control (Z12, orden 0..${puntosZ12.length - 1}).`);
    console.log(`  SE HARÍAN: ${pendientes120} POST /v1/rutas/${ruta120Id}/puntos-control (120, orden 0..${puntos120.length - 1}).`);
    return;
  }

  console.log('  Z12:');
  await crearPuntosControlPorRuta(rutaZ12Id, puntosZ12, estado.puntosControl.z12);
  console.log(`  Z12: ${estado.puntosControl.z12.filter(Boolean).length}/${puntosZ12.length} puntos listos.`);

  console.log('  120:');
  await crearPuntosControlPorRuta(ruta120Id, puntos120, estado.puntosControl.l120);
  console.log(`  120: ${estado.puntosControl.l120.filter(Boolean).length}/${puntos120.length} puntos listos.`);
}

// ============================================================================================
// Paso 6 — Vehículos (nacen 'pendiente')
// ============================================================================================

interface DatosVehiculo {
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  capacidad: number;
}

const VEHICULO_Z12: DatosVehiculo = { placa: '9001TST', tipo: 'minibus', marca: 'Toyota', modelo: 'Hiace', color: 'blanco', capacidad: 18 };
const VEHICULO_120: DatosVehiculo = { placa: '9004TST', tipo: 'minibus', marca: 'Nissan', modelo: 'Urvan', color: 'verde', capacidad: 18 };

async function crearVehiculos(sindicatoId: string, socioZ12Id: string, socio120Id: string): Promise<{ z12: string; l120: string }> {
  console.log('\n--- Paso 6: vehículos (POST /v1/vehiculos, nacen "pendiente") ---');
  estado.vehiculos ??= {};

  const crear = async (clave: 'z12' | 'l120', datos: DatosVehiculo, socioId: string) => {
    if (estado.vehiculos![clave]) {
      console.log(`  Vehículo ${datos.placa} ya existe (estado local): ${estado.vehiculos![clave]} — se omite.`);
      return;
    }
    const body = {
      sindicatoId,
      socioId,
      placa: datos.placa,
      tipo: datos.tipo,
      marca: datos.marca,
      modelo: datos.modelo,
      color: datos.color,
      colorSecundario: null,
      capacidad: datos.capacidad,
    };
    const respuesta = (await llamar('POST', '/vehiculos', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.vehiculos![clave] = respuesta!.id;
      guardarEstado();
      console.log(`  Vehículo ${datos.placa} creado: ${estado.vehiculos![clave]}`);
    }
  };

  await crear('z12', VEHICULO_Z12, socioZ12Id);
  await crear('l120', VEHICULO_120, socio120Id);

  return {
    z12: estado.vehiculos.z12 ?? 'PENDIENTE:vehiculo-z12',
    l120: estado.vehiculos.l120 ?? 'PENDIENTE:vehiculo-120',
  };
}

// ============================================================================================
// Paso 7 — Activar vehículos
// ============================================================================================

async function activarVehiculos(vehiculoZ12Id: string, vehiculo120Id: string): Promise<void> {
  console.log('\n--- Paso 7: activar vehículos (PATCH /v1/vehiculos/:id/estado) ---');
  estado.vehiculosActivados ??= {};

  const activar = async (clave: 'z12' | 'l120', vehiculoId: string, placa: string) => {
    if (estado.vehiculosActivados![clave]) {
      console.log(`  Vehículo ${placa} ya estaba activado (estado local) — se omite.`);
      return;
    }
    await llamar('PATCH', `/vehiculos/${vehiculoId}/estado`, { estado: 'activo' });
    if (APLICAR) {
      estado.vehiculosActivados![clave] = true;
      guardarEstado();
      console.log(`  Vehículo ${placa} activado.`);
    }
  };

  await activar('z12', vehiculoZ12Id, VEHICULO_Z12.placa);
  await activar('l120', vehiculo120Id, VEHICULO_120.placa);
}

// ============================================================================================
// Paso 8 — Conductores
// ============================================================================================

async function crearConductores(sindicatoId: string): Promise<string[]> {
  console.log('\n--- Paso 8: 6 conductores (POST /v1/conductores) ---');
  estado.conductores ??= new Array(CONDUCTORES.length).fill(undefined);

  for (let i = 0; i < CONDUCTORES.length; i++) {
    if (estado.conductores[i]) {
      console.log(`  Conductor #${i + 1} ya existe (estado local): ${estado.conductores[i]} — se omite.`);
      continue;
    }
    const c = CONDUCTORES[i]!;
    const body = { sindicatoId, nombre: c.nombre, documentoIdentidad: c.documentoIdentidad, licenciaConducir: c.licenciaConducir };
    const respuesta = (await llamar('POST', '/conductores', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.conductores[i] = respuesta!.id;
      guardarEstado();
      console.log(`  Conductor #${i + 1} (${c.nombre}) creado: ${estado.conductores[i]}`);
    }
  }

  return estado.conductores.map((id, i) => id ?? `PENDIENTE:conductor-${i + 1}`);
}

// ============================================================================================
// Paso 9 — Fijar PIN de los 6 conductores
// ============================================================================================

async function fijarPines(conductorIds: string[]): Promise<void> {
  console.log('\n--- Paso 9: fijar PIN (PUT /v1/mobile/credenciales/conductores/:id) ---');
  estado.pinesFijados ??= new Array(CONDUCTORES.length).fill(undefined);

  for (let i = 0; i < CONDUCTORES.length; i++) {
    if (estado.pinesFijados[i]) {
      console.log(`  PIN del conductor #${i + 1} ya estaba fijado (estado local) — se omite.`);
      continue;
    }
    // body real nunca se loguea (redactar() oculta "pin" en resumirBody) — acá tampoco se
    // arma ningún console.log con PINES[i] directo.
    await llamar('PUT', `/mobile/credenciales/conductores/${conductorIds[i]}`, { pin: PINES[i] });
    if (APLICAR) {
      estado.pinesFijados[i] = true;
      guardarEstado();
      console.log(`  PIN del conductor #${i + 1} fijado.`);
    }
  }
}

// ============================================================================================
// Paso 10 — Rotación en borrador (ver "Correcciones sobre el brief", punto 1, en la cabecera)
// ============================================================================================

interface AsignacionApi {
  id: string;
  vehiculoId: string;
  fecha: string;
  horario: string;
}

async function crearRotacionBorrador(sindicatoId: string, rutaZ12Id: string, ruta120Id: string): Promise<string> {
  console.log('\n--- Paso 10: rotación en borrador (POST /v1/rotaciones) ---');
  console.log(
    '  Nota: este endpoint es "generar" (auto-asigna), no "crear vacío" — ver "Correcciones sobre el ' +
      'brief" en la cabecera del archivo. Se usa acá con el mínimo posible solo para obtener un id de ' +
      'rotación en borrador; lo que auto-genere se borra antes del Paso 11.',
  );

  if (estado.rotacionId) {
    console.log(`  Ya existe (estado local): ${estado.rotacionId} — se omite la generación.`);
  } else {
    const hoy = fechaIsoDeUtc(fechaActualBolivia());
    const periodo = `piloto-${hoy.replace(/-/g, '')}`;
    const body = { sindicatoId, periodo, rutaIds: [rutaZ12Id, ruta120Id], fechas: [hoy], horarios: ['manana'] };
    const respuesta = (await llamar('POST', '/rotaciones', body)) as { id: string; asignaciones: AsignacionApi[] } | undefined;
    if (APLICAR) {
      estado.rotacionId = respuesta!.id;
      guardarEstado();
      console.log(`  Rotación creada (borrador): ${estado.rotacionId} — ${respuesta!.asignaciones.length} asignación(es) auto-generada(s) a limpiar.`);

      if (!estado.rotacionJunkLimpiado) {
        for (const a of respuesta!.asignaciones) {
          await llamar('DELETE', `/rotaciones/${estado.rotacionId}/asignaciones/${a.id}`, undefined, { logPlan: false });
        }
        estado.rotacionJunkLimpiado = true;
        guardarEstado();
        console.log(`  ${respuesta!.asignaciones.length} asignación(es) auto-generada(s) borrada(s).`);
      }
    } else {
      console.log('  SE HARÍA: limpiar (DELETE) cualquier asignación auto-generada por la llamada de arriba.');
    }
  }

  return estado.rotacionId ?? 'PENDIENTE:rotacion';
}

// ============================================================================================
// Paso 11 — Asignaciones (una llamada por asignación)
// ============================================================================================

interface GrupoAsignacion {
  vehiculoId: string;
  rutaId: string;
  /** 3 conductorId, índice 0=manana, 1=tarde, 2=noche — fijo por horario, no rotativo por
   * día (ver "Otras decisiones" en la cabecera). */
  conductoresPorHorario: [string, string, string];
}

async function crearAsignaciones(
  rotacionId: string,
  vehiculoZ12Id: string,
  rutaZ12Id: string,
  vehiculo120Id: string,
  ruta120Id: string,
  conductorIds: string[],
): Promise<void> {
  console.log(`\n--- Paso 11: asignaciones (POST /v1/rotaciones/:id/asignaciones), ${DIAS_ROTACION} días desde hoy ---`);

  const grupos: GrupoAsignacion[] = [
    { vehiculoId: vehiculoZ12Id, rutaId: rutaZ12Id, conductoresPorHorario: [conductorIds[0]!, conductorIds[1]!, conductorIds[2]!] },
    { vehiculoId: vehiculo120Id, rutaId: ruta120Id, conductoresPorHorario: [conductorIds[3]!, conductorIds[4]!, conductorIds[5]!] },
  ];

  const hoy = fechaActualBolivia();
  const fechas = Array.from({ length: DIAS_ROTACION }, (_, i) => fechaIsoDeUtc(sumarDiasUtc(hoy, i)));

  estado.asignaciones ??= {};

  const total = grupos.length * HORARIOS.length * fechas.length;
  let creadas = 0;
  let omitidas = 0;

  if (!APLICAR) {
    const pendientes = grupos.flatMap((g) => fechas.flatMap((f) => HORARIOS.map((h) => `${g.vehiculoId}|${f}|${h}`))).filter((k) => !estado.asignaciones![k]).length;
    llamadasPlaneadas += pendientes;
    console.log(
      `  SE HARÍAN: ${pendientes} POST /v1/rotaciones/${rotacionId}/asignaciones ` +
        `(2 vehículos × ${HORARIOS.length} horarios × ${fechas.length} días = ${total} en total, ` +
        `menos las que ya constan en el estado local).`,
    );
    console.log(`  Ejemplo de body: {"vehiculoId":"...","conductorId":"...","rutaId":"...","fecha":"${fechas[0]}","horario":"manana","orden":1}`);
    return;
  }

  for (const grupo of grupos) {
    for (const fecha of fechas) {
      for (let hIdx = 0; hIdx < HORARIOS.length; hIdx++) {
        const horario = HORARIOS[hIdx]!;
        const clave = `${grupo.vehiculoId}|${fecha}|${horario}`;
        if (estado.asignaciones[clave]) {
          omitidas++;
          continue;
        }
        const body = {
          vehiculoId: grupo.vehiculoId,
          conductorId: grupo.conductoresPorHorario[hIdx],
          rutaId: grupo.rutaId,
          fecha,
          horario,
          orden: hIdx + 1,
        };
        const respuesta = (await llamar('POST', `/rotaciones/${rotacionId}/asignaciones`, body, { logPlan: false })) as { id: string } | undefined;
        estado.asignaciones[clave] = respuesta!.id;
        guardarEstado();
        creadas++;
      }
    }
  }
  console.log(`  ${creadas} asignación(es) creada(s), ${omitidas} ya existían (estado local). Total esperado: ${total}.`);
}

// ============================================================================================
// Paso 12 — Publicar la rotación (va último — una vez publicada no acepta más asignaciones)
// ============================================================================================

async function publicarRotacion(rotacionId: string): Promise<void> {
  console.log('\n--- Paso 12: publicar rotación (POST /v1/rotaciones/:id/publicar) ---');
  if (estado.rotacionPublicada) {
    console.log('  Ya estaba publicada (estado local) — se omite.');
    return;
  }
  await llamar('POST', `/rotaciones/${rotacionId}/publicar`);
  if (APLICAR) {
    estado.rotacionPublicada = true;
    guardarEstado();
    console.log('  Rotación publicada.');
  }
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  console.log('='.repeat(90));
  console.log(`Siembra piloto en producción — modo: ${APLICAR ? 'APPLY (va a escribir contra la API real)' : 'DRY-RUN (no manda ninguna escritura)'}`);
  console.log(`API: ${API_URL}`);
  console.log(`Estado local: ${ESTADO_PATH} ${fs.existsSync(ESTADO_PATH) ? '(existe, se reanuda desde ahí)' : '(no existe, arranca de cero)'}`);
  console.log(`Días de rotación a sembrar: ${DIAS_ROTACION}`);
  console.log('='.repeat(90));

  await login();

  const sindicatoId = await crearSindicato();
  const socios = await crearSocios(sindicatoId);
  const lineas = await crearLineas(sindicatoId);
  const rutas = await crearRutas(lineas.z12, lineas.l120);
  await crearPuntosControl(rutas.z12, rutas.l120);
  const vehiculos = await crearVehiculos(sindicatoId, socios.z12, socios.l120);
  await activarVehiculos(vehiculos.z12, vehiculos.l120);
  const conductorIds = await crearConductores(sindicatoId);
  await fijarPines(conductorIds);
  const rotacionId = await crearRotacionBorrador(sindicatoId, rutas.z12, rutas.l120);
  await crearAsignaciones(rotacionId, vehiculos.z12, rutas.z12, vehiculos.l120, rutas.l120, conductorIds);
  await publicarRotacion(rotacionId);

  console.log('\n' + '='.repeat(90));
  if (APLICAR) {
    console.log(`✅ Listo. ${llamadasEjecutadas} llamada(s) HTTP de escritura ejecutada(s) en esta corrida.`);
    console.log(`   Sindicato: ${sindicatoId}`);
    console.log(`   Vehículo Z12 (${VEHICULO_Z12.placa}): ${vehiculos.z12} — ruta ${rutas.z12}`);
    console.log(`   Vehículo 120 (${VEHICULO_120.placa}): ${vehiculos.l120} — ruta ${rutas.l120}`);
    console.log(`   Rotación: ${rotacionId} (publicada)`);
  } else {
    console.log(`DRY-RUN: ${llamadasPlaneadas} llamada(s) HTTP se harían con --apply. No se mandó ninguna escritura.`);
  }
  console.log('='.repeat(90));
}

main().catch((err: unknown) => {
  console.error('\n❌ Abortado.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
