/**
 * Crea las 6 credenciales móviles de prueba del piloto — 1 chofer + 5 pasantes, con placa
 * PTA ficticia pero válida (`9001TST`..`9006TST`) — reemplazando por completo el modelo
 * "titular + pasante" de `scripts/crear-credencial-pasante.ts` (ver la nota SUPERSEDED en su
 * cabecera). A diferencia de aquel script, este es AUTOCONTENIDO: no copia nada de un
 * vehículo/conductor "titular" preexistente — arma sus propias 6 filas de punta a punta, más
 * su propia rotación, así que no depende de ninguna data creada a mano contra producción.
 *
 * 3 credenciales quedan asignadas a la ruta Z12 (`RUTA_PILOTO_ID`, `...011` — la ruta real
 * del sindicato, cargada por `scripts/cargar-circuito-z12.ts`) y 3 a la ruta `circuito` de la
 * línea 120 (`RUTA_120_CIRCUITO_ID`, `...023`, cargada por `scripts/cargar-linea-120.ts`).
 * Ver "Por qué `circuito` y no `ida`" más abajo para la justificación de esa elección.
 *
 * Todos los ids son fijos (namespace `33333333-3333-4333-8333-0000000000XX`, igual que el
 * resto del piloto — ver `packages/db/prisma/seed.ts` y `scripts/cargar-linea-120.ts`), así
 * que correr este script muchas veces converge al mismo estado en vez de duplicar filas.
 *
 * ## Qué hace, en orden
 *
 *   0. Valida DATABASE_URL ANTES de abrir conexión.
 *   1. Confirma que el sindicato piloto y las dos rutas (Z12 y 120-circuito) existen — si no,
 *      aborta con instrucciones de qué correr antes (`cargar-circuito-z12.ts` /
 *      `cargar-linea-120.ts`, en ese orden, antes que este script).
 *   2. Upsert de la rotación propia de este set de credenciales (`ROTACION_ID`, id fijo),
 *      forzando `estado: 'publicada'` siempre (no solo al crearla) — es la condición dura
 *      que exige `auth-movil.service.ts` (`buscarCandidatosNivel1`/`buscarAsignaciones`)
 *      para dejar loguear por app; no hay motivo legítimo para que esta rotación exclusiva
 *      del piloto de prueba quede en `borrador` entre corridas.
 *   3. Upsert de los 6 vehículos: `estado: 'activo'` forzado (el default del modelo es
 *      `'pendiente'`) y los 5 campos obligatorios sin default (`tipo`, `marca`, `modelo`,
 *      `color`, `capacidad`). `placaNormalizada` NO se escribe: desde la migración de
 *      unicidad de placa es columna `GENERATED ALWAYS` (la deriva Postgres de `placa`), ver
 *      "La trampa de `placaNormalizada`" más abajo. NO se toca `credencialHash` del
 *      vehículo — ver "Por qué el vehículo no tiene PIN acá" más abajo.
 *   4. Upsert de los 6 conductores: `estado: 'activo'` forzado, `documentoIdentidad` +
 *      `licenciaConducir` (obligatorios) ficticios pero coherentes, y `credencialHash` vía
 *      `hashPassword` de `better-auth/crypto` — el PIN nace random acá mismo (`randomInt` de
 *      `node:crypto`, 6 dígitos) y se imprime UNA sola vez por consola, junto a la placa y el
 *      nombre, solo la primera vez que la fila se crea (o con `FORZAR_PIN=1`) — igual
 *      criterio de idempotencia que `packages/db/prisma/seed.ts` y
 *      `scripts/crear-credencial-pasante.ts`: una corrida repetida no puede pisar en
 *      silencio un PIN que el CTO ya repartió.
 *   5. Upsert de `DIAS_COBERTURA` asignaciones por vehículo (una por fecha calendario
 *      Bolivia, empezando HOY) — ver "Cuántos días cubrir, y por qué HOY y no una fecha fija"
 *      más abajo.
 *   6. Verificación de solo lectura: por cada una de las 6 credenciales, ¿hay HOY una
 *      asignación que cumple exactamente la condición de `buscarCandidatosNivel1`
 *      (`auth-movil.service.ts`: fecha = hoy Bolivia, `estado='vigente'`, `venceAt > ahora`,
 *      `conductorId` no nulo, conductor `estado='activo'`, `rotacion.estado='publicada'`)?
 *      Se avisa fuerte si no, pero NO aborta (correr esto un día donde `DIAS_COBERTURA` de
 *      una corrida anterior ya no alcanza es diagnosticable, no un bug de este script).
 *
 * ## Cómo se corre
 *
 *   DATABASE_URL=postgresql://quivo:quivo_dev@localhost:5434/quivo_control \
 *     node_modules/.bin/tsx scripts/crear-credenciales-piloto.ts
 *
 * (también con `pnpm exec tsx scripts/crear-credenciales-piloto.ts` desde la raíz del repo).
 * Sin flags: siempre aplica (COMMIT) si todo verifica — igual que
 * `crear-credencial-pasante.ts` (a diferencia de `cargar-circuito-z12.ts`/
 * `cargar-linea-120.ts`, que sí tienen dry-run por defecto porque tocan geometría real).
 *
 * Para rotar los 6 PINs (en vez de dejarlos como estaban):
 *
 *   FORZAR_PIN=1 DATABASE_URL=... node_modules/.bin/tsx scripts/crear-credenciales-piloto.ts
 *
 * ## Por qué `circuito` y no `ida` para la 120 (`…021` vs `…023`)
 *
 * El brief de esta tarea deja elegir. `RUTA_120_CIRCUITO_ID` (`…023`) es la ruta que ya
 * reciben las asignaciones reales del piloto: `scripts/cargar-linea-120.ts` declara
 * literalmente "Es la que reciben las asignaciones (mismo patrón que la Z12)" sobre esta
 * misma ruta, y su `rutaIdParaFecha()` apunta ahí para cualquier día que le toque 120 en la
 * alternancia Z12/120. `RUTA_120_IDA_ID` (`…021`) es solo el tronco de ida (79 vértices, sin
 * el retorno) — nunca fue lo que ve una asignación real. Usar `…023` mantiene a estas 6
 * credenciales de prueba en el mismo patrón que el resto del piloto: una sola `rutaId` por
 * asignación, con el recorrido completo del día colgando de ella (mismo criterio que ya
 * fuerza `paquete-dia.service.ts`: el paquete del día trae los puntos de control de la
 * ÚNICA `rutaId` de la asignación, así que la ruta de ida sola dejaría al teléfono sin ver
 * los puntos de control del regreso).
 *
 * ## Por qué el vehículo no tiene PIN acá
 *
 * El login de un paso vigente (`autenticarSesion`, `auth-movil.service.ts:268`) es
 * placa + PIN del CONDUCTOR — nunca lee `vehiculo.credencialHash` (ese campo solo lo usa el
 * endpoint legado de 2 pasos, `autenticarVehiculo`, que este set de credenciales no necesita
 * ejercitar). El brief de esta tarea tampoco lo pide. Se deja `credencialHash` del vehículo
 * en `NULL` a propósito, en vez de generar un PIN que nadie va a usar ni imprimir.
 *
 * ## La trampa de `placaNormalizada`
 *
 * Desde la migración de unicidad de placa, `placaNormalizada` es columna `GENERATED ALWAYS
 * AS (...) STORED`: Postgres la deriva de `placa` en cada INSERT/UPDATE y rechaza (SQLSTATE
 * 428C9) cualquier intento de escribirla a mano — por eso los upserts del Paso 3 sólo tocan
 * `placa`. Esta era la trampa histórica que motivó la migración: antes la columna podía
 * quedar en NULL por caminos de creación que no pasaban por `vehiculos.service`, y
 * `buscarVehiculosActivosPorPlaca` (`auth-movil.service.ts`) necesitaba una rama de fallback
 * con `regexp_replace` sobre `placa` cruda para esos casos. Esa rama ya no existe: la base
 * garantiza que `placaNormalizada` está siempre poblada y sincronizada con `placa`. Las 6
 * placas de este script igual se validan pre-normalizadas (ver el chequeo de abajo) por
 * prolijidad, no porque haga falta para que la columna se rellene.
 *
 * ## Cuántos días cubrir, y por qué HOY y no una fecha fija
 *
 * `crear-credencial-pasante.ts` hardcodea `2026-08-17`..`2026-08-31` (15 días) porque ese
 * script nació para una ventana de piloto ya fechada. Acá no hay una ventana fija: estas son
 * las credenciales de prueba que van a existir mientras dure el piloto, así que anclar el
 * rango a una fecha de escritura del script las habría dejado muertas en cuanto pasara esa
 * fecha — exactamente el bug que el brief pide evitar ("con uno solo, mañana nadie entra").
 * En cambio, `PRIMERA_FECHA` se calcula en cada corrida como HOY (calendario Bolivia) y se
 * cubren `DIAS_COBERTURA = 21` días desde ahí (3 semanas: suficiente margen para no tener que
 * re-correr esto todos los días, sin ser tan largo como para que reasignar una placa a otra
 * ruta más adelante obligue a pisar un mes entero de filas). Re-correr el script en un día
 * posterior EXTIENDE la cobertura hacia adelante (upsert, nunca duplica) sin tocar los días
 * ya sembrados.
 *
 * ## Fechas y horas: por qué viajan como texto, nunca como `Date`
 *
 * Copiado sin cambios del razonamiento de `crear-credencial-pasante.ts` (mismo bug real que
 * documenta esa cabecera: el driver `pg` reconstruye `Date`/`timestamp without time zone` con
 * el reloj LOCAL de la máquina que corre el script, no con UTC). Ver ese archivo para el
 * detalle completo; acá se copian los mismos helpers, sin reimportar nada de `apps/api` ni de
 * `packages/db` en runtime — este script es standalone a propósito, igual que sus dos moldes.
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';

// --- Resolución de 'pg' anclada a packages/db/package.json (que sí la declara) — mismo
// truco que scripts/cargar-circuito-z12.ts y scripts/crear-credencial-pasante.ts: este
// script no depende de que packages/db esté buildeado.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const requireDesdeDb = createRequire(path.join(REPO_ROOT, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client, types } = requireDesdeDb('pg') as typeof import('pg');

// ============================================================================================
// Constantes — ids fijos bajo el mismo namespace que el resto del piloto. `...050`..`...061`
// están libres: `...010`..`...025` los usa `packages/db/prisma/seed.ts` (línea/ruta/puntos de
// control Z12, más el vehículo/conductor piloto ya retirado) y `scripts/crear-credencial-
// pasante.ts` (titular/pasante legado); `...030`..`...047` los usa `scripts/cargar-linea-
// 120.ts` (8 ramales, rutas + variantes) — verificado con
// `grep -rn "33333333-3333-4333-8333-00000000" scripts/ packages/db/prisma/seed.ts` antes de
// elegir este rango.
// ============================================================================================

const SINDICATO_PILOTO_ID = '33333333-3333-4333-8333-333333333333';
const RUTA_Z12_ID = '33333333-3333-4333-8333-000000000011';
const RUTA_120_CIRCUITO_ID = '33333333-3333-4333-8333-000000000023';
const ROTACION_ID = '33333333-3333-4333-8333-000000000070';

type Ruta = 'Z12' | '120';

interface CredencialPiloto {
  vehiculoId: string;
  conductorId: string;
  placa: string;
  rol: 'CHOFER' | 'PASANTE';
  ruta: Ruta;
  rutaId: string;
  nombreConductor: string;
  documentoIdentidad: string;
  licenciaConducir: string;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  capacidad: number;
  horario: 'manana' | 'tarde' | 'noche';
  orden: number;
}

// 1 chofer + 5 pasantes, 3 en Z12 (el chofer + 2 pasantes) y 3 en la 120 (3 pasantes) — split
// decidido por el CTO. `tipo`/`color` varían entre filas para no dejar 6 vehículos idénticos
// (valores tomados de `TipoVehiculoSchema`/`ColorVehiculoSchema`, `packages/shared/src/
// entities/vehiculo.ts`, aunque este script no los importa — standalone a propósito, igual
// que sus dos moldes — así que se transcriben a mano, ya validados contra ese archivo).
const CREDENCIALES: readonly CredencialPiloto[] = [
  {
    vehiculoId: '33333333-3333-4333-8333-000000000050',
    conductorId: '33333333-3333-4333-8333-000000000051',
    placa: '9001TST',
    rol: 'CHOFER',
    ruta: 'Z12',
    rutaId: RUTA_Z12_ID,
    nombreConductor: 'PILOTO — Chofer 01 (Z12)',
    documentoIdentidad: '9000001 CB',
    licenciaConducir: 'LIC-PILOTO-9001',
    tipo: 'minibus',
    marca: 'Toyota',
    modelo: 'Hiace',
    color: 'blanco',
    capacidad: 18,
    horario: 'manana',
    orden: 1,
  },
  {
    vehiculoId: '33333333-3333-4333-8333-000000000052',
    conductorId: '33333333-3333-4333-8333-000000000053',
    placa: '9002TST',
    rol: 'PASANTE',
    ruta: 'Z12',
    rutaId: RUTA_Z12_ID,
    nombreConductor: 'PILOTO — Pasante 02 (Z12)',
    documentoIdentidad: '9000002 CB',
    licenciaConducir: 'LIC-PILOTO-9002',
    tipo: 'minibus',
    marca: 'Nissan',
    modelo: 'Urvan',
    color: 'azul',
    capacidad: 15,
    horario: 'manana',
    orden: 2,
  },
  {
    vehiculoId: '33333333-3333-4333-8333-000000000054',
    conductorId: '33333333-3333-4333-8333-000000000055',
    placa: '9003TST',
    rol: 'PASANTE',
    ruta: 'Z12',
    rutaId: RUTA_Z12_ID,
    nombreConductor: 'PILOTO — Pasante 03 (Z12)',
    documentoIdentidad: '9000003 CB',
    licenciaConducir: 'LIC-PILOTO-9003',
    tipo: 'minibus',
    marca: 'Hyundai',
    modelo: 'H1',
    color: 'gris',
    capacidad: 15,
    horario: 'manana',
    orden: 3,
  },
  {
    vehiculoId: '33333333-3333-4333-8333-000000000056',
    conductorId: '33333333-3333-4333-8333-000000000057',
    placa: '9004TST',
    rol: 'PASANTE',
    ruta: '120',
    rutaId: RUTA_120_CIRCUITO_ID,
    nombreConductor: 'PILOTO — Pasante 04 (120)',
    documentoIdentidad: '9000004 CB',
    licenciaConducir: 'LIC-PILOTO-9004',
    tipo: 'minibus',
    marca: 'Toyota',
    modelo: 'Hiace',
    color: 'verde',
    capacidad: 18,
    horario: 'manana',
    orden: 4,
  },
  {
    vehiculoId: '33333333-3333-4333-8333-000000000058',
    conductorId: '33333333-3333-4333-8333-000000000059',
    placa: '9005TST',
    rol: 'PASANTE',
    ruta: '120',
    rutaId: RUTA_120_CIRCUITO_ID,
    nombreConductor: 'PILOTO — Pasante 05 (120)',
    documentoIdentidad: '9000005 CB',
    licenciaConducir: 'LIC-PILOTO-9005',
    tipo: 'minibus',
    marca: 'Nissan',
    modelo: 'Urvan',
    color: 'rojo',
    capacidad: 15,
    horario: 'manana',
    orden: 5,
  },
  {
    vehiculoId: '33333333-3333-4333-8333-000000000060',
    conductorId: '33333333-3333-4333-8333-000000000061',
    placa: '9006TST',
    rol: 'PASANTE',
    ruta: '120',
    rutaId: RUTA_120_CIRCUITO_ID,
    nombreConductor: 'PILOTO — Pasante 06 (120)',
    documentoIdentidad: '9000006 CB',
    licenciaConducir: 'LIC-PILOTO-9006',
    tipo: 'minibus',
    marca: 'Hyundai',
    modelo: 'H1',
    color: 'celeste',
    capacidad: 15,
    horario: 'manana',
    orden: 6,
  },
];

/** 3 semanas de cobertura desde HOY — ver "Cuántos días cubrir" en la cabecera. */
const DIAS_COBERTURA = 21;

