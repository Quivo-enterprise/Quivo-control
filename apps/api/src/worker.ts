import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' });
}

/**
 * Entrypoint del worker de ingesta (QUI-241) — proceso separado del servidor HTTP
 * (`main.ts`). Sin servidor Fastify: un contexto de aplicación de Nest alcanza, el trabajo
 * real pasa en `IngestaWorkerService` (`OnModuleInit`), que registra sus propios `Worker`
 * de BullMQ y queda escuchando la cola indefinidamente — el proceso no necesita nada más
 * para seguir vivo.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  // QUI-354: mismo motivo que apps/api/src/main.ts — sin esto, el SIGTERM que Cloud Run
  // manda al desplegar o escalar a cero mata este proceso sin correr `onModuleDestroy()`
  // de IngestaWorkerService ni RetencionGpsService (ambos solo viven en este proceso
  // worker, no en el de la API). `enableShutdownHooks()` existe también en
  // `INestApplicationContext` (no sólo en la app HTTP), así que aplica igual acá.
  app.enableShutdownHooks();

  console.log('Worker de ingesta QUIVO listo — escuchando la cola de sync.');
}

bootstrap().catch((error: unknown) => {
  console.error('Error fatal al iniciar el worker de ingesta', error);
  process.exitCode = 1;
});
