/**
 * Crea una SEGUNDA credencial móvil operativa (vehículo + conductor + 15 asignaciones)
 * para el sindicato piloto, equivalente a la que ya usa el conductor titular
 * (`33333333-3333-4333-8333-000000000014` / `...015`), para que un pasante haga el mismo
 * recorrido en paralelo con cuenta separada — sin tocar ni un solo dato del titular.
 *
 * Todos los ids nuevos son fijos (no `randomUUID()` salvo para las 15 filas de
 * `asignaciones`, que no tienen un id documentado — ver el comentario del Paso 3), así que
 * correr este script dos veces converge al mismo estado en vez de duplicar filas.
 *
 * ## Qué hace, en orden
 *
 *   0. Valida DATABASE_URL + los dos PINs por variable de entorno ANTES de abrir conexión.
 *   1. Confirma que el vehículo/conductor/ruta/rotación del titular existen (si no, aborta:
 *      no hay de dónde copiar el circuito operativo).
 *   2. Upsert del vehículo y el conductor del pasante (ids fijos `...024`/`...025`), mismo
 *      `sindicatoId` y mismo `socioId` que el vehículo del titular.
 *   3. Upsert de una asignación por cada fecha `2026-08-17`..`2026-08-31` (15), calcando
 *      `rotacionId`/`rutaId`/`horario` del titular y con `orden` = 100 + el orden del
 *      titular para esa misma fecha (para que nunca choquen en el mismo casillero de orden
 *      de despacho).
 *   4. Verificación de solo lectura: ¿existe HOY (fecha calendario Bolivia) una asignación
 *      del pasante vigente y no vencida? Esa es exactamente la condición que exige
 *      `apps/api/src/modules/auth-movil/auth-movil.service.ts` (`buscarAsignaciones`) para
 *      dejar loguear por app — si no se cumple, se avisa fuerte en el log pero NO se
 *      lanza excepción (correr este script fuera del rango 17→31 de agosto es legítimo,
 *      p. ej. para dejar las asignaciones ya cargadas de antemano).
 *
 * ## Cómo se corre
 *
 *   DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/quivo_control \
 *   PIN_VEHICULO_PASANTE=12345678 \
 *   PIN_CONDUCTOR_PASANTE=87654321 \
 *     node_modules/.bin/tsx scripts/crear-credencial-pasante.ts
 *
 * (también con `pnpm exec tsx scripts/crear-credencial-pasante.ts` desde la raíz del repo).
 *
 * Para rotar el PIN de una credencial que ya existe (en vez de dejarla como estaba):
 *
 *   FORZAR_PIN=1 DATABASE_URL=... PIN_VEHICULO_PASANTE=... PIN_CONDUCTOR_PASANTE=... \
 *     node_modules/.bin/tsx scripts/crear-credencial-pasante.ts
 *
 * ## Por qué NO imprime PINs ni hashes
 *
 * A diferencia de `packages/db/prisma/seed.ts` (que sí imprime el PIN generado la primera
 * vez, porque ahí el PIN nace random dentro del script), acá el PIN lo elige quien lo corre
 * y llega por variable de entorno — ya lo tiene. Imprimirlo o imprimir el hash en un log que
 * puede terminar en CI, en la terminal de otra persona o en un pantallazo no suma nada y sí
 * agrega superficie de fuga (mismo tipo de hallazgo que motivó el hardening de seguridad de
 * `seedSindicatoPiloto` en seed.ts). El resumen final solo muestra placa/CI (no son secretos).
 *
 * ## Idempotencia
 *
 *   - Vehículo/conductor: `INSERT ... ON CONFLICT (id) DO UPDATE`, id fijo. Todos los campos
 *     descriptivos (placa, nombre, estado, etc.) se refrescan al valor de este script en cada
 *     corrida — son deliberadamente placeholders reproducibles, no hay motivo para congelarlos.
 *     `credencialHash` es la ÚNICA columna que NO se pisa en el UPDATE salvo `FORZAR_PIN=1` **o
 *     que la fila ya existiera con `credencialHash` en NULL** (mismo criterio que `seed.ts` con
 *     `update: {}` para el piloto real: una corrida repetida —o accidental, en CI— no puede pisar
 *     un PIN que ya se le entregó al pasante; pero una fila sin hash nunca puede loguear, así que
 *     ahí no hay nada que "preservar").
 *   - Asignaciones: `INSERT ... ON CONFLICT ("vehiculoId", fecha, horario) DO UPDATE` —esa es
 *     la única unicidad real del modelo (`@@unique([vehiculoId, fecha, horario])`, ver
 *     schema.prisma), así que es la clave correcta aunque no haya un id fijo documentado
 *     para estas filas.
 *
 * ## Fechas y horas: por qué viajan como texto, nunca como `Date`
 *
 * El driver `pg` serializa un `Date` de JS usando el offset LOCAL de la máquina que corre el
 * proceso (`dateToString` en `pg/lib/utils.js` usa `date.getTimezoneOffset()`), y lo mismo
 * a la inversa: el parser default para columnas `date`/`timestamp without time zone`
 * (`postgres-date`, oids 1082/1114) reconstruye el valor con el constructor LOCAL de `Date`
 * (`new Date(year, month, day, ...)`, sin `UTC`). En una máquina en UTC-4 esto corre CADA
 * fecha un día para atrás al escribir (`2026-08-17` → columna `2026-08-16`) y CADA hora 4h
 * para atrás al leer o escribir un `timestamp without time zone` — silencioso, sin error,
 * y solo se nota comparando contra la base a mano. La convención de esta base para
 * `timestamp without time zone` es UTC (así la lee Prisma en el API real; ver `venceAt` del
 * titular), y para `date` es el día calendario tal cual, sin zona horaria — ninguna de las
 * dos tiene nada que ver con el reloj de quien corre el script.
 *
 * La solución que evita depender de la zona horaria de la máquina —en vez de forzar
 * `process.env.TZ` (funciona pero es frágil: solo sirve si se fija antes de que Node
 * materialice cualquier `Date`, y no protege a quien importe este módulo desde otro lado)—
 * es no dejar que `pg` toque un `Date` para estas columnas en ningún sentido:
 *
 *   - Al ESCRIBIR: todo `fecha`/`venceAt` que sale hacia una query viaja como string ya
 *     formateado (`'YYYY-MM-DD'` / `'YYYY-MM-DD HH:MM:SS'` en UTC vía `fechaIsoDeUtc` /
 *     `venceAtTextoUtc`), nunca como objeto `Date` — un string en `prepareValue` se manda
 *     literal, sin pasar por `dateToString`, y Postgres lo castea solo con el tipo de la
 *     columna destino.
 *   - Al LEER: el `Client` se crea con un `types.getTypeParser` que, para los oids 1082
 *     (`date`) y 1114 (`timestamp without time zone`), devuelve el texto crudo de Postgres
 *     sin parsear (en vez de dejar que `postgres-date` lo reconstruya en hora local); ese
 *     texto se interpreta explícitamente como UTC con `timestampUtcDeTexto` donde hace
 *     falta un `Date` real (comparaciones de vencimiento). El override es por-`Client`
 *     (pasado en el constructor), no `types.setTypeParser` global, para no pisarle el
 *     parseo a ningún otro código que comparta el proceso.
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// --- Resolución de 'pg' sin depender de que el root del monorepo tenga la dependencia
// hoisted: se ancla la resolución al package.json de packages/db, que sí la declara
// (`"pg": "^8.22.0"`, la misma que usa @prisma/adapter-pg en apps/api). Mismo truco que
// scripts/cargar-circuito-z12.ts — no se importa nada de @quivo/db en sí, este script es
// standalone a propósito (no depende de que packages/db esté buildeado).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const requireDesdeDb = createRequire(path.join(REPO_ROOT, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client, types } = requireDesdeDb('pg') as typeof import('pg');

// ============================================================================================
// Constantes — ids/valores documentados en el brief de esta tarea, ya verificados contra
// producción (no se re-derivan de ningún otro dato en runtime salvo lo que se indica abajo).
// ============================================================================================

const SINDICATO_PILOTO_ID = '33333333-3333-4333-8333-333333333333';
const RUTA_PILOTO_ID = '33333333-3333-4333-8333-000000000011';
const ROTACION_PILOTO_ID = '86d20fcf-931d-40cb-8062-bf605f161709';

const VEHICULO_TITULAR_ID = '33333333-3333-4333-8333-000000000014';
const CONDUCTOR_TITULAR_ID = '33333333-3333-4333-8333-000000000015';

const VEHICULO_PASANTE_ID = '33333333-3333-4333-8333-000000000024';
const CONDUCTOR_PASANTE_ID = '33333333-3333-4333-8333-000000000025';

const PLACA_PASANTE = '2222AAA';
const DOCUMENTO_IDENTIDAD_PASANTE = '00000001 LP';
const LICENCIA_PASANTE = 'PASANTE-LIC-001';
const NOMBRE_PASANTE = 'PASANTE - acompañante piloto';

const HORARIO_PASANTE = 'manana';
const PRIMERA_FECHA_PASANTE = '2026-08-17';
const ULTIMA_FECHA_PASANTE = '2026-08-31';
/** `orden` de las 15 asignaciones del titular para este rango es 1..15 (documentado en el
 * brief) — este offset asegura que el pasante nunca comparta casillero de orden de despacho
 * con el titular, sin importar si en el futuro el rango de fechas o el conteo cambian. */
