#!/usr/bin/env node
// Carga de lectura concurrente del mapa en vivo — replica las 3 queries de
// `apps/api/src/modules/reportes/en-vivo.service.ts` tal cual, con K "monitores" (pestañas
// de admin abiertas) pollenado a los intervalos reales de `apps/web`:
//   - listarHoy       (en-vivo.service.ts:248-365, PR #74/gps_sesion_resumen) — refetchInterval
//     30_000 (apps/web/src/lib/en-vivo/use-en-vivo.ts:34, hook useSesionesEnVivo).
//   - obtenerPosiciones (en-vivo.service.ts:366-513, PR #74/gps_sesion_resumen) — SIN hook
//     propio en apps/web todavía (grep: `obtenerPosiciones` no tiene ningún call site en
//     apps/web — el único consumidor de datos de POSICIÓN en el mapa hoy es
//     `useTrazaEnVivo`, que llama al endpoint de TRAZA por sesión, no a este). Se poll-ea
//     igual acá (el harness lo pide explícito) al mismo ritmo que `INTERVALO_POLL_MS`
//     (en-vivo/traza.ts:27, 10_000ms) — es una asunción declarada, no un intervalo
//     confirmado en el cliente real.
//   - obtenerTraza    (en-vivo.service.ts:514-601) — SIN cambios por PR #74 (sigue leyendo
//     `gps_points` directo, una sola sesión, sin N+1) — refetchInterval dinámico
//     `intervaloPoll` (en-vivo/traza.ts:225-234): 10_000ms normal, 1_000ms si `hayMas`
//     (recuperando atraso), `false` (corta) si inactiva >30min. Acá se usa el valor normal
//     fijo (10_000ms) por simplicidad — el modo rápido de 1s es un escenario de ráfaga corta,
//     no el estado estable que interesa medir throughput sostenido.
//
// Tenant: rol 'admin_sindicato' (Roles del controller: admin_quivo | admin_sindicato) con el
// sindicatoId sembrado — así RLS FORCE filtra de verdad (con 'admin_quivo' el bypass explícito
// de la policy dejaría pasar todo sin comparar sindicatoId, que no es el caso real de un panel
// de sindicato viendo su propia flota).
//
// Modo remoto (docs/plan-experimento-puntos-gps.md §10): igual que generador.mjs, con
// QUIVO_CARGA_DATABASE_URL seteada `runtimePool()` apunta a Cloud SQL — sin cambios acá.
//
// Uso: node lecturas.mjs <K> <duracionSegundos>
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { runtimePool, logObjetivo } from './lib/pg.mjs';

const K = Number(process.argv[2] ?? 20);
const DURACION_SEGUNDOS = Number(process.argv[3] ?? 300);
const CALENTAMIENTO_SEGUNDOS = Number(process.env.QUIVO_CARGA_CALENTAMIENTO ?? 60);
const ESTADO_PATH = process.env.QUIVO_CARGA_ESTADO ?? new URL('./seed-estado.json', import.meta.url).pathname;
const SALIDA = process.argv[4] ?? new URL('./resultados/ultimo-lecturas.json', import.meta.url).pathname;

const POLL_LISTAR_MS = 30_000;
const POLL_POSICIONES_MS = 10_000;
const POLL_TRAZA_MS = 10_000;

const PISO_ANTES_DEL_INICIO_MS = 60_000;
const TECHO_DESPUES_DEL_FIN_MS = 2 * 60 * 60_000;
const TECHO_MAXIMO_DESDE_INICIO_MS = 36 * 60 * 60_000;
const TRAZA_LIMITE_DEFAULT = 8_000;
const VENTANA_SESIONES_POSICIONES_MS = 24 * 60 * 60_000;
const LIMITE_SESIONES_POSICIONES = 500;

const estado = JSON.parse(readFileSync(ESTADO_PATH, 'utf8'));
const sesiones = estado.sesiones;