/** Si está en '1', el upsert de conductor SÍ pisa `credencialHash` aunque la fila ya exista
 * (rota el PIN). Por default, nunca la toca en una fila preexistente. */
const FORZAR_PIN = process.env.FORZAR_PIN === '1';

/** oids de Postgres cuyo parser default de `pg` reconstruye el valor en hora LOCAL de la
 * máquina — ver "Fechas y horas" en la cabecera. */
const PG_OID_DATE = 1082; // date
const PG_OID_TIMESTAMP_SIN_TZ = 1114; // timestamp without time zone

// ============================================================================================
// Helpers de fecha — copiados de scripts/crear-credencial-pasante.ts (mismo motivo: standalone).
// ============================================================================================

const BOLIVIA_UTC_OFFSET_HOURS = 4;

function fechaUtcDeIso(fechaIso: string): Date {
  const [anio, mes, dia] = fechaIso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function sumarDiasUtc(fecha: Date, dias: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + dias));
}

function fechaIsoDeUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Fecha calendario actual de Bolivia como medianoche UTC — comparable directo contra la
 * columna `fecha` (`@db.Date`) de `asignaciones`. */
function fechaActualBolivia(ahora: Date = new Date()): Date {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}

/** Instante UTC de las 23:59:59 hora Bolivia del `fecha` dado. */
function finDeJornadaBolivia(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + 1, 3, 59, 59));
}

