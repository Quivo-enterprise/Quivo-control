#!/usr/bin/env node
// Precarga de volumen histórico en gps_points (paso B, "para que índices no estén vacíos").
//
// DECLARADO: esto NO reproduce el INSERT exacto del worker (esa fidelidad es de
// generador.mjs, lo que se mide). Acá se usa el rol admin (bypassa RLS localmente) e INSERTs
// multi-fila grandes por velocidad — el objetivo es volumen realista en las particiones/
// índices ANTES de medir, no otra medición. Por eso `gps_points` se llena por un camino
// rápido pero `gps_sesion_resumen` (que el INSERT real SÍ mantiene, ver generador.mjs) NO se
// llena en el mismo paso — hallazgo 9 de revisión (2026-09-22): al final de `main()` se corre
// un recompute completo (`recomputarGpsSesionResumen`, misma query que
// docs/runbooks/retencion-gps.md) para que las lecturas midan el camino real.
//
// Modo remoto (docs/plan-experimento-puntos-gps.md §10): contra Cloud SQL, la latencia de
// red Bolivia->Santiago hace prohibitivo el camino de arriba (un round-trip por lote de
// 5.000 filas armadas en JS: para 6,72M filas serían ~1.344 round-trips). Con
// QUIVO_CARGA_DATABASE_URL seteada (ES_REMOTO=true, ver lib/pg.mjs) este script cambia a
// `precargarServerSide`: UN solo `INSERT ... SELECT ... FROM unnest(...) CROSS JOIN
// generate_series(...)` por (día × lote de sesiones) — Postgres genera y escribe las filas
// enteramente server-side, el cliente solo manda la query y espera. Con
// QUIVO_CARGA_PRECARGA_LOTE_SESIONES=100 (default) y 500 sesiones, son 7 días × 5 lotes =
// 35 round-trips en vez de miles, cada uno insertando hasta 100 × 1.920 = 192.000 filas en
// una sola sentencia. Mismo volumen final, mismas columnas — DECLARADO que la
// aleatoriedad de lat/lng/accuracy/speed la calcula `random()` de Postgres en vez de
// `Math.random()` de Node (misma distribución uniforme aproximada, no importa para volumen).
//
// Uso: node precargar.mjs <numSesiones> <dias> <ptsPorSesionPorDia>
import { adminClient, ES_REMOTO, logObjetivo } from './lib/pg.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const NUM_SESIONES = Number(process.argv[2] ?? 500);
const DIAS = Number(process.argv[3] ?? 7);
const PUNTOS_POR_SESION_POR_DIA = Number(process.argv[4] ?? 1920); // ~1pt/15s x 8h operativas
const ESTADO_PATH = process.env.QUIVO_CARGA_ESTADO ?? new URL('./seed-estado.json', import.meta.url).pathname;
const LOTE_FILAS = 5000;
const LOTE_SESIONES_SERVER_SIDE = Number(process.env.QUIVO_CARGA_PRECARGA_LOTE_SESIONES ?? 100);