// Hallazgo 7 de revisión (2026-09-22): cada `K` arma 3 bucles concurrentes (listarHoy,
// obtenerPosiciones, bucleTraza) — hasta 3K conexiones pidiéndose al pool a la vez si los 3
// pollean en el mismo instante. Un pool de `K+2` subdimensiona por 3× y esconde el costo real
// de cada query detrás de tiempo de ESPERA por conexión (pool wait), no de ejecución — el
// punto de quiebre medido sería el del POOL, no el de Postgres. `3K+2` da margen para que los
// 3 bucles de los K monitores adquieran conexión al mismo tiempo sin colas artificiales.
const pool = runtimePool(3 * K + 2);
const ROL = 'admin_sindicato';

/**
 * Devuelve `{ resultado, poolWaitMs, latenciaMs }`: `poolWaitMs` es el tiempo bloqueado en
 * `pool.connect()` (contención del pool, NO de Postgres); `latenciaMs` arranca DESPUÉS de
 * adquirir el cliente — es el costo real de la transacción/query, que es lo que hay que
 * comparar contra el techo de 1500ms (`p95LoteAlto` en `correr-punto.mjs`). Antes de este fix
 * `bucle()` medía `t0` ANTES de `pool.connect()`, así que `latenciaMs` mezclaba ambos tiempos
 * — con el pool subdimensionado (ver arriba) esa mezcla podía atribuirle a la QUERY una
 * lentitud que en realidad era espera de conexión.
 */
async function conTenant(fn) {
  const tEsperaInicio = performance.now();
  const client = await pool.connect();
  const poolWaitMs = performance.now() - tEsperaInicio;
  const tQueryInicio = performance.now();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.rol', $1, true)`, [ROL]);
    await client.query(`SELECT set_config('app.sindicato_id', $1, true)`, [estado.sindicatoId]);
    const r = await fn(client);
    await client.query('COMMIT');
    return { resultado: r, poolWaitMs, latenciaMs: performance.now() - tQueryInicio };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- Jornada Bolivia (UTC-4 fijo, sin tzdb) — replica EXACTA de
// apps/api/src/common/tiempo/jornada.ts (fechaActualBolivia / inicioDeJornadaBolivia /
// inicioDeJornadaSiguienteBolivia). Hallazgo 7 de revisión (2026-09-22): antes acá había una
// versión ad-hoc (`jornadaBolivia`) que daba el mismo rango pero no reflejaba que la SQL real
// (desde PR #74 / gps_sesion_resumen) ya no filtra por `ts` de puntos sino por `jornada`
// (columna `date`) de `gps_sesion_resumen` — necesitamos el STRING de fecha, no solo el
// instante, para reproducir el `::date` de la query real.
const BOLIVIA_UTC_OFFSET_HOURS = 4;
function fechaActualBolivia(ahora) {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}
function inicioDeJornadaBolivia(fecha) {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), BOLIVIA_UTC_OFFSET_HOURS),
  );
}
function inicioDeJornadaSiguienteBolivia(fecha) {
  const siguiente = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + 1));
  return inicioDeJornadaBolivia(siguiente);
}
// Mantenido para `obtenerTraza` (más abajo), que sigue usando el rango de instantes, no el
// string de jornada.
function jornadaBolivia(ahora) {
  const jornada = fechaActualBolivia(ahora);
  return { trazaDesde: inicioDeJornadaBolivia(jornada), trazaHasta: inicioDeJornadaSiguienteBolivia(jornada) };
}

