#!/usr/bin/env node
// Puntos enviados vs ingeridos tras una corrida de conductores-reales.mjs.
// Lee `gps_points` por sesion_id (solo lectura) con lib/pg.mjs: contra el entorno efímero usa la
// IP pública de Cloud SQL (la misma del seed): `eval "$(scripts/carga-efimera.sh url-seed)"`;
// sin esa variable apunta al Postgres local (QUIVO_CARGA_PUERTO, default 55432).
// Espera a que cada sesión tenga ingeridos >= enviados, hasta el timeout (cola BullMQ vaciándose, p.ej. tras worker-reanuda).
//
// Uso: node verificar-ingesta.mjs --resultado resultados/real-30.json [--espera-segundos 300]
// Sale 1 si algún conductor tiene menos puntos ingeridos que enviados o puntos sin entregar (`pendientes`).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { adminClient, logObjetivo } from './lib/pg.mjs';

const { values: a } = parseArgs({
  options: { resultado: { type: 'string' }, 'espera-segundos': { type: 'string', default: '300' } },
});
if (!a.resultado) {
  console.error('Falta --resultado <json de conductores-reales.mjs --salida>');
  process.exit(1);
}
const detalle = JSON.parse(readFileSync(a.resultado, 'utf8')).conductoresDetalle;
if (!detalle?.length) {
  console.error('El resultado no trae conductoresDetalle (¿corrida sin --salida o sin logins?).');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

logObjetivo('verificar-ingesta.mjs');
const client = adminClient();
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  await client.query(`SELECT set_config('app.rol', 'admin_quivo', true)`);
  const contar = async () => {
    const { rows } = await client.query(
      `SELECT sesion_id::text AS id, count(*)::int AS n FROM gps_points WHERE sesion_id = ANY($1::uuid[]) GROUP BY 1`,
      [detalle.map((c) => c.sesionId)],
    );
    return new Map(rows.map((r) => [r.id, r.n]));
  };
  // Listo = cada sesión con ingeridos >= enviados, o se acabó la espera.
  const limite = Date.now() + Number(a['espera-segundos']) * 1000;
  const enviadosTotal = detalle.reduce((s, c) => s + c.enviados, 0);
  let conteo = await contar();
  for (;;) {
    const total = [...conteo.values()].reduce((s, n) => s + n, 0);
    const completo = detalle.every((c) => (conteo.get(c.sesionId) ?? 0) >= c.enviados);
    if (completo || Date.now() > limite) break;
    console.error(`ingeridos=${total}/${enviadosTotal}, esperando...`);
    await sleep(5_000);
    conteo = await contar();
  }
  console.log('placa'.padEnd(10), 'enviados'.padStart(9), 'ingeridos'.padStart(10), 'diferencia'.padStart(11), 'pendientes'.padStart(11));
  let perdidos = 0;
  let pendTotal = 0;
  let ingTotal = 0;
  for (const c of detalle) {
    const n = conteo.get(c.sesionId) ?? 0;
    ingTotal += n;
    perdidos += Math.max(0, c.enviados - n);
    pendTotal += c.pendientes ?? 0;
    console.log(c.placa.padEnd(10), String(c.enviados).padStart(9), String(n).padStart(10), String(n - c.enviados).padStart(11), String(c.pendientes ?? 0).padStart(11));
  }
  console.log(`TOTAL enviados=${enviadosTotal} ingeridos=${ingTotal} perdidos=${perdidos} pendientes=${pendTotal}`);
  console.log(perdidos + pendTotal === 0 ? 'PASS: 0 puntos perdidos' : `FAIL: ${perdidos} enviados no aparecen en gps_points y ${pendTotal} nunca se entregaron (pendientes)`);
  process.exitCode = perdidos + pendTotal === 0 ? 0 : 1;
} finally {
  await client.end();
}
