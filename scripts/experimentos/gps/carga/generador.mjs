#!/usr/bin/env node
// Generador de carga de escritura GPS — replica la transacción EXACTA de
// `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts`:
//   - `withTenantContext` (packages/db/src/tenant-context.ts:20-28): una transacción con
//     `SELECT set_config('app.rol', $1, true)` + `SELECT set_config('app.sindicato_id', $2, true)`
//     ANTES del INSERT — es lo que hace que RLS/FORCE ROW LEVEL SECURITY se evalúe de verdad.
//   - `insertarGpsPoints` (ingesta-worker.service.ts:305-345): INSERT multi-fila
//     `ON CONFLICT (event_id, ts) DO NOTHING` con exactamente las mismas 9 columnas y el
//     mismo orden de valores (incluye `now()` para received_at, `sindicatoId` fijo del lote,
//     nunca del payload — mismo criterio de confianza del código real).
//   - Rol de conexión: `quivo_app` (RUNTIME_DATABASE_URL real), NUNCA el rol admin/dueño de
//     las tablas — así la medición atraviesa RLS FORCE de verdad, como en producción.
//   - Concurrencia: BullMQ `Worker` en `ingesta-worker.service.ts:62-66` se crea SIN opción
//     `concurrency` → default de BullMQ = 1 (un lote a la vez, serializado). Producción
//     además corre `quivo-worker` como Worker Pool de 1 sola instancia fija
//     (docs/costos-gcp-por-escala.md). Por fidelidad, el default acá también es 1 — un solo
//     "trabajador" async drena la cola en memoria, uno por vez. Ver --concurrencia para
//     correr un escenario NO real (diagnóstico) con más de un trabajador.
//   - Tamaño de lote: sync 15s / 60s de un trufi a razón de ~1 pt/s (distanceFilter 15m con
//     velocidad de crucero urbana ~54km/h da ~1 punto/s — ver
//     apps/mobile/src/gps/background-geolocation.config.ts:52). `LOTE_MAXIMO=500`
//     (apps/mobile/src/features/operacion/sync-outbox.ts:16) cap el tamaño de un lote real
//     del outbox móvil — a 1pt/s y sync<=60s nunca se llega a ese tope, así que no hace
//     falta partir lotes acá (60 < 500).
//
// Modo remoto (docs/plan-experimento-puntos-gps.md §10): con QUIVO_CARGA_DATABASE_URL
// seteada, `runtimePool()` (lib/pg.mjs) apunta a Cloud SQL en vez del Docker local — este
// archivo no cambia. La latencia de red (Bolivia->Santiago) se compensa subiendo
// `[concurrencia]`/`QUIVO_CARGA_CONCURRENCIA` (8 y 16 en remoto, ver RUNBOOK), NO bajándola.
//
// Uso: node generador.mjs <objetivoPtsSeg> <syncSegundos:15|60> <duracionSegundos> [concurrencia]
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { runtimePool, logObjetivo } from './lib/pg.mjs';

const OBJETIVO_PTS_SEG = Number(process.argv[2] ?? 300);
const SYNC_SEGUNDOS = Number(process.argv[3] ?? 15);
const DURACION_SEGUNDOS = Number(process.argv[4] ?? 300);
const CONCURRENCIA = Number(process.argv[5] ?? process.env.QUIVO_CARGA_CONCURRENCIA ?? 1);
const CALENTAMIENTO_SEGUNDOS = Number(process.env.QUIVO_CARGA_CALENTAMIENTO ?? 60);
const ESTADO_PATH = process.env.QUIVO_CARGA_ESTADO ?? new URL('./seed-estado.json', import.meta.url).pathname;
const SALIDA = process.argv[6] ?? new URL('./resultados/ultimo-generador.json', import.meta.url).pathname;

const estado = JSON.parse(readFileSync(ESTADO_PATH, 'utf8'));
const sesiones = estado.sesiones;
if (sesiones.length === 0) throw new Error('seed-estado.json no tiene sesiones');