// ---- listarHoy — SQL IDÉNTICA a `EnVivoService.listarHoy`
// (apps/api/src/modules/reportes/en-vivo.service.ts:225-278, PR #74 / gps_sesion_resumen):
// ya NO escanea `gps_points` (el N+1 de §8/plan-en-vivo-resumen-sesion.md) — lee
// `gps_sesion_resumen` por PK `(sesion_id, jornada, sindicatoId)`. Copiado a mano (no hay
// forma de importar TS desde este script) — si el archivo fuente cambia esta query, hay que
// volver a copiarla.
async function listarHoy(client) {
  const jornada = fechaActualBolivia(new Date());
  const trazaDesde = inicioDeJornadaBolivia(jornada);
  const trazaHasta = inicioDeJornadaSiguienteBolivia(jornada);
  const jornadaStr = jornada.toISOString().slice(0, 10);
  return client.query(
    `SELECT so.id, so.inicio, so.fin, so.estado, so."deviceId",
        v.placa as "vehiculoPlaca", c.nombre as "conductorNombre", l.nombre as "lineaNombre",
        res.ultimo_fix_ts AS "ultimoFixTs", res.ultimo_ingreso_ts AS "ultimoIngresoTs",
        res.total_puntos AS "totalPuntos"
     FROM sesiones_operativas so
     JOIN vehiculos v ON v.id = so."vehiculoId"
     JOIN conductores c ON c.id = so."conductorId"
     JOIN asignaciones a ON a.id = so."asignacionId"
     JOIN rutas ru ON ru.id = a."rutaId"
     JOIN lineas l ON l.id = ru."lineaId"
     LEFT JOIN LATERAL (
       SELECT ultimo_fix_ts, ultimo_ingreso_ts, total_puntos
       FROM gps_sesion_resumen gr
       WHERE gr.sesion_id = so.id::uuid AND gr.jornada = $3::date
         AND gr."sindicatoId" = so."sindicatoId"
       LIMIT 1
     ) res ON true
     WHERE (so.inicio >= $1 AND so.inicio < $2) OR (so.fin IS NULL AND so.estado = 'activa')
     ORDER BY (so.fin IS NULL) DESC, res.ultimo_fix_ts DESC NULLS LAST, so.inicio DESC
     LIMIT 100`,
    [trazaDesde, trazaHasta, jornadaStr],
  );
}

// ---- obtenerPosiciones — SQL IDÉNTICA a `EnVivoService.obtenerPosiciones`
// (apps/api/src/modules/reportes/en-vivo.service.ts:359-424, PR #74 / gps_sesion_resumen):
// mira la jornada de HOY y de AYER en `gps_sesion_resumen` (a lo sumo 2 filas por sesión,
// resuelto por PK), no un escaneo de `gps_points`. Copiado a mano — ver nota de arriba.
async function obtenerPosiciones(client) {
  const ahora = new Date();
  const jornada = fechaActualBolivia(ahora);
  const jornadaAyer = new Date(jornada.getTime() - 24 * 60 * 60_000);
  const trazaDesde = inicioDeJornadaBolivia(jornada);
  const sesionesDesde = new Date(ahora.getTime() - VENTANA_SESIONES_POSICIONES_MS);
  const posicionesDesde = trazaDesde.getTime() < sesionesDesde.getTime() ? trazaDesde : sesionesDesde;
  const jornadaStr = jornada.toISOString().slice(0, 10);
  const jornadaAyerStr = jornadaAyer.toISOString().slice(0, 10);
  return client.query(
    `SELECT so.id, so.inicio, so.fin, so.estado, so."deviceId",
        v.placa as "vehiculoPlaca", c.nombre as "conductorNombre",
        l.id as "lineaId", l.nombre as "lineaNombre", ru.sentido as "rutaSentido",
        fix.lat, fix.lng, fix.accuracy, fix.speed,
        fix."ultimoFixTs", fix."ultimoIngresoTs", fix."totalPuntos"
     FROM sesiones_operativas so
     JOIN vehiculos v ON v.id = so."vehiculoId"
     JOIN conductores c ON c.id = so."conductorId"
     JOIN asignaciones a ON a.id = so."asignacionId"
     JOIN rutas ru ON ru.id = a."rutaId"
     JOIN lineas l ON l.id = ru."lineaId"
     LEFT JOIN LATERAL (
       SELECT gr.lat, gr.lng, gr.accuracy, gr.speed,
              gr.ultimo_fix_ts AS "ultimoFixTs",
              max(gr.ultimo_ingreso_ts) OVER () AS "ultimoIngresoTs",
              gr.total_puntos AS "totalPuntos"
       FROM gps_sesion_resumen gr
       WHERE gr.sesion_id = so.id::uuid
         AND gr."sindicatoId" = so."sindicatoId"
         AND gr.jornada IN ($4::date, $5::date)
         AND gr.ultimo_fix_ts >= $1
       ORDER BY gr.ultimo_fix_ts DESC
       LIMIT 1
     ) fix ON true
     WHERE (so.inicio >= $2) OR (so.fin IS NULL AND so.estado = 'activa')
     ORDER BY (so.fin IS NULL) DESC, fix."ultimoFixTs" DESC NULLS LAST, so.inicio DESC
     LIMIT $3`,
    [posicionesDesde, sesionesDesde, LIMITE_SESIONES_POSICIONES, jornadaStr, jornadaAyerStr],
  );
}

