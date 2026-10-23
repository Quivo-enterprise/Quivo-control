import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpRedaction } from './common/logging/pino-http-redaction.js';
import { IngestaWorkerModule } from './modules/ingesta-worker/index.js';
import { RetencionGpsModule } from './modules/retencion-gps/index.js';

/**
 * Módulo del proceso worker (QUI-241) — deliberadamente separado de `AppModule`: no
 * necesita nada HTTP (Fastify, Throttler, interceptor de auditoría atado a requests), solo
 * el consumidor de la cola de ingesta. Corre en su propio proceso (`worker.ts`), no dentro
 * del proceso de la API — a diferencia de `VencimientoProcessor` (`RotacionesModule`), que sí
 * comparte proceso con la API porque es liviano (un `UPDATE` cada 5 min).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Mismo logger JSON que la API (`app.module.ts`); `worker.ts` lo activa con `useLogger`.
    LoggerModule.forRoot({
      pinoHttp: { redact: pinoHttpRedaction, formatters: { level: (label) => ({ level: label }) } },
    }),
    IngestaWorkerModule,
    RetencionGpsModule,
  ],
})
export class WorkerModule {}