// 1 trufi ~ 1 pt/s (ver comentario de arriba). M = objetivo, salvo que no haya tantas
// sesiones sembradas — en ese caso varias "sesiones" comparten trufi lógico repitiendo el
// pool round-robin (declarado como desviación: menos dispositivos concurrentes reales que
// pts/s objetivo, mismo volumen agregado).
const M = OBJETIVO_PTS_SEG;
const trufis = [];
for (let i = 0; i < M; i++) {
  const s = sesiones[i % sesiones.length];
  trufis.push({
    sesionId: s.sesionId,
    deviceId: s.deviceId,
    // offset de arranque aleatorio dentro de la ventana de sync — los dispositivos reales
    // no sincronizan todos en el mismo instante.
    offsetMs: Math.floor(Math.random() * SYNC_SEGUNDOS * 1000),
    // punto de partida sintético sobre la recta sembrada en seed.mjs (no importa la
    // geometría exacta para medir throughput de INSERT).
    lat: -17.4 + Math.random() * 0.05,
    lng: -66.2 + Math.random() * 0.1,
  });
}

const pool = runtimePool(Math.max(CONCURRENCIA, 2));

function filaGpsPoint(sindicatoId, sesionId, deviceId, ts, lat, lng) {
  return {
    eventId: randomUUID(),
    sesionId,
    deviceId,
    ts: new Date(ts).toISOString(),
    lat: lat + (Math.random() - 0.5) * 0.0005,
    lng: lng + (Math.random() - 0.5) * 0.0005,
    accuracy: 5 + Math.random() * 10,
    speed: 3 + Math.random() * 8,
  };
}

/**
 * Transacción idéntica a `withTenantContext` + `insertarGpsPoints` — ver cabecera del
 * archivo para las referencias file:line exactas del código real que esto replica.
 */
async function insertarLote(sindicatoId, filas) {
  const t0 = performance.now();
  // `pool.connect()` FUERA del try/catch de la transacción es justo el punto de falla más
  // probable cuando el perfil está saturado (pool agotado, Postgres sin backends libres) —
  // ahí es exactamente donde interesa que el generador SIGA corriendo y cuente el fallo
  // como lote fallido, no que tire un unhandled rejection y mate el proceso a mitad de la
  // corrida, ocultando el punto de quiebre real que la matriz busca encontrar.
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    return {
      ok: false,
      latenciaMs: performance.now() - t0,
      filas: filas.length,
      error: `connect: ${String(err.message ?? err)}`,
    };
  }
  try {
    await client.query('BEGIN');
    // withTenantContext (tenant-context.ts:24-26) — mismo contexto que usa el worker real
    // para gps_point: rol admin_quivo, sindicatoId del lote (nunca del payload).
    await client.query(`SELECT set_config('app.rol', $1, true)`, ['admin_quivo']);
    await client.query(`SELECT set_config('app.sindicato_id', $1, true)`, [sindicatoId]);

    const valores = [];
    const params = [];
    filas.forEach((f, i) => {
      const base = i * 8;
      valores.push(
        `(${['$' + (base + 1) + '::uuid', '$' + (base + 2) + '::uuid', '$' + (base + 3)].join(', ')}, ` +
          `${'$' + (base + 4)}::timestamptz, ${'$' + (base + 5)}, ${'$' + (base + 6)}, ` +
          `${'$' + (base + 7)}, ${'$' + (base + 8)}, now(), $${filas.length * 8 + 1})`,
      );
      params.push(f.eventId, f.sesionId, f.deviceId, f.ts, f.lat, f.lng, f.accuracy, f.speed);
    });
    params.push(sindicatoId);

    // SQL IDÉNTICA a `insertarGpsPoints`
    // (apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts:390-448, PR #74,
    // 2026-09-21/22 — `gps_sesion_resumen`) — hallazgo 5 de revisión, 2026-09-22: la versión
    // anterior de este harness solo insertaba `gps_points`, de ANTES de que el worker real
    // empezara a mantener `gps_sesion_resumen` en el MISMO statement. Medir con la versión
    // vieja subestima el costo real de escritura (falta el CTE de agregación + el upsert).
    // Mismo `WITH ins AS (... RETURNING ...)`, mismo `ORDER BY`, mismo `AT TIME ZONE 'UTC'` —
    // si el archivo fuente cambia esta query, este bloque hay que volver a copiarlo a mano
    // (no hay forma de importar TS desde este script sin levantar todo `apps/api`).
    const sql = `
      WITH ins AS (
        INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
        VALUES ${valores.join(',\n')}
        ON CONFLICT (event_id, ts) DO NOTHING
        RETURNING sesion_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId"
      ),
      agregados AS (
        SELECT
          sesion_id,
          ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
          "sindicatoId",
          count(*)::int AS total_puntos,
          max(ts) AS ultimo_fix_ts,
          max(received_at) AS ultimo_ingreso_ts
        FROM ins
        GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
      ),
      ultimo_punto AS (
        SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
          sesion_id,
          ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
          "sindicatoId",
          lat, lng, accuracy, speed
        FROM ins
        ORDER BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId", ts DESC
      )
      INSERT INTO gps_sesion_resumen
        (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
      SELECT
        a.sesion_id, a.jornada, a."sindicatoId", a.total_puntos, a.ultimo_fix_ts, a.ultimo_ingreso_ts,
        u.lat, u.lng, u.accuracy, u.speed, now()
      FROM agregados a
      JOIN ultimo_punto u ON u.sesion_id = a.sesion_id AND u.jornada = a.jornada AND u."sindicatoId" = a."sindicatoId"
      ORDER BY a.sesion_id, a.jornada, a."sindicatoId"
      ON CONFLICT (sesion_id, jornada, "sindicatoId") DO UPDATE SET
        total_puntos = gps_sesion_resumen.total_puntos + EXCLUDED.total_puntos,
        ultimo_ingreso_ts = GREATEST(gps_sesion_resumen.ultimo_ingreso_ts, EXCLUDED.ultimo_ingreso_ts),
        lat = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.lat ELSE gps_sesion_resumen.lat END,
        lng = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.lng ELSE gps_sesion_resumen.lng END,
        accuracy = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.accuracy ELSE gps_sesion_resumen.accuracy END,
        speed = CASE WHEN EXCLUDED.ultimo_fix_ts > gps_sesion_resumen.ultimo_fix_ts THEN EXCLUDED.speed ELSE gps_sesion_resumen.speed END,
        ultimo_fix_ts = GREATEST(gps_sesion_resumen.ultimo_fix_ts, EXCLUDED.ultimo_fix_ts),
        updated_at = now()
    `;
    await client.query(sql, params);
    await client.query('COMMIT');
    return { ok: true, latenciaMs: performance.now() - t0, filas: filas.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, latenciaMs: performance.now() - t0, filas: filas.length, error: String(err.message ?? err) };
  } finally {
    client.release();
  }
}