// ---- obtenerTraza (en-vivo.service.ts:514-601) ----
//
// `desdeCursor`: el cursor ACUMULADO del monitor simulado (máximo `ts` visto en cualquier
// delta anterior), o `null` en el primer poll — igual que `TrazaAcumulada.cursor`
// (apps/web/src/lib/en-vivo/traza.ts:118, seteado a `ultimo?.ts` tras fusionar CADA delta
// contra la traza acumulada completa, `fusionarTraza` líneas 102-125). El caller (el bucle
// de abajo) es quien aplica `desdeConSolape` (traza.ts:130-132, resta
// `SOLAPE_CURSOR_MS = 900_000` = 15 min, traza.ts:24) antes de pasarlo como `desde` — acá
// solo se resuelve la query con el `desde` YA resuelto, exactamente como hace el service
// real con `query.desde` (en-vivo.service.ts:468-471: sin `desde` cae al piso — traza
// completa; con `desde`, se clampa entre piso y techo).
async function obtenerTraza(client, sesionId, desdeParam) {
  const { rows: sesionRows } = await client.query(
    `SELECT id, inicio, fin FROM sesiones_operativas WHERE id = $1`,
    [sesionId],
  );
  const sesion = sesionRows[0];
  if (!sesion) return { cursor: null, puntos: 0 };
  const inicioMs = new Date(sesion.inicio).getTime();
  const piso = new Date(inicioMs - PISO_ANTES_DEL_INICIO_MS);
  const ahora = Date.now();
  const techo = new Date(
    Math.min((sesion.fin ? new Date(sesion.fin).getTime() : ahora) + TECHO_DESPUES_DEL_FIN_MS, inicioMs + TECHO_MAXIMO_DESDE_INICIO_MS),
  );
  const desdePedido = desdeParam ? desdeParam.getTime() : piso.getTime();
  const desde = new Date(Math.min(Math.max(desdePedido, piso.getTime()), techo.getTime()));
  const limite = TRAZA_LIMITE_DEFAULT;

  const { rows: gpsRows } = await client.query(
    `SELECT ts, lat, lng, accuracy, speed FROM gps_points
     WHERE sesion_id = $1::uuid AND ts >= $2 AND ts < $3
     ORDER BY ts ASC LIMIT $4`,
    [sesionId, desde, techo, limite + 1],
  );
  await client.query(
    `SELECT max(ts) AS "ultimoFixTs", max(received_at) AS "ultimoIngresoTs", count(*)::int AS "totalPuntos"
     FROM gps_points WHERE sesion_id = $1::uuid AND ts >= $2 AND ts < $3`,
    [sesionId, piso, techo],
  );
  await client.query(`SELECT id, "puntoControlId", ts, cumplido, pasada FROM cumplimientos_pc WHERE "sesionId" = $1`, [
    sesionId,
  ]);
  const ultimo = gpsRows.at(-1);
  return { cursor: ultimo ? new Date(ultimo.ts) : null, puntos: gpsRows.length };
}

