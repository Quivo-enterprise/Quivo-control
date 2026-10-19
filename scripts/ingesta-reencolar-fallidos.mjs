#!/usr/bin/env node
// Resume los jobs fallidos de la cola `ingesta-sync` (los que agotaron el presupuesto de reintento
// del worker, ver `REINTENTO_PRESUPUESTO_MS`) agrupados por `failedReason` y, con
// `--reencolar --motivo <texto>`, reintenta solo los que lo contengan tras una confirmación y/N.
// El lote es idempotente, pero reprocesar uno viejo DESPUÉS de lotes más nuevos del mismo dispositivo
// no deshace las infracciones creadas mientras tanto (puede quedar un PC omitido falso): revisar las
// infracciones de esos dispositivos. REDIS_URL sale del entorno.
//   REDIS_URL=redis://... node scripts/ingesta-reencolar-fallidos.mjs [--reencolar --motivo <texto>]
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';

// bullmq/ioredis son dependencias de apps/api, no del paquete raíz.
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Queue, Job } = require('bullmq');
const { Redis } = require('ioredis');

const url = process.env.REDIS_URL;
if (!url) {
  console.error('Falta REDIS_URL en el entorno.');
  process.exit(1);
}
const args = process.argv.slice(2);
const reencolar = args.includes('--reencolar');
const iMotivo = args.indexOf('--motivo');
const motivo = iMotivo >= 0 ? args[iMotivo + 1] : undefined;
if (reencolar && !motivo) {
  console.error('--reencolar exige --motivo <texto> (substring del failedReason).');
  process.exit(1);
}

const connection = new Redis(url, { maxRetriesPerRequest: null });
// El nombre debe coincidir con COLA_INGESTA_SYNC (apps/api/src/modules/sync/sync-queue.service.ts).
const queue = new Queue('ingesta-sync', { connection });
let codigo = 0;
try {
  const total = await queue.getFailedCount();
  if (total === 0) {
    console.log('Sin jobs fallidos en ingesta-sync.');
  } else {
    // Solo ids + campos `failedReason`/`timestamp` del hash: sin cargar los payloads de los lotes.
    const ids = await queue.getRanges(['failed'], 0, -1, true);
    const pipeline = connection.pipeline();
    for (const id of ids) pipeline.hmget(queue.toKey(id), 'failedReason', 'timestamp');
    const filas = [];
    let conError = 0;
    (await pipeline.exec()).forEach(([err, res], i) => {
      if (err || !res) return void conError++; // comando fallido: sin datos del job
      filas.push({ id: ids[i], razon: res[0] ?? '(sin motivo)', ts: Number(res[1]) });
    });
    if (conError > 0) console.warn(`${conError} job(s) omitidos: error al leer su hash.`);
    const porMotivo = new Map();
    for (const { razon } of filas) porMotivo.set(razon, (porMotivo.get(razon) ?? 0) + 1);
    const tiempos = filas.map((f) => f.ts).filter(Number.isFinite).sort((a, b) => a - b);
    console.log(
      `${total} job(s) fallido(s). Más antiguo: ${new Date(tiempos[0]).toISOString()}; ` +
        `más nuevo: ${new Date(tiempos.at(-1)).toISOString()}.`,
    );
    for (const [razon, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${razon}`);

    if (reencolar) {
      const elegidos = filas.filter((f) => f.razon.includes(motivo));
      if (elegidos.length === 0) {
        console.log(`Ningún job fallido con motivo que contenga "${motivo}".`);
      } else {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const resp = (
          await rl.question(`¿Reencolar los ${elegidos.length} job(s) con motivo "${motivo}"? [y/N] `)
        )
          .trim()
          .toLowerCase();
        rl.close();
        if (resp === 'y') {
          let hechos = 0;
          const fallidos = [];
          for (const { id } of elegidos) {
            try {
              const job = await Job.fromId(queue, id);
              if (!job) continue; // expiró entre el resumen y ahora
              await job.retry('failed');
              hechos++;
            } catch (error) {
              fallidos.push(id);
              console.error(`Job ${id}: no se pudo reencolar: ${error?.message ?? error}`);
            }
          }
          console.log(`Reencolados ${hechos}; fallaron ${fallidos.length}.`);
          if (fallidos.length > 0) {
            console.error(`Ids que fallaron: ${fallidos.join(', ')}`);
            codigo = 1;
          }
        } else {
          console.log('Cancelado.');
        }
      }
    }
  }
} catch (error) {
  console.error(error);
  codigo = 1;
} finally {
  await queue.close();
  connection.disconnect();
}
process.exit(codigo);
