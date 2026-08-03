import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const requireFromApi = createRequire(join(process.cwd(), 'package.json'));
const { Queue } = requireFromApi('bullmq');
const { Redis } = requireFromApi('ioredis');

const outputPath = process.argv[2];
if (!outputPath) throw new Error('Uso: monitor-queue.mjs <salida.json>');

const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6380', {
  maxRetriesPerRequest: null,
});
const queue = new Queue('ingesta-sync', { connection });
let stopping = false;
let samples = 0;
let maxBacklog = 0;
let maxWaiting = 0;
let maxActive = 0;
let maxFailed = 0;

process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});

try {
  while (!stopping) {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const backlog = counts.waiting + counts.active + counts.delayed;
    samples += 1;
    maxBacklog = Math.max(maxBacklog, backlog);
    maxWaiting = Math.max(maxWaiting, counts.waiting);
    maxActive = Math.max(maxActive, counts.active);
    maxFailed = Math.max(maxFailed, counts.failed);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
} finally {
  const finalCounts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  await writeFile(
    outputPath,
    `${JSON.stringify({ samples, maxBacklog, maxWaiting, maxActive, maxFailed, finalCounts }, null, 2)}\n`,
  );
  await queue.close();
  connection.disconnect();
}