async function main() {
  logObjetivo('precargar.mjs');
  const estado = JSON.parse(readFileSync(ESTADO_PATH, 'utf8'));
  const sesiones = estado.sesiones.slice(0, Math.min(NUM_SESIONES, estado.sesiones.length));
  console.error(
    `Precarga (${ES_REMOTO ? 'server-side, remoto' : 'cliente, local'}): ${sesiones.length} sesiones x ${DIAS} días x ` +
      `${PUNTOS_POR_SESION_POR_DIA} pts/sesión/día = ${(sesiones.length * DIAS * PUNTOS_POR_SESION_POR_DIA).toLocaleString('es')} filas totales`,
  );

  const client = adminClient();
  await client.connect();

  // Hallazgo 9 de revisión (2026-09-22): en REMOTO (Cloud SQL) el rol admin NO tiene
  // BYPASSRLS y `gps_points`/`gps_sesion_resumen` tienen FORCE ROW LEVEL SECURITY — sin esto,
  // los INSERT de abajo fallarían contra RLS real. `false` (no `SET LOCAL`): este script hace
  // MUCHAS transacciones implícitas sueltas (cada `client.query` fuera de un BEGIN explícito
  // es su propia transacción), así que un `true` local se perdería entre queries. Sin costo
  // en local (BYPASSRLS ignora `app.rol`).
  await client.query(`SELECT set_config('app.rol', 'admin_quivo', false)`);

  // `client.end()` DEBE correr aunque algo de acá abajo falle (creación de partición, INSERT
  // masivo, etc.) — antes solo se llamaba al final del camino feliz. Si algo entre `connect()`
  // y ese punto lanzaba, `main()` propagaba al `.catch` de más abajo, que solo marca
  // `process.exitCode = 1` y nunca cierra el socket: el proceso Node queda vivo indefinidamente
  // (el event loop no tiene nada más pendiente salvo la conexión TCP abierta), colgado en vez
  // de salir con el código de error ya seteado.
  try {
    // Asegurar particiones para el rango [-DIAS, 0] (la migración ya crea hoy..+7).
    for (let d = DIAS; d >= 1; d--) {
      await client.query(`SELECT crear_particion_gps_points((CURRENT_DATE - $1::int)::date)`, [d]);
    }
    console.error('Particiones históricas asegurradas.');

    const t0 = Date.now();
    const filasInsertadas = ES_REMOTO
      ? await precargarServerSide(client, estado.sindicatoId, sesiones, DIAS, PUNTOS_POR_SESION_POR_DIA)
      : await precargarCliente(client, estado.sindicatoId, sesiones, DIAS, PUNTOS_POR_SESION_POR_DIA);

    const seg = (Date.now() - t0) / 1000;
    console.error(`Precarga completa: ${filasInsertadas.toLocaleString('es')} filas en ${seg.toFixed(0)}s (${(filasInsertadas / seg).toFixed(0)} filas/s)`);

    // Hallazgo 9 de revisión: `precargarCliente`/`precargarServerSide` solo insertan en
    // `gps_points` (no pasan por el CTE de `insertarGpsPoints`, ver comentario del archivo) —
    // sin esto, `gps_sesion_resumen` queda vacía después de la precarga y las lecturas
    // (`listarHoy`/`obtenerPosiciones`, que desde PR #74 leen SOLO `gps_sesion_resumen`) no
    // encontrarían nada para las sesiones precargadas, midiendo un camino que no es el real.
    await recomputarGpsSesionResumen(client, DIAS);
  } finally {
    await client.end();
  }
}

/**
 * Recompute de `gps_sesion_resumen` desde `gps_points` — misma query (mismo
 * `ON CONFLICT ... DO UPDATE SET columna = EXCLUDED.columna`, no `GREATEST`/suma) que
 * `docs/runbooks/retencion-gps.md` ("gps_sesion_resumen — recompute obligatorio"), pero
 * generalizada a `dias` en vez de fija a `CURRENT_DATE`/`CURRENT_DATE - 1`: la precarga
 * escribe hasta `DIAS` días de historia (no solo hoy/ayer), así que el recompute tiene que
 * cubrir la misma ventana o las sesiones más viejas quedarían con resumen vacío. Idempotente
 * (recalcula desde `gps_points`, no depende de qué había antes) — correrlo más de una vez es
 * seguro.
 */
async function recomputarGpsSesionResumen(client, dias) {
  const t0 = Date.now();
  const r = await client.query(
    `WITH agregados AS (
       SELECT
         sesion_id,
         ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
         "sindicatoId",
         count(*)::int AS total_puntos,
         max(ts) AS ultimo_fix_ts,
         max(received_at) AS ultimo_ingreso_ts
       FROM gps_points
       WHERE ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date >= CURRENT_DATE - $1::int
       GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
     ),
     ultimo_punto AS (
       SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
         sesion_id,
         ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
         "sindicatoId",
         lat, lng, accuracy, speed
       FROM gps_points
       WHERE ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date >= CURRENT_DATE - $1::int
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
       total_puntos = EXCLUDED.total_puntos,
       ultimo_fix_ts = EXCLUDED.ultimo_fix_ts,
       ultimo_ingreso_ts = EXCLUDED.ultimo_ingreso_ts,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       accuracy = EXCLUDED.accuracy,
       speed = EXCLUDED.speed,
       updated_at = now()`,
    [dias],
  );
  console.error(
    `gps_sesion_resumen recomputada: ${r.rowCount ?? 0} filas en ${((Date.now() - t0) / 1000).toFixed(0)}s.`,
  );
}

/** Camino original (local, Docker): arma cada fila en JS y la manda en lotes de
 * LOTE_FILAS por round-trip. Sin cambios de comportamiento respecto de la versión previa. */