// --- Cola en memoria (simula el productor: SyncQueueService.encolarLote) + N trabajadores
// (simula BullMQ Worker con `concurrency: CONCURRENCIA`, default 1 = fiel a producción). ---
// Cola en memoria con lista de "waiters" (uno por trabajador ocioso) — con un único
// callback compartido, `encolar` solo despertaba a UN trabajador sin importar cuántos
// estuvieran esperando, así que `--concurrencia > 1` no generaba concurrencia real. Cada
// trabajador ocioso registra su propio resolver; `encolar` despierta exactamente uno (el
// próximo en la fila), como un `notify()` de una cola de tareas real.
const cola = [];
const waiters = [];
function encolar(job) {
  cola.push(job);
  const w = waiters.shift();
  if (w) w();
}
function esperarJob() {
  if (cola.length > 0) return Promise.resolve(cola.shift());
  return new Promise((resolve) => {
    waiters.push(() => resolve(cola.shift()));
  });
}
function despertarTodosLosWaiters() {
  while (waiters.length > 0) {
    const w = waiters.shift();
    w();
  }
}

const metricas = {
  enviados: 0,
  confirmados: 0,
  fallidos: 0,
  filasEnviadas: 0,
  filasConfirmadas: 0,
  filasOfrecidas: 0, // generadas por los productores durante la ventana medida, hayan o no sido drenadas
  latenciasMs: [],
  backlogMuestras: [],
  errores: [],
};

let corriendo = true;
let midiendo = false; // false durante el calentamiento