const OFFSET_ORDEN_PASANTE = 100;

/** Si está en '1', el upsert de vehículo/conductor SÍ pisa `credencialHash` aunque la fila ya
 * exista. Por default (sin la variable, o con cualquier otro valor) el upsert NUNCA la toca
 * en una fila preexistente — ver la sección "Idempotencia" del comentario de arriba. */
const FORZAR_PIN = process.env.FORZAR_PIN === '1';

/** oids de Postgres cuyo parser default de `pg` reconstruye el valor en hora LOCAL de la
 * máquina (vía `postgres-date`) — ver "Fechas y horas" en el comentario de cabecera. Se
 * pisan al crear el `Client` para que lleguen como texto crudo, sin ese round-trip. */
const PG_OID_DATE = 1082; // date
const PG_OID_TIMESTAMP_SIN_TZ = 1114; // timestamp without time zone

// ============================================================================================
// Tipos
// ============================================================================================

interface FilaAsignacionTitular {
  /** Texto crudo tal cual lo manda Postgres para una columna `date` ('YYYY-MM-DD'), gracias
   * al override de `getTypeParser` del Client — ver "Fechas y horas" arriba. */
  fecha: string;
  orden: number;
}

interface ResultadoUpsert {
  id: string;
  inserted: boolean;
}