/** `desdeConSolape` (apps/web/src/lib/en-vivo/traza.ts:130-132): el cursor menos 15 min de
 * solape. `null`/`undefined` (sin cursor todavía) devuelve `null` = pedir la ventana
 * completa, igual que el cliente real en su primer poll. */
const SOLAPE_CURSOR_MS = 900_000;
function desdeConSolape(cursor) {
  if (!cursor) return null;
  return new Date(cursor.getTime() - SOLAPE_CURSOR_MS);
}

const metricas = {
  listarHoy: { n: 0, errores: 0, lat: [], poolWait: [] },
  obtenerPosiciones: { n: 0, errores: 0, lat: [], poolWait: [] },
  obtenerTraza: { n: 0, errores: 0, lat: [], poolWait: [] },
  errores: [],
};
let midiendo = false;
let corriendo = true;

function registrar(nombre, latenciaMs, poolWaitMs, midiendoAhora) {
  if (!midiendoAhora) return;
  metricas[nombre].n += 1;
  metricas[nombre].lat.push(latenciaMs);
  metricas[nombre].poolWait.push(poolWaitMs);
}

// Hallazgo 8 de revisión (2026-09-22): un error de lectura contaba en `metricas.errores`
// (la muestra de texto libre) pero NUNCA en un contador por tipo — `correr-punto.mjs` no
// tenía forma de calcular una TASA de error por query (solo "n===0 en las 3 a la vez"), así
// que una query que fallara, digamos, 30% de las veces pero sin llegar a 0 éxitos totales
// pasaba como PASA sin que nada lo marcara. `registrarError` cuenta por tipo, igual que
// `registrar` cuenta éxitos por tipo.
function registrarError(nombre, err, midiendoAhora) {
  if (!midiendoAhora) return;
  metricas[nombre].errores += 1;
  metricas.errores.push(`${nombre}: ${String(err.message ?? err)}`);
}