/** `DIAS_COBERTURA` fechas empezando en `primera`, ambas inclusive. */
function fechasCobertura(primera: Date): Date[] {
  return Array.from({ length: DIAS_COBERTURA }, (_, i) => sumarDiasUtc(primera, i));
}

function venceAtTextoUtc(fecha: Date): string {
  return finDeJornadaBolivia(fecha).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function timestampUtcDeTexto(texto: string): Date {
  return new Date(`${texto.replace(' ', 'T')}Z`);
}

/** Copia de `normalizarPlacaVehiculo` (`packages/shared/src/entities/vehiculo.ts`, fuente de
 * verdad — cualquier cambio ahí hay que reflejarlo acá a mano) — transcrita a mano, no
 * importada, mismo criterio standalone que el resto del script (no reimporta nada de
 * `apps/api`/`packages/db`/`packages/shared` en runtime). Se usa en vez de asumir que las
 * placas de `CREDENCIALES` ya vienen normalizadas: es exactamente la garantía que pide el
 * brief ("no seas uno de los caminos que la dejan en NULL"). Regex alineado con la columna
 * generada de Postgres (unicidad de placa, docs/plan-unicidad-placa.md,
 * `regexp_replace(upper(btrim(placa)), '[^A-Z0-9]', '', 'g')`) — antes borraba sólo espacios
 * y guiones (`[ -]+`), que sobre placas con otra puntuación (ej. un punto) NO coincidía con
 * lo que la base normaliza, rompiendo el pre-vuelo de `placasEsperadas` más abajo. */
function normalizarPlaca(placa: string): string {
  return placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ============================================================================================
// Tipos de fila
// ============================================================================================

interface ResultadoUpsert {
  id: string;
  inserted: boolean;
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  // ------------------------------------------------------------------------------------
  // Paso 0 — Validar ANTES de tocar la base.
  // ------------------------------------------------------------------------------------
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Falta DATABASE_URL en el entorno. Ejemplo:');
    console.error('  DATABASE_URL=postgresql://quivo:quivo_dev@localhost:5434/quivo_control tsx scripts/crear-credenciales-piloto.ts');
    process.exit(1);
  }

  // Placas ya deberían venir normalizadas — esto es defensivo, no decorativo (ver el
  // comentario de `normalizarPlaca` arriba): si algún día una fila de `CREDENCIALES` trae
  // una placa con separadores o minúsculas, se aborta ANTES de escribir nada en vez de
  // sembrar una placa/placaNormalizada inconsistentes.
  for (const c of CREDENCIALES) {
    if (normalizarPlaca(c.placa) !== c.placa) {
      console.error(`Placa "${c.placa}" en CREDENCIALES no está pre-normalizada (normalizada = "${normalizarPlaca(c.placa)}"). Corregí la constante. Abortando.`);
      process.exit(1);
    }
    if (!/^\d{3,4}[A-Z]{3}$/.test(c.placa)) {
      console.error(`Placa "${c.placa}" no matchea PATRON_PLACA_ACTUAL_BOLIVIA (packages/shared/src/entities/vehiculo.ts). Abortando.`);
      process.exit(1);
    }
  }

  // Resolución de 'better-auth/crypto' — mismo truco de anclaje que 'pg' arriba, vía
  // `import()` dinámico (paquete ESM-only). Mismo import que usa packages/db/prisma/seed.ts
  // y scripts/crear-credencial-pasante.ts: no se reimplementa scrypt a mano.
  const betterAuthCryptoPath = requireDesdeDb.resolve('better-auth/crypto');
  const { hashPassword } = (await import(pathToFileURL(betterAuthCryptoPath).href)) as typeof import('better-auth/crypto');

  console.log('='.repeat(90));
  console.log(`Credenciales piloto — sindicato ${SINDICATO_PILOTO_ID}${FORZAR_PIN ? ' (FORZAR_PIN=1: va a rotar los 6 PINs aunque las filas ya existan)' : ''}`);
  console.log('='.repeat(90));

  const client = new Client({
    connectionString: databaseUrl,
    // Override por-instancia (NO `types.setTypeParser` global) — ver "Fechas y horas" en la
    // cabecera.
    types: {
      getTypeParser: (oid, format) => {
        if (oid === PG_OID_DATE || oid === PG_OID_TIMESTAMP_SIN_TZ) {
          return (valor: string) => valor;
        }
        return types.getTypeParser(oid, format);
      },
    },
  });
  await client.connect();

  try {
    await client.query('BEGIN');
    // Contexto admin — mismo mecanismo que packages/db/prisma/seed.ts
    // (`withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, ...)`), aplicado a mano
    // porque este script no importa @quivo/db. `vehiculos`/`conductores`/`rotaciones` tienen
    // `FORCE ROW LEVEL SECURITY`; `rutas`/`puntos_control`/`asignaciones`/`sindicatos` no
    // (mismo comentario que scripts/cargar-circuito-z12.ts), pero el bypass no les hace daño.
    await client.query(`SELECT set_config('app.rol', 'admin_quivo', true)`);
    await client.query(`SELECT set_config('app.sindicato_id', '', true)`);

    // ------------------------------------------------------------------------------------
    // Paso 1 — Confirmar que el sindicato y las dos rutas destino existen.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 1: prerequisitos (sindicato + rutas Z12 y 120-circuito) ---');

    const sindicato = await client.query<{ id: string }>(`SELECT id FROM sindicatos WHERE id = $1`, [SINDICATO_PILOTO_ID]);
    if (sindicato.rows.length === 0) {
      throw new Error(`Sindicato piloto ${SINDICATO_PILOTO_ID} no existe. Corré "pnpm --filter @quivo/db prisma:seed" primero.`);
    }
    const rutaZ12 = await client.query<{ id: string }>(`SELECT id FROM rutas WHERE id = $1`, [RUTA_Z12_ID]);
    if (rutaZ12.rows.length === 0) {
      throw new Error(`Ruta Z12 ${RUTA_Z12_ID} no existe. Corré el seed primero (la crea seedSindicatoPiloto).`);
    }
    const ruta120 = await client.query<{ id: string }>(`SELECT id FROM rutas WHERE id = $1`, [RUTA_120_CIRCUITO_ID]);
    if (ruta120.rows.length === 0) {
      throw new Error(
        `Ruta 120-circuito ${RUTA_120_CIRCUITO_ID} no existe. Corré "tsx scripts/cargar-linea-120.ts --apply" ` +
          'antes que este script — esa ruta la crea el Paso 2 de ese archivo.',
      );
    }
    console.log('  Sindicato piloto: OK.');
    console.log(`  Ruta Z12 (${RUTA_Z12_ID}): OK.`);
    console.log(`  Ruta 120-circuito (${RUTA_120_CIRCUITO_ID}): OK.`);

    // ------------------------------------------------------------------------------------
    // Paso 1b — Pre-vuelo: ¿alguna placa/CI de CREDENCIALES ya existe con OTRO id?
    // ------------------------------------------------------------------------------------
    // Los upserts de los Pasos 3/4 sólo resuelven conflicto por `id` (`ON CONFLICT (id) DO
    // UPDATE`). Pero `vehiculos` tiene un índice único PARCIAL sobre `placaNormalizada`
    // (`vehiculos_placa_norm_vigente_key`, `WHERE estado <> 'inactivo'` — único GLOBAL entre
    // vigentes, sin importar sindicato; ya NO existe un `@@unique([sindicatoId,
    // placaNormalizada])` compuesto — se descartó, habría bloqueado para siempre el ciclo
    // baja/alta de una placa dentro del mismo sindicato, ver docs/plan-unicidad-placa.md), y
    // `conductores` tiene `@@unique([sindicatoId, documentoIdentidad])`
    // (`packages/db/prisma/schema.prisma` — sólo se LEE esa restricción acá, no se toca el
    // schema). Si alguna de `9001TST`..`9006TST` (o el CI `9000001 CB`..`9000006 CB`) ya
    // existiera con OTRO id — por ejemplo creada a mano desde el panel — el INSERT de los
    // Pasos 3/4 tira un `23505` crudo de Postgres y hace ROLLBACK de TODO (incluida la
    // rotación del Paso 2), en vez del error guiado que este script sí da en el resto de los
    // casos (Paso 1). Se verifica ACÁ, antes de escribir nada, con el mismo trato guiado.
    console.log('\n--- Paso 1b: pre-vuelo (¿placa o CI ya usados por otro id?) ---');

    // A propósito NO filtra por `estado <> 'inactivo'` aunque el índice único de la base sea
    // parcial: acá se prefiere el chequeo más conservador (cualquier vehículo con esa placa,
    // esté o no vigente) porque un choque con un vehículo dado de baja también amerita
    // revisión manual antes de reusar el id — no es un falso positivo, es una fila que un
    // operador debería mirar igual.
    const placasEsperadas = CREDENCIALES.map((c) => normalizarPlaca(c.placa));
    const vehiculoIdsEsperados = CREDENCIALES.map((c) => c.vehiculoId);
    const conflictoVehiculo = await client.query<{ id: string; placanormalizada: string }>(
      `SELECT id, "placaNormalizada" as placanormalizada FROM vehiculos
       WHERE "placaNormalizada" = ANY($1::text[]) AND id <> ALL($2::text[])`,
      [placasEsperadas, vehiculoIdsEsperados],
    );
    if (conflictoVehiculo.rows.length > 0) {
      const detalle = conflictoVehiculo.rows
        .map((r) => `  - placaNormalizada=${r.placanormalizada} ya pertenece a vehiculo.id=${r.id} (no es el id que espera CREDENCIALES)`)
        .join('\n');
      throw new Error(
        `${conflictoVehiculo.rows.length} placa(s) de CREDENCIALES ya existen en "vehiculos" con un id DISTINTO al ` +
          'esperado (posible fila creada a mano, p.ej. desde el panel). El ON CONFLICT (id) de los upserts no puede ' +
          `resolver esto — reconciliar a mano antes de correr este script:\n${detalle}`,
      );
    }

    const documentosEsperados = CREDENCIALES.map((c) => c.documentoIdentidad);
    const conductorIdsEsperados = CREDENCIALES.map((c) => c.conductorId);
    const conflictoConductor = await client.query<{ id: string; documentoidentidad: string }>(
      `SELECT id, "documentoIdentidad" as documentoidentidad FROM conductores
       WHERE "sindicatoId" = $1 AND "documentoIdentidad" = ANY($2::text[]) AND id <> ALL($3::text[])`,
      [SINDICATO_PILOTO_ID, documentosEsperados, conductorIdsEsperados],
    );
    if (conflictoConductor.rows.length > 0) {
      const detalle = conflictoConductor.rows
        .map((r) => `  - documentoIdentidad=${r.documentoidentidad} ya pertenece a conductor.id=${r.id} (no es el id que espera CREDENCIALES)`)
        .join('\n');
      throw new Error(
        `${conflictoConductor.rows.length} documento(s) de identidad de CREDENCIALES ya existen en "conductores" ` +
          'con un id DISTINTO al esperado (posible fila creada a mano). Reconciliar a mano antes de correr este ' +
          `script:\n${detalle}`,
      );
    }
    console.log('  Sin conflictos de unicidad (placa/CI) contra otro id. OK.');

    // ------------------------------------------------------------------------------------
    // Paso 2 — Rotación propia de este set de credenciales, SIEMPRE 'publicada'.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 2: rotación ---');

    await client.query(
      `INSERT INTO rotaciones (id, "sindicatoId", periodo, estado, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'publicada', now(), now())
       ON CONFLICT (id) DO UPDATE SET estado = 'publicada', "updatedAt" = now()`,
      [ROTACION_ID, SINDICATO_PILOTO_ID, 'piloto-credenciales-prueba'],
    );
    console.log(`  Rotación ${ROTACION_ID} ('piloto-credenciales-prueba'): estado forzado a 'publicada'.`);

    // ------------------------------------------------------------------------------------
    // Paso 3 — 6 vehículos.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 3: 6 vehículos (placas 9001TST..9006TST) ---');

    const filasVehiculo: { placa: string; creado: boolean }[] = [];
    for (const c of CREDENCIALES) {
      // `placaNormalizada` NO va en columnas/VALUES: es GENERATED ALWAYS, Postgres la
      // deriva de `placa` sola (ver "La trampa de `placaNormalizada`" en la cabecera).
      const resultado = await client.query<ResultadoUpsert>(
        `INSERT INTO vehiculos
           (id, "sindicatoId", placa, tipo, marca, modelo, color, capacidad, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activo', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           "sindicatoId" = EXCLUDED."sindicatoId",
           placa = EXCLUDED.placa,
           tipo = EXCLUDED.tipo,
           marca = EXCLUDED.marca,
           modelo = EXCLUDED.modelo,
           color = EXCLUDED.color,
           capacidad = EXCLUDED.capacidad,
           -- Forzado en cada corrida: el default del modelo es 'pendiente' y sin esto un
           -- vehículo que alguien puso en otro estado a mano (o que nace en 'pendiente' por
           -- algún camino de creación futuro) queda invisible para buscarVehiculosActivosPorPlaca
           -- (auth-movil.service.ts), que solo mira estado = 'activo'.
           estado = 'activo',
           "updatedAt" = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [c.vehiculoId, SINDICATO_PILOTO_ID, c.placa, c.tipo, c.marca, c.modelo, c.color, c.capacidad],
      );
      filasVehiculo.push({ placa: c.placa, creado: resultado.rows[0]!.inserted });
    }
    console.table(filasVehiculo.map((f) => ({ ...f, estado: f.creado ? 'CREADO' : 'ya existía (actualizado)' })));

    // ------------------------------------------------------------------------------------
    // Paso 4 — 6 conductores, con su PIN.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 4: 6 conductores + PIN (6 dígitos, se imprime UNA sola vez) ---');

    const pinesGenerados: { credencial: CredencialPiloto; pin: string; creado: boolean; hashEraNulo: boolean }[] = [];
    for (const c of CREDENCIALES) {
      const hashPrevio = await client.query<{ credencialhash: string | null }>(
        `SELECT "credencialHash" as credencialhash FROM conductores WHERE id = $1`,
        [c.conductorId],
      );
      const hashEraNulo = hashPrevio.rows.length > 0 && hashPrevio.rows[0]!.credencialhash === null;

      // 6 dígitos exactos (randomInt(0, 1_000_000) da 0..999999) — cumple `PinMovilSchema`
      // (`packages/shared/src/auth/mobile.ts`, 6-12 dígitos) por construcción, sin necesidad
      // de validar el formato después como hace crear-credencial-pasante.ts (ahí el PIN lo
      // elige quien corre el script; acá lo genera el script mismo).
      const pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const credencialHash = await hashPassword(pin);

      const resultado = await client.query<ResultadoUpsert>(
        `INSERT INTO conductores
           (id, "sindicatoId", nombre, "documentoIdentidad", "licenciaConducir", estado, "credencialHash", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'activo', $6, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           "sindicatoId" = EXCLUDED."sindicatoId",
           nombre = EXCLUDED.nombre,
           "documentoIdentidad" = EXCLUDED."documentoIdentidad",
           "licenciaConducir" = EXCLUDED."licenciaConducir",
           -- Forzado, mismo motivo que el vehículo arriba (default del modelo es 'activo' acá,
           -- pero se deja explícito por consistencia y por si alguien lo puso 'inactivo' a mano).
           estado = 'activo',
           -- Nunca se pisa un PIN ya entregado salvo FORZAR_PIN=1 — salvo que la fila ya
           -- existiera con credencialHash en NULL (no hay PIN que preservar ahí). Mismo
           -- criterio que packages/db/prisma/seed.ts y crear-credencial-pasante.ts.
           "credencialHash" = CASE WHEN $7 OR conductores."credencialHash" IS NULL THEN EXCLUDED."credencialHash" ELSE conductores."credencialHash" END,
           "updatedAt" = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [c.conductorId, SINDICATO_PILOTO_ID, c.nombreConductor, c.documentoIdentidad, c.licenciaConducir, credencialHash, FORZAR_PIN],
      );
      const creado = resultado.rows[0]!.inserted;
      pinesGenerados.push({ credencial: c, pin, creado, hashEraNulo });
    }

    // Fix: antes este bloque imprimía los PINes acá mismo (ANTES del COMMIT, que está más
    // abajo, después del Paso 5 — 126 upserts de asignaciones — y el Paso 6). Si el Paso 5
    // chocaba con una constraint y la transacción hacía ROLLBACK, los conductores y sus hashes
    // nunca se escribían, pero el operador ya había anotado 6 PINes que no autenticaban nada
    // (y re-correr el script acuña PINes distintos). Se buferea el texto acá — con los mismos
    // datos que antes — y se imprime recién después del `COMMIT`, más abajo. Si la transacción
    // aborta, el `catch` no llega a imprimir este buffer.
    const lineasPin: string[] = [];
    for (const { credencial, pin, creado, hashEraNulo } of pinesGenerados) {
      const rutaLabel = credencial.ruta === 'Z12' ? 'Z12 (…011)' : '120 (…023)';
      if (creado || FORZAR_PIN || hashEraNulo) {
        const motivo = creado ? 'CREADO' : FORZAR_PIN ? 'ROTADO (FORZAR_PIN=1)' : 'FIJADO (credencialHash estaba en NULL)';
        lineasPin.push(
          `  [${credencial.rol.padEnd(7)}] placa ${credencial.placa} → ruta ${rutaLabel} — ${credencial.nombreConductor} — ` +
            `PIN = ${pin} (${motivo}) — ANOTALO AHORA, no se vuelve a mostrar.`,
        );
      } else {
        lineasPin.push(`  [${credencial.rol.padEnd(7)}] placa ${credencial.placa} → ruta ${rutaLabel} — ${credencial.nombreConductor} — SIN TOCAR (ya tenía PIN).`);
      }
    }

    // ------------------------------------------------------------------------------------
    // Paso 5 — Asignaciones: DIAS_COBERTURA fechas por vehículo, empezando HOY.
    // ------------------------------------------------------------------------------------
    console.log(`\n--- Paso 5: asignaciones (${DIAS_COBERTURA} días, HOY en adelante) ---`);

    const hoyBolivia = fechaActualBolivia();
    const fechas = fechasCobertura(hoyBolivia);
    console.log(`  Rango: ${fechaIsoDeUtc(fechas[0]!)} .. ${fechaIsoDeUtc(fechas[fechas.length - 1]!)} (${fechas.length} días).`);

    let totalCreadas = 0;
    let totalActualizadas = 0;
    for (const c of CREDENCIALES) {
      for (const fecha of fechas) {
        const fechaTexto = fechaIsoDeUtc(fecha);
        const venceAtTexto = venceAtTextoUtc(fecha);
        const resultado = await client.query<ResultadoUpsert>(
          `INSERT INTO asignaciones
             (id, "rotacionId", "vehiculoId", "conductorId", "rutaId", fecha, horario, orden, "venceAt", estado, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'vigente', now(), now())
           ON CONFLICT ("vehiculoId", fecha, horario) DO UPDATE SET
             "rotacionId" = EXCLUDED."rotacionId",
             "conductorId" = EXCLUDED."conductorId",
             "rutaId" = EXCLUDED."rutaId",
             orden = EXCLUDED.orden,
             "venceAt" = EXCLUDED."venceAt",
             -- Mismo criterio conservador que scripts/crear-credencial-pasante.ts: si alguien
             -- canceló esta fila a mano (estado != 'vigente'), una re-corrida no la resucita.
             estado = CASE WHEN asignaciones.estado = 'vigente' THEN EXCLUDED.estado ELSE asignaciones.estado END,
             "updatedAt" = now()
           RETURNING id, (xmax = 0) AS inserted`,
          [randomUUID(), ROTACION_ID, c.vehiculoId, c.conductorId, c.rutaId, fechaTexto, c.horario, c.orden, venceAtTexto],
        );
        if (resultado.rows[0]!.inserted) totalCreadas += 1;
        else totalActualizadas += 1;
      }
    }
    console.log(`  ${totalCreadas} asignación(es) creada(s), ${totalActualizadas} ya existían (actualizadas). Total esperado: ${CREDENCIALES.length * DIAS_COBERTURA}.`);

    // ------------------------------------------------------------------------------------
    // Paso 6 — Verificación de solo lectura: ¿las 6 credenciales pueden loguearse HOY?
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 6: ¿las 6 credenciales tienen asignación vigente HOY (Bolivia)? ---');

    const ahora = new Date();
    const resumenFinal: { rol: string; placa: string; ruta: string; conductor: string; hoyOk: string }[] = [];
    let algunaFalla = false;
    for (const c of CREDENCIALES) {
      // Misma condición exacta que `buscarCandidatosNivel1` (auth-movil.service.ts): fecha =
      // hoy Bolivia, estado = 'vigente', venceAt > ahora, conductorId no nulo, conductor
      // activo, rotación publicada. No se lanza excepción si falla — solo se avisa fuerte.
      //
      // Fix: la clave única real de `asignaciones` es (vehiculoId, fecha, horario) — sin
      // filtrar por `horario` esta query no tiene `ORDER BY`/`LIMIT` y toma `rows[0]` de
      // cualquier fila que matchee vehiculoId+conductorId+fecha. Una asignación sobrante de
      // 'tarde'/'noche' para el mismo vehículo+conductor+día es legal y este script nunca la
      // escribe (siempre usa `c.horario`, ver Paso 5) — sin este filtro el ✅/⚠ podía terminar
      // reportando sobre una fila que este script no escribió.
      const fila = await client.query<{ id: string; estado: string; venceat: string; conductor_estado: string; rotacion_estado: string }>(
        `SELECT a.id, a.estado, a."venceAt" as venceat, co.estado as conductor_estado, r.estado as rotacion_estado
         FROM asignaciones a
         JOIN conductores co ON co.id = a."conductorId"
         JOIN rotaciones r ON r.id = a."rotacionId"
         WHERE a."vehiculoId" = $1 AND a."conductorId" = $2 AND a.fecha = $3 AND a.horario = $4`,
        [c.vehiculoId, c.conductorId, fechaIsoDeUtc(hoyBolivia), c.horario],
      );
      const f = fila.rows[0];
      const venceAtFila = f ? timestampUtcDeTexto(f.venceat) : undefined;
      const ok =
        f !== undefined &&
        f.estado === 'vigente' &&
        venceAtFila!.getTime() > ahora.getTime() &&
        f.conductor_estado === 'activo' &&
        f.rotacion_estado === 'publicada';
      if (!ok) algunaFalla = true;
      resumenFinal.push({
        rol: c.rol,
        placa: c.placa,
        ruta: c.ruta,
        conductor: c.nombreConductor,
        hoyOk: ok ? '✅' : f ? `⚠ estado=${f.estado} conductor=${f.conductor_estado} rotacion=${f.rotacion_estado}` : '⚠ sin fila hoy',
      });
    }
    console.table(resumenFinal);
    if (algunaFalla) {
      console.warn('  ⚠ Al menos una credencial NO puede loguearse hoy con las condiciones de buscarCandidatosNivel1 — revisar la tabla de arriba.');
    } else {
      console.log('  ✅ Las 6 credenciales tienen asignación vigente hoy — el login móvil debería funcionar para las 6 ahora mismo.');
    }

    await client.query('COMMIT');
    console.log('\n✅ COMMIT. Cambios aplicados.');

    // Recién ACÁ, después del COMMIT — ver el comentario del Paso 4 sobre por qué se buferearon
    // en vez de imprimirse en el momento.
    console.log('\n  PINes (SOLO se imprimen para filas nuevas o rotadas con FORZAR_PIN=1 — repartir y no volver a correr sin FORZAR_PIN):');
    for (const linea of lineasPin) console.log(linea);

    console.log(`\nResumen: 1 chofer + 5 pasantes — 3 en Z12 (${RUTA_Z12_ID}), 3 en 120 (${RUTA_120_CIRCUITO_ID}). PINes arriba, no se repiten.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Abortado, ROLLBACK. Nada quedó escrito en la base.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// Mismo motivo que scripts/crear-credencial-pasante.ts: el `import()` dinámico de
// 'better-auth/crypto' y `client.connect()` ocurren ANTES de que exista el `try/catch`
// interno — sin este `.catch()` esos dos casos saldrían como unhandled rejection.
main().catch((err) => {
  console.error('\n❌ Abortado antes de poder conectar a la base o preparar los hashes.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