// ============================================================================================
// Helpers de fecha — copiados a propósito de apps/api/src/common/tiempo/jornada.ts (misma
// fórmula, mismo motivo que cargar-circuito-z12.ts copia haversine en vez de importarlo: este
// script es standalone, no se acopla al estado de apps/api ni packages/ en runtime).
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

/** Instante UTC de las 23:59:59 hora Bolivia del `fecha` dado — el día calendario siguiente
 * a las 03:59:59 UTC. Mismo criterio que `finDeJornadaBolivia` de jornada.ts/seed.ts. */
function finDeJornadaBolivia(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + 1, 3, 59, 59));
}

/** Las 15 fechas `2026-08-17`..`2026-08-31`, ambas inclusive. */
function fechasPasante(): Date[] {
  const primera = fechaUtcDeIso(PRIMERA_FECHA_PASANTE);
  const ultima = fechaUtcDeIso(ULTIMA_FECHA_PASANTE);
  const dias = Math.round((ultima.getTime() - primera.getTime()) / 86_400_000) + 1;
  return Array.from({ length: dias }, (_, i) => sumarDiasUtc(primera, i));
}

/** `finDeJornadaBolivia(fecha)` formateado como literal `'YYYY-MM-DD HH:MM:SS'` en UTC, para
 * pasarlo como parámetro de query en vez de un `Date` — ver "Fechas y horas" en la cabecera.
 * La columna es `timestamp without time zone`, así que Postgres guarda estos dígitos tal
 * cual, sin conversión: por eso el string tiene que estar ya en UTC antes de llegar acá. */