async function trabajador(id) {
  while (corriendo) {
    try {
      const job = await esperarJob();
      if (!job) continue;
      const r = await insertarLote(job.sindicatoId, job.filas);
      if (midiendo) {
        metricas.enviados += 1;
        metricas.filasEnviadas += job.filas.length;
        if (r.ok) {
          metricas.confirmados += 1;
          metricas.filasConfirmadas += job.filas.length;
          metricas.latenciasMs.push(r.latenciaMs);
        } else {
          metricas.fallidos += 1;
          metricas.errores.push(r.error);
        }
      }
    } catch (err) {
      // Defensa en profundidad: `insertarLote` ya atrapa todo lo esperable (conexión e
      // INSERT) y nunca debería llegar a lanzar acá, pero un trabajador que muere por un
      // error inesperado no debe tumbar el proceso completo (bajaría la concurrencia real
      // sin que se note en las métricas) — se cuenta como fallido y el bucle sigue.
      if (midiendo) {
        metricas.fallidos += 1;
        metricas.errores.push(`trabajador ${id}: ${String(err.message ?? err)}`);
      }
    }
  }
}

// Productor: por cada trufi, cada SYNC_SEGUNDOS, encola UN lote con las filas producidas
// desde el último sync (tamaño = SYNC_SEGUNDOS a 1pt/s, ver cabecera). UN solo setInterval
// por trufi, armado después del offset inicial — la versión anterior armaba un
// `setInterval` nuevo DENTRO de cada disparo del propio interval, duplicando la carga en
// cada tick (1, 2, 4, 8, 16...). El offset inicial se resuelve con un `setTimeout` que solo
// dispara el primer tick y agenda el único `setInterval`; nunca vuelve a agendar otro.
function arrancarProductores() {
  const timers = [];
  for (const t of trufis) {
    const emitir = () => {
      const filas = [];
      for (let s = 0; s < SYNC_SEGUNDOS; s++) {
        filas.push(filaGpsPoint(estado.sindicatoId, t.sesionId, t.deviceId, Date.now() - (SYNC_SEGUNDOS - s) * 1000, t.lat, t.lng));
      }
      encolar({ sindicatoId: estado.sindicatoId, filas });
      if (midiendo) metricas.filasOfrecidas += filas.length;
    };
    const idInicial = setTimeout(() => {
      emitir();
      timers.push(setInterval(emitir, SYNC_SEGUNDOS * 1000));
    }, t.offsetMs);
    timers.push(idInicial);
  }
  return timers;
}

