#!/usr/bin/env node
// Lista los jobs fallidos de la cola `ingesta-sync` (los que agotaron el presupuesto de reintento
// del worker, ver `REINTENTO_PRESUPUESTO_MS`) y, con `--reencolar`, los reintenta todos tras una
// confirmación y/N. Reencolar es seguro: el lote es idempotente. REDIS_URL sale del entorno.
//   REDIS_URL=redis://... node scripts/ingesta-reencolar-fallidos.mjs [--reencolar]
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';

// bullmq/ioredis son dependencias de apps/api, no del paquete raíz.
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Queue } = require('bullmq');
const { Redis } = require('ioredis');

const url = process.env.REDIS_URL;
if (!url) {
  console.error('Falta REDIS_URL en el entorno.');
  process.exit(1);
}
const reencolar = process.argv.includes('--reencolar');

const connection = new Redis(url, { maxRetriesPerRequest: null });
const queue = new Queue('ingesta-sync', { connection });
let codigo = 0;
try {
  const fallidos = await queue.getJobs(['failed'], 0, -1, true);
  if (fallidos.length === 0) {
    console.log('Sin jobs fallidos en ingesta-sync.');
  } else {
    const ts = fallidos.map((j) => j.timestamp).sort((a, b) => a - b);
    console.log(
      `${fallidos.length} job(s) fallido(s). Más antiguo: ${new Date(ts[0]).toISOString()}; ` +
        `más nuevo: ${new Date(ts.at(-1)).toISOString()}.`,
    );
    if (reencolar) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const resp = (await rl.question(`¿Reencolar los ${fallidos.length} job(s)? [y/N] `)).trim().toLowerCase();
      rl.close();
      if (resp === 'y') {
        await queue.retryJobs({ state: 'failed' });
        console.log('Reencolados.');
      } else {
        console.log('Cancelado.');
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