function venceAtTextoUtc(fecha: Date): string {
  // `finDeJornadaBolivia` nunca fija fracción de segundo (siempre :59:59 exacto), así que
  // el `.000` que agrega `toISOString()` es puro ruido — se recorta para que el literal
  // sea igual, carácter por carácter, al que documenta la cabecera del script.
  return finDeJornadaBolivia(fecha).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Parsea a `Date` (instante UTC real) el texto crudo que devuelve Postgres para una columna
 * `timestamp without time zone` (formato `'YYYY-MM-DD HH:MM:SS[.ffffff]'`, sin offset) una
 * vez que el `Client` está configurado para NO dejar que `pg` lo reconstruya en hora local
 * — ver "Fechas y horas" en la cabecera y el `getTypeParser` del `Client` más abajo. */
function timestampUtcDeTexto(texto: string): Date {
  return new Date(`${texto.replace(' ', 'T')}Z`);
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  // ------------------------------------------------------------------------------------
  // Paso 0 — Validar todo lo necesario ANTES de tocar la base.
  // ------------------------------------------------------------------------------------
  const databaseUrl = process.env.DATABASE_URL;
  const pinVehiculo = process.env.PIN_VEHICULO_PASANTE;
  const pinConductor = process.env.PIN_CONDUCTOR_PASANTE;

  if (!databaseUrl) {
    console.error('Falta DATABASE_URL en el entorno.');
    process.exit(1);
  }
  if (!pinVehiculo || !pinConductor) {
    console.error(
      'Faltan PIN_VEHICULO_PASANTE y/o PIN_CONDUCTOR_PASANTE en el entorno — el script no arranca ' +
        'sin los dos (nunca genera ni hardcodea un PIN por su cuenta). Ejemplo:\n' +
        '  DATABASE_URL=postgresql://... PIN_VEHICULO_PASANTE=... PIN_CONDUCTOR_PASANTE=... ' +
        'tsx scripts/crear-credencial-pasante.ts',
    );
    process.exit(1);
  }

  // El API valida el PIN contra `PinMovilSchema` (`packages/shared/src/auth/mobile.ts`) recién
  // al momento de loguear por app — si se acepta acá un PIN con otro formato, el script lo
  // hashea y reporta éxito igual, pero el teléfono recibe 400 en la validación del body ANTES
  // de siquiera comparar el hash: la credencial queda creada pero inservible. Se valida acá,
  // antes de abrir conexión, para no dejar pasar eso en silencio.
  const PIN_MOVIL_REGEX = /^\d{6,12}$/;
  if (!PIN_MOVIL_REGEX.test(pinVehiculo) || !PIN_MOVIL_REGEX.test(pinConductor)) {
    console.error(
      'PIN_VEHICULO_PASANTE y PIN_CONDUCTOR_PASANTE deben ser solo dígitos, de 6 a 12 caracteres ' +
        '(mismo formato que exige el API — `PinMovilSchema` en packages/shared/src/auth/mobile.ts). ' +
        'Un PIN con otro formato genera una credencial que el teléfono nunca va a poder usar.',
    );
    process.exit(1);
  }

  // Resolución de 'better-auth/crypto' (paquete ESM-only) con el mismo truco de anclaje que
  // 'pg' arriba, pero vía `import()` dinámico en vez de `require()` síncrono: la build de
  // better-auth expone crypto/index.mjs, y un `require()` síncrono de un módulo ESM depende
  // de que Node soporte `require(esm)` (estable recién desde Node 22.12) — con `import()`
  // dinámico funciona en cualquier Node >=22, que es el rango declarado en package.json.
  // Es el MISMO import que usa packages/db/prisma/seed.ts (`hashPassword` de
  // 'better-auth/crypto'): no se reimplementa scrypt a mano acá.
  const betterAuthCryptoPath = requireDesdeDb.resolve('better-auth/crypto');
  const { hashPassword } = (await import(pathToFileURL(betterAuthCryptoPath).href)) as typeof import('better-auth/crypto');

  console.log('='.repeat(90));
  console.log(`Credencial pasante — sindicato piloto ${SINDICATO_PILOTO_ID}${FORZAR_PIN ? ' (FORZAR_PIN=1: va a rotar el PIN aunque la fila ya exista)' : ''}`);
  console.log('='.repeat(90));

  const [credencialHashVehiculo, credencialHashConductor] = await Promise.all([
    hashPassword(pinVehiculo),
    hashPassword(pinConductor),
  ]);

  const client = new Client({
    connectionString: databaseUrl,
    // Override por-instancia (NO `types.setTypeParser` global — no queremos pisarle el
    // parseo a otro código que comparta el proceso): para `date`/`timestamp without time
    // zone` devuelve el texto crudo de Postgres sin parsear, en vez de dejar que
    // `postgres-date` lo reconstruya con el constructor LOCAL de `Date`. Ver "Fechas y
    // horas" en el comentario de cabecera.
    types: {
      // Sin anotar los parámetros a propósito: TS los tipa por contexto desde
      // `CustomTypesConfig['getTypeParser']` (@types/pg), que es la misma firma que
      // `types.getTypeParser` de abajo espera — anotarlos a mano (p. ej. `format?: string`)
      // choca con el `TypeFormat` literal ('text' | 'binary') que declara pg-types.
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
    // Contexto admin — mismo mecanismo exacto que packages/db/prisma/seed.ts
    // (`withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, ...)`), aplicado acá a
    // mano porque este script no importa @quivo/db. `vehiculos`/`conductores` tienen
    // `FORCE ROW LEVEL SECURITY` con policy `tenant_isolation` — sin esto, los upserts no ven
    // (o no pueden escribir) las filas del sindicato piloto.
    await client.query(`SELECT set_config('app.rol', 'admin_quivo', true)`);
    await client.query(`SELECT set_config('app.sindicato_id', '', true)`);

    // ------------------------------------------------------------------------------------
    // Paso 1 — Confirmar que el circuito del titular existe (de ahí se copia todo).
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 1: circuito del titular ---');

    const vehiculoTitular = await client.query<{ id: string; sindicatoid: string; socioid: string | null; placa: string }>(
      `SELECT id, "sindicatoId" as sindicatoid, "socioId" as socioid, placa FROM vehiculos WHERE id = $1`,
      [VEHICULO_TITULAR_ID],
    );
    const conductorTitular = await client.query<{ id: string; sindicatoid: string; documentoidentidad: string }>(
      `SELECT id, "sindicatoId" as sindicatoid, "documentoIdentidad" as documentoidentidad FROM conductores WHERE id = $1`,
      [CONDUCTOR_TITULAR_ID],
    );
    const rotacion = await client.query<{ id: string; sindicatoid: string; periodo: string; estado: string }>(
      `SELECT id, "sindicatoId" as sindicatoid, periodo, estado FROM rotaciones WHERE id = $1`,
      [ROTACION_PILOTO_ID],
    );
    const ruta = await client.query<{ id: string }>(`SELECT id FROM rutas WHERE id = $1`, [RUTA_PILOTO_ID]);

    if (vehiculoTitular.rows.length === 0) throw new Error(`Vehículo titular ${VEHICULO_TITULAR_ID} no existe. Abortando.`);
    if (conductorTitular.rows.length === 0) throw new Error(`Conductor titular ${CONDUCTOR_TITULAR_ID} no existe. Abortando.`);
    if (rotacion.rows.length === 0) throw new Error(`Rotación ${ROTACION_PILOTO_ID} no existe. Abortando.`);
    if (ruta.rows.length === 0) throw new Error(`Ruta ${RUTA_PILOTO_ID} no existe. Abortando.`);

    // El script escribe el vehículo/conductor del pasante con `sindicatoId = SINDICATO_PILOTO_ID`
    // a mano (no lo copia de estas filas) — si el titular, el conductor titular o la rotación
    // resultaran ser de OTRO sindicato, seguir de largo dejaría un grafo cross-tenant (asignación
    // apuntando a una rotación de un sindicato distinto al del vehículo/conductor del pasante) sin
    // avisar: el login fallaría con "No existe una asignación publicada vigente" y nadie lo vería
    // venir hasta que el pasante probara la app. Se corta acá, antes de escribir nada.
    if (vehiculoTitular.rows[0]!.sindicatoid !== SINDICATO_PILOTO_ID) {
      throw new Error(
        `El vehículo titular ${VEHICULO_TITULAR_ID} pertenece al sindicato ${vehiculoTitular.rows[0]!.sindicatoid}, ` +
          `no a ${SINDICATO_PILOTO_ID}. Abortando: no se puede copiar un circuito de otro sindicato.`,
      );
    }
    if (conductorTitular.rows[0]!.sindicatoid !== SINDICATO_PILOTO_ID) {
      throw new Error(
        `El conductor titular ${CONDUCTOR_TITULAR_ID} pertenece al sindicato ${conductorTitular.rows[0]!.sindicatoid}, ` +
          `no a ${SINDICATO_PILOTO_ID}. Abortando: no se puede copiar un circuito de otro sindicato.`,
      );
    }
    if (rotacion.rows[0]!.sindicatoid !== SINDICATO_PILOTO_ID) {
      throw new Error(
        `La rotación ${ROTACION_PILOTO_ID} pertenece al sindicato ${rotacion.rows[0]!.sindicatoid}, ` +
          `no a ${SINDICATO_PILOTO_ID}. Abortando: no se puede copiar un circuito de otro sindicato.`,
      );
    }

    const socioIdTitular = vehiculoTitular.rows[0]!.socioid;
    if (!socioIdTitular) {
      throw new Error(`El vehículo titular ${VEHICULO_TITULAR_ID} no tiene socioId — no hay de dónde copiarlo. Abortando.`);
    }
    if (rotacion.rows[0]!.estado !== 'publicada') {
      // No aborta: puede ser una corrida legítima antes/después de la ventana del piloto.
      // Pero el login móvil exige `rotacion.estado === 'publicada'` (auth-movil.service.ts),
      // así que se avisa fuerte para no dejar pasar en silencio un estado que rompe el login.
      console.warn(
        `  ⚠ La rotación ${ROTACION_PILOTO_ID} está en estado '${rotacion.rows[0]!.estado}', no 'publicada' — ` +
          'el login móvil del pasante NO va a funcionar aunque las asignaciones queden bien creadas.',
      );
    }

    console.log(`  Vehículo titular:   ${vehiculoTitular.rows[0]!.placa} (${VEHICULO_TITULAR_ID})`);
    console.log(`  Conductor titular:  ${conductorTitular.rows[0]!.documentoidentidad} (${CONDUCTOR_TITULAR_ID})`);
    console.log(`  Rotación:           ${rotacion.rows[0]!.periodo} — estado '${rotacion.rows[0]!.estado}'`);
    console.log(`  socioId a copiar:   ${socioIdTitular}`);

    // ------------------------------------------------------------------------------------
    // Paso 2 — Upsert de vehículo y conductor del pasante.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 2: vehículo + conductor del pasante ---');

    // Se lee el credencialHash previo ANTES del upsert solo para poder distinguir, en el
    // resumen de abajo, "SIN TOCAR" (había un PIN y se preservó) de "FIJADO porque estaba
    // NULL" (la fila existía pero sin hash — login imposible hasta esta corrida). La
    // corrección real que evita dejar un NULL preservado vive en el propio SQL del upsert
    // (el `CASE WHEN $N OR tabla."credencialHash" IS NULL` de cada uno), no acá.
    const vehiculoHashPrevio = await client.query<{ credencialhash: string | null }>(
      `SELECT "credencialHash" as credencialhash FROM vehiculos WHERE id = $1`,
      [VEHICULO_PASANTE_ID],
    );
    const vehiculoHashEraNulo = vehiculoHashPrevio.rows.length > 0 && vehiculoHashPrevio.rows[0]!.credencialhash === null;

    const conductorHashPrevio = await client.query<{ credencialhash: string | null }>(
      `SELECT "credencialHash" as credencialhash FROM conductores WHERE id = $1`,
      [CONDUCTOR_PASANTE_ID],
    );
    const conductorHashEraNulo = conductorHashPrevio.rows.length > 0 && conductorHashPrevio.rows[0]!.credencialhash === null;

    const vehiculoResultado = await client.query<ResultadoUpsert>(
      `INSERT INTO vehiculos
         (id, "sindicatoId", "socioId", placa, "placaNormalizada", tipo, marca, modelo, color, capacidad, estado, "credencialHash", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $4, 'bus_urbano', 'PLACEHOLDER', 'PLACEHOLDER', 'otro', 40, 'activo', $5, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         "sindicatoId" = EXCLUDED."sindicatoId",
         "socioId" = EXCLUDED."socioId",
         placa = EXCLUDED.placa,
         "placaNormalizada" = EXCLUDED."placaNormalizada",
         tipo = EXCLUDED.tipo,
         marca = EXCLUDED.marca,
         modelo = EXCLUDED.modelo,
         color = EXCLUDED.color,
         capacidad = EXCLUDED.capacidad,
         estado = EXCLUDED.estado,
         -- Ver "Idempotencia" en el comentario de cabecera: nunca se pisa un PIN ya
         -- entregado salvo FORZAR_PIN=1 — salvo que la fila ya existiera con credencialHash
         -- en NULL: ahí no hay PIN que preservar (el login sería imposible sin que nada lo
         -- avise), así que se fija igual aunque FORZAR_PIN no esté en 1.
         "credencialHash" = CASE WHEN $6 OR vehiculos."credencialHash" IS NULL THEN EXCLUDED."credencialHash" ELSE vehiculos."credencialHash" END,
         "updatedAt" = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [VEHICULO_PASANTE_ID, SINDICATO_PILOTO_ID, socioIdTitular, PLACA_PASANTE, credencialHashVehiculo, FORZAR_PIN],
    );

    const conductorResultado = await client.query<ResultadoUpsert>(
      `INSERT INTO conductores
         (id, "sindicatoId", nombre, "documentoIdentidad", "licenciaConducir", estado, "credencialHash", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'activo', $6, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         "sindicatoId" = EXCLUDED."sindicatoId",
         nombre = EXCLUDED.nombre,
         "documentoIdentidad" = EXCLUDED."documentoIdentidad",
         "licenciaConducir" = EXCLUDED."licenciaConducir",
         estado = EXCLUDED.estado,
         -- Mismo criterio que el upsert de vehiculos de arriba: además de FORZAR_PIN=1, se
         -- fija si la fila ya existía con credencialHash en NULL (no hay PIN que preservar).
         "credencialHash" = CASE WHEN $7 OR conductores."credencialHash" IS NULL THEN EXCLUDED."credencialHash" ELSE conductores."credencialHash" END,
         "updatedAt" = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [CONDUCTOR_PASANTE_ID, SINDICATO_PILOTO_ID, NOMBRE_PASANTE, DOCUMENTO_IDENTIDAD_PASANTE, LICENCIA_PASANTE, credencialHashConductor, FORZAR_PIN],
    );

    const vehiculoCreado = vehiculoResultado.rows[0]!.inserted;
    const conductorCreado = conductorResultado.rows[0]!.inserted;
    console.log(`  Vehículo pasante:  ${vehiculoCreado ? 'CREADO' : 'ya existía (actualizado)'} — placa ${PLACA_PASANTE} (${VEHICULO_PASANTE_ID})`);
    console.log(`  Conductor pasante: ${conductorCreado ? 'CREADO' : 'ya existía (actualizado)'} — CI ${DOCUMENTO_IDENTIDAD_PASANTE} (${CONDUCTOR_PASANTE_ID})`);

    // Distingue "SIN TOCAR" (ya había un PIN y se preservó) de "FIJADO" por NULL previo —
    // esto último es la fila corregida por el `CASE WHEN ... IS NULL` de arriba: sin el
    // aviso acá, ese caso pasaba antes como un "SIN TOCAR" silencioso con hash NULL, es
    // decir login imposible sin que el script dijera nada.
    function resumenHashFilaExistente(hashEraNulo: boolean): string {
      if (FORZAR_PIN) return 'ROTADO (FORZAR_PIN=1)';
      if (hashEraNulo) return 'FIJADO (la fila ya existía pero credencialHash estaba en NULL — login imposible hasta esta corrida)';
      return 'SIN TOCAR (fila ya existía con hash, FORZAR_PIN no está en 1)';
    }
    if (!vehiculoCreado) {
      console.log(`  credencialHash vehículo:  ${resumenHashFilaExistente(vehiculoHashEraNulo)}.`);
    }
    if (!conductorCreado) {
      console.log(`  credencialHash conductor: ${resumenHashFilaExistente(conductorHashEraNulo)}.`);
    }

    // ------------------------------------------------------------------------------------
    // Paso 3 — Upsert de las 15 asignaciones, orden = 100 + orden del titular en esa fecha.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 3: asignaciones del pasante (17→31 de agosto) ---');

    const fechas = fechasPasante();
    const ordenTitular = await client.query<FilaAsignacionTitular>(
      `SELECT fecha, orden FROM asignaciones
       WHERE "vehiculoId" = $1 AND horario = $2 AND fecha BETWEEN $3 AND $4`,
      [VEHICULO_TITULAR_ID, HORARIO_PASANTE, fechaIsoDeUtc(fechas[0]!), fechaIsoDeUtc(fechas[fechas.length - 1]!)],
    );
    const ordenPorFecha = new Map<string, number>();
    for (const fila of ordenTitular.rows) {
      // `fila.fecha` ya llega como texto 'YYYY-MM-DD' crudo (ver el `getTypeParser` del
      // Client) — no hay que reconstruirlo con `new Date(...)`, eso es justo lo que
      // reintroduciría el corrimiento de zona horaria.
      ordenPorFecha.set(fila.fecha, fila.orden);
    }

    const faltantes = fechas.filter((f) => !ordenPorFecha.has(fechaIsoDeUtc(f)));
    if (faltantes.length > 0) {
      throw new Error(
        `El titular no tiene asignación '${HORARIO_PASANTE}' para ${faltantes.length} fecha(s): ` +
          `${faltantes.map(fechaIsoDeUtc).join(', ')}. No se puede calcular el orden del pasante para ` +
          'esas fechas sin inventarlo — abortando antes de escribir nada.',
      );
    }

    const filasAsignacion: { fecha: string; orden: number; creada: boolean }[] = [];
    for (const fecha of fechas) {
      const ordenTitularFecha = ordenPorFecha.get(fechaIsoDeUtc(fecha))!;
      const ordenPasante = OFFSET_ORDEN_PASANTE + ordenTitularFecha;
      // Ambos como texto explícito (no `Date`) — ver "Fechas y horas" en la cabecera. `pg`
      // manda un string literal a Postgres, que lo castea según la columna destino; ningún
      // offset local se mete en el camino.
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
           -- Fix 2026-08-18 (revisión pre-merge PR #37, hallazgo MEDIO): antes pisaba
           -- incondicionalmente a 'vigente' — una re-corrida resucitaba asignaciones que
           -- alguien canceló a mano. Mismo criterio conservador que ya se aplica arriba a
           -- "credencialHash": solo se escribe si la fila YA estaba 'vigente' (no-op en ese
           -- caso); si está en cualquier otro estado (p. ej. cancelada a mano), se preserva.
           estado = CASE WHEN asignaciones.estado = 'vigente' THEN EXCLUDED.estado ELSE asignaciones.estado END,
           "updatedAt" = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          randomUUID(),
          ROTACION_PILOTO_ID,
          VEHICULO_PASANTE_ID,
          CONDUCTOR_PASANTE_ID,
          RUTA_PILOTO_ID,
          fechaTexto,
          HORARIO_PASANTE,
          ordenPasante,
          venceAtTexto,
        ],
      );
      filasAsignacion.push({ fecha: fechaTexto, orden: ordenPasante, creada: resultado.rows[0]!.inserted });
    }

    console.table(filasAsignacion);
    const creadas = filasAsignacion.filter((f) => f.creada).length;
    console.log(`  ${creadas} asignación(es) creada(s), ${filasAsignacion.length - creadas} ya existían (actualizadas).`);

    const vigentesAhora = await client.query<{ count: string }>(
      `SELECT count(*) FROM asignaciones WHERE "vehiculoId" = $1 AND estado = 'vigente'`,
      [VEHICULO_PASANTE_ID],
    );
    console.log(`  Total de asignaciones 'vigente' del pasante en este momento: ${vigentesAhora.rows[0]!.count}.`);

    // ------------------------------------------------------------------------------------
    // Paso 4 — Verificación de solo lectura: ¿la asignación de HOY habilita el login móvil?
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 4: ¿la asignación de HOY (Bolivia) habilita el login móvil? ---');

    const hoyBolivia = fechaActualBolivia();
    const ahora = new Date();
    // Filtro `estado = 'vigente'` + `ORDER BY` replicando exactamente el `where`/`orderBy`
    // de `buscarAsignaciones` (auth-movil.service.ts:439-458): sin esto, si el pasante
    // llegara a tener dos asignaciones para la misma fecha (otro horario, cargado a mano o
    // por una rotación futura), Postgres podía devolver primero una vencida/no vigente y
    // `rows[0]` quedarse con esa — falso ⚠ en este script mientras el login móvil, que sí
    // usa el criterio completo del servicio, funciona bien igual.
    const asignacionHoy = await client.query<{ id: string; estado: string; venceat: string; rotacion_estado: string }>(
      `SELECT a.id, a.estado, a."venceAt" as venceat, r.estado as rotacion_estado
       FROM asignaciones a JOIN rotaciones r ON r.id = a."rotacionId"
       WHERE a."vehiculoId" = $1 AND a."conductorId" = $2 AND a.fecha = $3 AND a.estado = 'vigente'
       ORDER BY a.orden ASC, a.horario ASC`,
      [VEHICULO_PASANTE_ID, CONDUCTOR_PASANTE_ID, fechaIsoDeUtc(hoyBolivia)],
    );

    // `fila.venceat` llega como texto crudo ('YYYY-MM-DD HH:MM:SS', sin offset) por el mismo
    // motivo que `fila.fecha` en el Paso 3 — se interpreta explícitamente como UTC con
    // `timestampUtcDeTexto` (misma convención que usa Prisma en el API real para esta
    // columna). Comparar el texto o un `Date` reconstruido en hora local daría el mismo
    // resultado incorrecto contra el que apunta todo este arreglo.
    //
    // Misma condición exacta que `buscarAsignaciones` en auth-movil.service.ts (fecha =
    // hoy Bolivia, estado = 'vigente', venceAt > ahora, rotacion.estado = 'publicada'). NO
    // se lanza excepción si falla: correr este script fuera de la ventana 17→31 de agosto,
    // o antes de que arranque el día, es legítimo — solo se avisa fuerte en el log.
    const fila = asignacionHoy.rows[0];
    const venceAtFila = fila ? timestampUtcDeTexto(fila.venceat) : undefined;
    const ok =
      fila !== undefined && fila.estado === 'vigente' && venceAtFila!.getTime() > ahora.getTime() && fila.rotacion_estado === 'publicada';

    if (ok) {
      console.log(`  ✅ OK: hay asignación vigente para hoy (${fechaIsoDeUtc(hoyBolivia)}), vence ${venceAtFila!.toISOString()}. El login móvil del pasante debería funcionar ahora mismo.`);
    } else if (!fila) {
      console.warn(
        `  ⚠ AVISO: no hay ninguna asignación del pasante para la fecha calendario Bolivia de hoy (${fechaIsoDeUtc(hoyBolivia)}). ` +
          `Es esperable si hoy cae fuera del rango ${PRIMERA_FECHA_PASANTE}..${ULTIMA_FECHA_PASANTE} — el login móvil del pasante NO va a funcionar hoy.`,
      );
    } else {
      console.warn(
        `  ⚠ AVISO: hay asignación de hoy pero no cumple lo que exige el login móvil — ` +
          `estado='${fila.estado}' (se espera 'vigente'), venceAt=${venceAtFila!.toISOString()} ` +
          `(¿futuro? ${venceAtFila!.getTime() > ahora.getTime()}), rotación.estado='${fila.rotacion_estado}' (se espera 'publicada'). ` +
          'El login móvil del pasante NO va a funcionar hasta corregir esto.',
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ COMMIT. Cambios aplicados.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Abortado, ROLLBACK. Nada quedó escrito en la base.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// `main()` es async y tres puntos de falla quedan FUERA del `try/catch` interno porque
// ocurren ANTES de que `client` (y por lo tanto ese `try`) exista: el `import()` dinámico
// de 'better-auth/crypto', `hashPassword`, y `client.connect()`. Sin este `.catch()`, un
// `DATABASE_URL` mal formado o una base inalcanzable saldría como unhandled rejection —
// stack crudo de Node en vez del camino "❌ Abortado" del resto del script. No hay
// conexión que cerrar en esos tres casos (fallan antes de `client.connect()` o durante
// ella), así que alcanza con loguear y marcar el exit code acá; no hace falta mover nada
// al `try/catch` interno ni duplicar el manejo de `client.end()`.
main().catch((err) => {
  console.error('\n❌ Abortado antes de poder conectar a la base o preparar los hashes.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