function percentil(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

// Chequeo barato que falla FUERTE si `gps_sesion_resumen` no existe — hallazgo 5 de revisión:
// sin esta tabla, el INSERT de arriba (que ahora escribe también a `gps_sesion_resumen`)
// rompería EN CADA lote con "relation does not exist", pero recién dentro de `insertarLote`
// (donde el error se traga como "lote fallido") — mejor abortar de entrada con un mensaje
// claro que apunte a la migración que falta, no reportar un throughput de 0% engañoso.
async function verificarGpsSesionResumen() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT to_regclass('public.gps_sesion_resumen') AS existe`);
    if (!rows[0]?.existe) {
      throw new Error(
        "gps_sesion_resumen no existe en esta base. Este harness replica el INSERT real de " +
          'insertarGpsPoints (apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts), que ' +
          'desde PR #74 escribe también a gps_sesion_resumen. Corré las migraciones reales de ' +
          'packages/db (prisma migrate deploy) contra esta base antes de generar carga.',
      );
    }
  } finally {
    client.release();
  }
}

async function main() {
  logObjetivo('generador.mjs');
  await verificarGpsSesionResumen();
  console.error(
    `Generador: objetivo=${OBJETIVO_PTS_SEG} pts/s, sync=${SYNC_SEGUNDOS}s, trufis=${M}, ` +
      `concurrencia=${CONCURRENCIA}, calentamiento=${CALENTAMIENTO_SEGUNDOS}s, medicion=${DURACION_SEGUNDOS}s`,
  );

  // `.catch` en cada promesa: si `trabajador` igual llegara a rechazar (no debería, ver su
  // propio try/catch), que quede registrado en vez de un unhandled rejection que mata el
  // proceso Node completo a mitad de la corrida.
  const trabajadores = Array.from({ length: CONCURRENCIA }, (_, i) =>
    trabajador(i).catch((err) => {
      metricas.errores.push(`trabajador ${i} rechazado: ${String(err.message ?? err)}`);
    }),
  );
  const timers = arrancarProductores();

  const muestreoBacklog = setInterval(() => {
    metricas.backlogMuestras.push(cola.length);
  }, 2000);

  await new Promise((r) => setTimeout(r, CALENTAMIENTO_SEGUNDOS * 1000));
  console.error('Fin de calentamiento, empieza medición.');
  midiendo = true;
  const inicioMedicion = Date.now();

  await new Promise((r) => setTimeout(r, DURACION_SEGUNDOS * 1000));
  // `finMedicion` se captura ACÁ, antes de apagar nada — el denominador del throughput no
  // puede incluir el drenado posterior (hasta 5s de cola pendiente), que inflaría filas
  // confirmadas fuera de la ventana pero las contaría sobre una duración más corta si se
  // midiera después. Con `finMedicion` fijo, cualquier fila que confirme durante el drenado
  // queda excluida de `filasConfirmadas` en los hechos porque ya no se pushea nada nuevo a
  // `metricas.*` una vez `midiendo = false` (ver `trabajador`).
  const finMedicion = Date.now();
  midiendo = false;
  // Paso 1: frenar SOLO a los productores (nadie encola nada nuevo). Los trabajadores
  // siguen corriendo (`corriendo` sigue true) para poder drenar lo que ya está en `cola` —
  // apagarlos ACÁ (como hacía la versión anterior) abandonaba ese backlog sin procesar:
  // cada trabajador ocioso despertado tomaba como máximo UN job más y el resto de la cola
  // quedaba sin contar en ningún lado (ni perdida ni confirmada). Eso hacía que
  // `filasPerdidas` diera 0 aunque hubiera backlog real sin drenar.
  clearInterval(muestreoBacklog);
  timers.forEach((t) => clearTimeout(t) || clearInterval(t));
  const filasEnBacklogAlCierre = cola.reduce((acc, job) => acc + job.filas.length, 0);
  const backlogAlCierre = cola.length;

  // Paso 2: drenar con deadline explícito — deja que los trabajadores vacíen `cola`, pero
  // sin esperar para siempre. Nada de esto suma a `metricas.*` (midiendo ya es false), así
  // que no contamina el throughput/latencia medidos; es solo para saber cuánto de ese
  // backlog el sistema real terminaría absorbiendo vs cuánto quedaría siempre atrás.
  // ≤ 2 intervalos de sync (hallazgo 6 de revisión, 2026-09-22) — con sync=60s eso son 120s,
  // más que el piso anterior de 15s fijos (insuficiente para drenar 2 lotes reales cuando el
  // sync es largo). Con sync=15s da 30s, también más laxo que antes: un backlog que drena en
  // 20s ya no se cuenta como "no sostenido" solo porque el piso viejo era más corto que un
  // intervalo de sync.
  const DEADLINE_DRENADO_MS = 2 * SYNC_SEGUNDOS * 1000;
  const inicioDrenado = Date.now();
  while (cola.length > 0 && Date.now() - inicioDrenado < DEADLINE_DRENADO_MS) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const backlogAbandonado = cola.length;
  const filasAbandonadas = cola.reduce((acc, job) => acc + job.filas.length, 0);

  // Paso 3: recién ahora se apagan los trabajadores.
  corriendo = false;
  despertarTodosLosWaiters(); // trabajadores ociosos bloqueados en esperarJob() deben poder salir del while
  await Promise.race([Promise.all(trabajadores), new Promise((r) => setTimeout(r, 2000))]);

  // Hallazgo 6 de revisión (2026-09-22): `backlogAlCierre === 0` es UNA sola muestra
  // instantánea de la cola (el instante exacto en que se apagan los productores) — un perfil
  // puede estar justo entre dos lotes en ese instante y dar backlogAlCierre=0 aunque la tasa
  // NO se sostenga (o, al revés, tener un backlog transitorio chico que drena solo en el
  // primer segundo del drenado y SÍ se sostiene). El veredicto real es el RESULTADO del
  // drenado con deadline acotado (`backlogAbandonado`, ya medido arriba) — si todo lo que
  // quedó en cola al cierre logra drenar dentro de `DEADLINE_DRENADO_MS`, el perfil sostuvo
  // la tasa; si no, no. `DEADLINE_DRENADO_MS` es explícitamente ≤ 2 intervalos de sync (el
  // tiempo que tardarían en encolarse 2 lotes más) — más que eso y ya no es "drenar lo que
  // quedó pendiente", es "la tasa de llegada supera la de servicio". El p95 de latencia de
  // lote es un criterio SEPARADO (ver `correr-punto.mjs`, `p95LoteAlto`), no se mezcla acá.
  const sostenido = backlogAbandonado === 0;
  if (backlogAlCierre > 0) {
    console.error(
      `INFO: backlog al cierre de la ventana medida (instantáneo, antes de drenar) = ` +
        `${backlogAlCierre} lote(s) (${filasEnBacklogAlCierre} filas) — se intenta drenar a ` +
        `continuación con deadline de ${DEADLINE_DRENADO_MS / 1000}s.`,
    );
  }
  if (!sostenido) {
    console.error(
      `AUTOCONTROL: ${backlogAbandonado} lote(s) (${filasAbandonadas} filas) sin drenar tras ` +
        `${DEADLINE_DRENADO_MS / 1000}s de drenado (≤2 intervalos de sync) — el perfil NO sostiene ` +
        `esta tasa (backlog no drena en tiempo acotado).`,
    );
  }

  const duracionRealS = (finMedicion - inicioMedicion) / 1000;
  const throughputLogrado = metricas.filasConfirmadas / duracionRealS;
  const tasaOfrecidaPtsSeg = metricas.filasOfrecidas / duracionRealS;
  const desviacionOfrecidaPct = Math.abs(tasaOfrecidaPtsSeg - OBJETIVO_PTS_SEG) / OBJETIVO_PTS_SEG * 100;
  const corridaValida = desviacionOfrecidaPct <= 5;
  if (!corridaValida) {
    console.error(
      `AUTOCONTROL: tasa OFRECIDA (${tasaOfrecidaPtsSeg.toFixed(1)} pts/s) difiere ` +
        `${desviacionOfrecidaPct.toFixed(1)}% del objetivo (${OBJETIVO_PTS_SEG} pts/s) — ` +
        `esta corrida NO refleja el objetivo pedido, marcarla como inválida en resumen.md.`,
    );
  }

  const resultado = {
    objetivoPtsSeg: OBJETIVO_PTS_SEG,
    syncSegundos: SYNC_SEGUNDOS,
    concurrencia: CONCURRENCIA,
    trufis: M,
    duracionMedicionS: duracionRealS,
    tasaOfrecidaPtsSeg,
    desviacionOfrecidaPct,
    corridaValida,
    sostenido,
    backlogAlCierre,
    filasEnBacklogAlCierre,
    backlogAbandonadoTrasDrenado: backlogAbandonado,
    filasAbandonadasTrasDrenado: filasAbandonadas,
    lotesEnviados: metricas.enviados,
    lotesConfirmados: metricas.confirmados,
    lotesFallidos: metricas.fallidos,
    filasEnviadas: metricas.filasEnviadas,
    filasConfirmadas: metricas.filasConfirmadas,
    filasPerdidas: metricas.filasEnviadas - metricas.filasConfirmadas,
    throughputLogradoPtsSeg: throughputLogrado,
    throughputVsObjetivoPct: (throughputLogrado / OBJETIVO_PTS_SEG) * 100,
    latenciaLoteMs: {
      p50: percentil(metricas.latenciasMs, 50),
      p95: percentil(metricas.latenciasMs, 95),
      p99: percentil(metricas.latenciasMs, 99),
      max: metricas.latenciasMs.length ? Math.max(...metricas.latenciasMs) : null,
    },
    backlogMaximo: Math.max(0, ...metricas.backlogMuestras),
    backlogPromedio:
      metricas.backlogMuestras.length > 0
        ? metricas.backlogMuestras.reduce((a, b) => a + b, 0) / metricas.backlogMuestras.length
        : 0,
    erroresMuestra: metricas.errores.slice(0, 5),
  };

  writeFileSync(SALIDA, JSON.stringify(resultado, null, 2));
  console.error(JSON.stringify(resultado, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error('Generador falló:', err);
  process.exitCode = 1;
});
