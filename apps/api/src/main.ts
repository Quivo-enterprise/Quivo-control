import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' });
}

async function bootstrap(): Promise<void> {
  // genReqId vive en el adapter Fastify (no en pinoHttp): Fastify asigna req.id antes
  // de que nestjs-pino lo vea, así que el request_id real se fija acá.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ genReqId: () => randomUUID() }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');

  // apps/web corre en otro origen (:3000 vs :3001 de esta API) — sin esto, el browser
  // bloquea el preflight (OPTIONS) de POST /v1/auth/login con 404 antes de que Nest
  // llegue a manejar la request real (curl no lo sufre: CORS es una restricción del
  // browser, no del server, por eso funcionaba probando con curl).
  //
  // `methods` explícito: sin esto, el default de @fastify/cors solo deja pasar
  // GET/HEAD/POST en `Access-Control-Allow-Methods` — cualquier PATCH (QUI-220 en
  // adelante, todos los endpoints de edición) queda bloqueado en el browser con
  // "Failed to fetch" aunque el preflight responda 204 y curl (que no aplica CORS)
  // funcione perfecto. Encontrado probando QUI-228 (apps/web) contra la API real.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Error fatal al iniciar la API', error);
  process.exitCode = 1;
});
