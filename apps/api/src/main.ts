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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Error fatal al iniciar la API', error);
  process.exitCode = 1;
});
