import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { RotacionesService } from './rotaciones.service.js';

const NOMBRE_COLA = 'vencimiento-asignaciones';
const NOMBRE_JOB_REPETIBLE = 'marcar-vencidas';
// Cada 5 minutos — RF-57 no fija una cadencia exacta, esta es una asunción razonable de
// este equipo (lo bastante frecuente para que "vencida" sea casi en tiempo real para la
// app móvil sin sobrecargar la DB con un `UPDATE` constante).
const CADA_MS = 5 * 60 * 1000;

/**
 * Job BullMQ repeatable que marca `vencida` toda asignación cuya `venceAt` ya pasó (RF-57,
 * QUI-234). `maxRetriesPerRequest: null` es requisito de BullMQ para conexiones usadas por
 * un `Worker` (bloquean en `BRPOPLPUSH`/`BLMOVE`) — con el límite normal de `ioredis`
 * (usado en `health.service.ts`) el worker se rompe apenas hay un reintento.
 */
@Injectable()
export class VencimientoProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VencimientoProcessor.name);
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly worker: Worker;

  // `@Inject(...)` explícito en ambos parámetros: `tsx`/esbuild (usado por `dev`) no
  // implementa `emitDecoratorMetadata` (evanw/esbuild#257) — sin esto, `design:paramtypes`
  // queda vacío y Nest no puede resolver NINGUNO de los dos por tipo (ver mismo fix en
  // `health.service.ts`).
  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(RotacionesService) private readonly rotacionesService: RotacionesService,
  ) {
    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6380';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(NOMBRE_COLA, { connection: this.connection });
    this.worker = new Worker(
      NOMBRE_COLA,
      async (job: Job) => {
        // Pasos independientes: si uno falla, el otro corre igual; se relanza al final para BullMQ.
        const fallos: unknown[] = [];
        let count = 0;
        let sesiones = 0;
        try {
          count = await this.rotacionesService.marcarVencidas();
          this.logger.log(`Job ${job.id}: ${count} asignación(es) marcadas como vencidas`);
        } catch (error) {
          this.logger.error(`Job ${job.id}: falló marcarVencidas`, error);
          fallos.push(error);
        }
        try {
          sesiones = await this.rotacionesService.cerrarSesionesVencidas();
          this.logger.log(`Job ${job.id}: ${sesiones} sesión(es) zombi cerradas`);
        } catch (error) {
          this.logger.error(`Job ${job.id}: falló cerrarSesionesVencidas`, error);
          fallos.push(error);
        }
        if (fallos.length === 1) throw fallos[0];
        if (fallos.length > 1) throw new AggregateError(fallos, `Job ${job.id}: fallaron ${fallos.length} pasos`);
        return { count, sesiones };
      },
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.id} de vencimiento falló: ${error.message}`, error.stack);
    });
  }

  async onModuleInit(): Promise<void> {
    // `upsertJobScheduler` (no `add` con `repeat`) es idempotente: reinicios del proceso no
    // acumulan schedulers duplicados para el mismo `NOMBRE_JOB_REPETIBLE`.
    await this.queue.upsertJobScheduler(NOMBRE_JOB_REPETIBLE, { every: CADA_MS }, {
      name: NOMBRE_JOB_REPETIBLE,
      opts: { removeOnComplete: true, removeOnFail: 100 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