async function bucle(nombre, intervaloMs, fn) {
  while (corriendo) {
    try {
      const { latenciaMs, poolWaitMs } = await conTenant(fn);
      registrar(nombre, latenciaMs, poolWaitMs, midiendo);
    } catch (err) {
      registrarError(nombre, err, midiendo);
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}

/**
 * Bucle de traza CON cursor propio, uno por monitor simulado — el cliente real
 * (`useTrazaEnVivo`, apps/web/src/lib/en-vivo/use-en-vivo.ts:71-92) pide la ventana
 * completa solo la primera vez (sin cursor) y de ahí en más manda
 * `desde = desdeConSolape(cursor)`, reduciendo cada poll a un delta reciente en vez de
 * releer toda la traza acumulada — sin esto, cada poll de `obtenerTraza` degradaba a
 * "traza completa" (hasta 8.001 puntos) para siempre, mucho más caro que el patrón real.
 */
async function bucleTraza(sesionId) {
  let cursor = null;
  while (corriendo) {
    try {
      const desdeParam = desdeConSolape(cursor);
      const { resultado: r, poolWaitMs, latenciaMs } = await conTenant((client) =>
        obtenerTraza(client, sesionId, desdeParam),
      );
      if (r?.cursor) cursor = r.cursor;
      registrar('obtenerTraza', latenciaMs, poolWaitMs, midiendo);
    } catch (err) {
      registrarError('obtenerTraza', err, midiendo);
    }
    await new Promise((r) => setTimeout(r, POLL_TRAZA_MS));
  }
}

function percentil(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

/** % de intentos (éxitos + errores) que fallaron, para un tipo de query — hallazgo 8. */
function tasaError({ n, errores }) {
  const intentos = n + errores;
  return intentos === 0 ? 0 : (errores / intentos) * 100;
}

async function main() {
  logObjetivo('lecturas.mjs');
  console.error(`Lecturas: K=${K} monitores, calentamiento=${CALENTAMIENTO_SEGUNDOS}s, medicion=${DURACION_SEGUNDOS}s`);
  const bucles = [];
  for (let i = 0; i < K; i++) {
    const sesion = sesiones[i % sesiones.length];
    bucles.push(bucle('listarHoy', POLL_LISTAR_MS, (client) => listarHoy(client)));
    bucles.push(bucle('obtenerPosiciones', POLL_POSICIONES_MS, (client) => obtenerPosiciones(client)));
    bucles.push(bucleTraza(sesion.sesionId));
  }

  await new Promise((r) => setTimeout(r, CALENTAMIENTO_SEGUNDOS * 1000));
  console.error('Fin de calentamiento (lecturas), empieza medición.');
  midiendo = true;
  await new Promise((r) => setTimeout(r, DURACION_SEGUNDOS * 1000));
  midiendo = false;
  corriendo = false;
  await new Promise((r) => setTimeout(r, 500));

  // Hallazgo 7 de revisión: `poolWaitMs` (tiempo bloqueado en `pool.connect()`) se reporta
  // SEPARADO de `p50/p95/p99Ms` (latencia de la query, ya sin el tiempo de espera por
  // conexión) — ver `conTenant()`. Un `poolWaitP95Ms` alto con `p95Ms` bajo delata un pool
  // subdimensionado, no una query lenta.
  const resultado = {
    K,
    duracionMedicionS: DURACION_SEGUNDOS,
    poolSize: 3 * K + 2,
    listarHoy: {
      n: metricas.listarHoy.n,
      errores: metricas.listarHoy.errores,
      tasaErrorPct: tasaError(metricas.listarHoy),
      p50Ms: percentil(metricas.listarHoy.lat, 50),
      p95Ms: percentil(metricas.listarHoy.lat, 95),
      p99Ms: percentil(metricas.listarHoy.lat, 99),
      poolWaitP50Ms: percentil(metricas.listarHoy.poolWait, 50),
      poolWaitP95Ms: percentil(metricas.listarHoy.poolWait, 95),
    },
    obtenerPosiciones: {
      n: metricas.obtenerPosiciones.n,
      errores: metricas.obtenerPosiciones.errores,
      tasaErrorPct: tasaError(metricas.obtenerPosiciones),
      p50Ms: percentil(metricas.obtenerPosiciones.lat, 50),
      p95Ms: percentil(metricas.obtenerPosiciones.lat, 95),
      p99Ms: percentil(metricas.obtenerPosiciones.lat, 99),
      poolWaitP50Ms: percentil(metricas.obtenerPosiciones.poolWait, 50),
      poolWaitP95Ms: percentil(metricas.obtenerPosiciones.poolWait, 95),
    },
    obtenerTraza: {
      n: metricas.obtenerTraza.n,
      errores: metricas.obtenerTraza.errores,
      tasaErrorPct: tasaError(metricas.obtenerTraza),
      p50Ms: percentil(metricas.obtenerTraza.lat, 50),
      p95Ms: percentil(metricas.obtenerTraza.lat, 95),
      p99Ms: percentil(metricas.obtenerTraza.lat, 99),
      poolWaitP50Ms: percentil(metricas.obtenerTraza.poolWait, 50),
      poolWaitP95Ms: percentil(metricas.obtenerTraza.poolWait, 95),
    },
    erroresMuestra: metricas.errores.slice(0, 5),
  };
  writeFileSync(SALIDA, JSON.stringify(resultado, null, 2));
  console.error(JSON.stringify(resultado, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error('Lecturas falló:', err);
  process.exitCode = 1;
});
