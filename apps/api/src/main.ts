import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
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
  //
  // trustProxy: Cloud Run termina TLS y hace proxy de cada request hacia el contenedor —
  // sin esto, Fastify resuelve `req.ip` a la IP interna del load balancer para TODAS las
  // requests (mismo IP para todo el mundo). El ThrottlerGuard global (ver app.module.ts,
  // QUI-251) usa `req.ip` como key de rate limit: sin trustProxy, todos los usuarios reales
  // Y las probes de Cloud Run comparten un único presupuesto de 100 req/min. Con
  // trustProxy, Fastify confía en `X-Forwarded-For` (que Cloud Run sí setea con la IP real
  // del cliente) y `req.ip` vuelve a ser por-cliente.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ genReqId: () => randomUUID(), trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');

  // QUI-354: sin esto, Nest no engancha los listeners de señales del proceso — el SIGTERM
  // que Cloud Run manda al desplegar o escalar a cero mata el proceso directo, sin correr
  // ningún `onModuleDestroy()` (HealthService cierra su Pool/Redis, VencimientoProcessor y
  // SyncQueueService cierran su Worker/conexiones de BullMQ). Sin drenar eso, un rolling
  // deploy corta conexiones a mitad de request/job en vez de terminarlas prolijo.
  app.enableShutdownHooks();

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

  // QUI-240: la app móvil manda `POST /v1/sync/batches` gzip (hasta ~500 eventos por
  // request). Fastify no descomprime el body por defecto — este hook intercepta el stream
  // crudo antes del parseo de JSON y lo descomprime de forma transparente para cualquier
  // ruta futura que también reciba gzip, sin acoplar esta lógica al controller de sync.
  //
  // Header custom `X-Content-Encoding` en vez del estándar `Content-Encoding`: confirmado
  // en un dispositivo real (Moto E13) que React Native (vía OkHttp en Android) descarta el
  // header `Content-Encoding` antes de mandar la request — nunca le llegaba al servidor, y
  // Fastify trataba los bytes gzip crudos como si fueran JSON de texto plano.
  app.getHttpAdapter().getInstance().addHook('preParsing', (request, _reply, payload, done) => {
    if (request.headers['x-content-encoding'] === 'gzip') {
      // `content-length` describe el tamaño del body COMPRIMIDO — Fastify valida que los
      // bytes leídos coincidan con ese header, y una vez descomprimido acá el conteo real
      // ya no coincide (`FST_ERR_CTP_INVALID_CONTENT_LENGTH: Request body size did not
      // match Content-Length`, encontrado probando QUI-240/241 con un lote gzip real). Sin
      // el header, Fastify no valida por longitud y confía en el fin de stream.
      delete request.headers['content-length'];
      done(null, payload.pipe(createGunzip()));
      return;
    }
    done(null, payload);
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Error fatal al iniciar la API', error);
  process.exitCode = 1;
});