async function precargarCliente(client, sindicatoId, sesiones, dias, puntosPorSesionPorDia) {
  let filasInsertadas = 0;
  const t0 = Date.now();
  for (let d = dias; d >= 1; d--) {
    for (const s of sesiones) {
      // Distribuye los puntos del día en una ventana operativa de 8h (08:00-16:00 UTC-4,
      // aproximación razonable de jornada — no depende de la jornada Bolivia exacta para
      // este propósito de volumen).
      const inicioDiaMs = Date.now() - d * 24 * 60 * 60 * 1000;
      const pasoMs = (8 * 60 * 60 * 1000) / puntosPorSesionPorDia;
      let filas = [];
      for (let i = 0; i < puntosPorSesionPorDia; i++) {
        const ts = new Date(inicioDiaMs + i * pasoMs);
        filas.push({
          eventId: randomUUID(),
          sesionId: s.sesionId,
          deviceId: s.deviceId,
          ts: ts.toISOString(),
          lat: -17.4 + Math.random() * 0.05,
          lng: -66.2 + Math.random() * 0.1,
          accuracy: 5 + Math.random() * 10,
          speed: 3 + Math.random() * 8,
        });
        if (filas.length >= LOTE_FILAS) {
          await insertarLoteAdmin(client, sindicatoId, filas);
          filasInsertadas += filas.length;
          filas = [];
        }
      }
      if (filas.length > 0) {
        await insertarLoteAdmin(client, sindicatoId, filas);
        filasInsertadas += filas.length;
      }
    }
    console.error(`  día -${d}: acumulado ${filasInsertadas.toLocaleString('es')} filas (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  return filasInsertadas;
}

/** Camino remoto: un INSERT ... SELECT server-side por (día × lote de sesiones). `i.n`
 * (generate_series) da el índice del punto dentro del día; el `ts` de cada punto se calcula
 * en SQL como inicioDia + n * pasoSegundos, igual fórmula que precargarCliente pero sin
 * mandar cada fila por la red. `ON CONFLICT DO NOTHING` idéntico al INSERT real. */
async function precargarServerSide(client, sindicatoId, sesiones, dias, puntosPorSesionPorDia) {
  const pasoSegundos = (8 * 60 * 60) / puntosPorSesionPorDia;
  let filasInsertadas = 0;
  const t0 = Date.now();
  for (let d = dias; d >= 1; d--) {
    const inicioDia = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    for (let i = 0; i < sesiones.length; i += LOTE_SESIONES_SERVER_SIDE) {
      const lote = sesiones.slice(i, i + LOTE_SESIONES_SERVER_SIDE);
      const sesionIds = lote.map((s) => s.sesionId);
      const deviceIds = lote.map((s) => s.deviceId);
      const r = await client.query(
        `INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
         SELECT
           gen_random_uuid(),
           s.sesion_id::uuid,
           s.device_id,
           $1::timestamptz + (i.n * $2::double precision * interval '1 second'),
           -17.4 + random() * 0.05,
           -66.2 + random() * 0.1,
           5 + random() * 10,
           3 + random() * 8,
           now(),
           $3::uuid
         FROM unnest($4::uuid[], $5::text[]) AS s(sesion_id, device_id)
         CROSS JOIN generate_series(0, $6::int - 1) AS i(n)
         ON CONFLICT (event_id, ts) DO NOTHING`,
        [inicioDia.toISOString(), pasoSegundos, sindicatoId, sesionIds, deviceIds, puntosPorSesionPorDia],
      );
      filasInsertadas += r.rowCount ?? 0;
    }
    console.error(`  día -${d}: acumulado ${filasInsertadas.toLocaleString('es')} filas (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  return filasInsertadas;
}

async function insertarLoteAdmin(client, sindicatoId, filas) {
  const valores = [];
  const params = [];
  filas.forEach((f, i) => {
    const base = i * 8;
    valores.push(
      `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}, $${base + 4}::timestamptz, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, now(), $${filas.length * 8 + 1})`,
    );
    params.push(f.eventId, f.sesionId, f.deviceId, f.ts, f.lat, f.lng, f.accuracy, f.speed);
  });
  params.push(sindicatoId);
  await client.query(
    `INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
     VALUES ${valores.join(',')}
     ON CONFLICT (event_id, ts) DO NOTHING`,
    params,
  );
}

main().catch((err) => {
  console.error('Precarga falló:', err);
  process.exitCode = 1;
});
