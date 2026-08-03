import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const requireFromApi = createRequire(join(process.cwd(), 'package.json'));
const { Client } = requireFromApi('pg');

const [summaryPath, queueStatsPath, startedAt] = process.argv.slice(2);
if (!summaryPath || !queueStatsPath || !startedAt) {
  throw new Error('Uso: verify-ingestion.mjs <summary.json> <queue.json> <inicio-iso>');
}
const sessionId = process.env.SESSION_ID;
const deviceId = process.env.DEVICE_ID;
if (!sessionId || !deviceId) throw new Error('SESSION_ID y DEVICE_ID son requeridos');

const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
const queueStats = JSON.parse(await readFile(queueStatsPath, 'utf8'));
const expected = Number(summary.metrics?.events_accepted?.values?.count || 0);
if (expected <= 0)
  throw new Error('k6 no reportó eventos aceptados; no se puede verificar ingesta');

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.RUNTIME_DATABASE_URL,
});
await client.connect();

const timeoutMs = Number(process.env.INGESTION_DRAIN_TIMEOUT_MS || 120000);
const deadline = Date.now() + timeoutMs;
let inserted = 0;
let syncErrors = 0;
try {
  do {
    const points = await client.query(
      `SELECT count(*)::int AS count
         FROM gps_points
        WHERE sesion_id = $1::uuid AND device_id = $2 AND received_at >= $3::timestamptz`,
      [sessionId, deviceId, startedAt],
    );
    const errors = await client.query(
      `SELECT count(*)::int AS count
         FROM sync_errors
        WHERE "sesionId" = $1 AND "deviceId" = $2 AND ts >= $3::timestamptz`,
      [sessionId, deviceId, startedAt],
    );
    inserted = points.rows[0].count;
    syncErrors = errors.rows[0].count;
    if (inserted >= expected || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (true);
} finally {
  await client.end();
}

const result = {
  expectedAcceptedEvents: expected,
  insertedGpsPoints: inserted,
  syncErrors,
  lostEvents: Math.max(0, expected - inserted),
  queue: queueStats,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (inserted !== expected || syncErrors > 0 || queueStats.maxFailed > 0) {
  process.exitCode = 1;
}
