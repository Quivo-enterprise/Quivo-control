import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { EventoSync } from '@quivo/shared';

export const COLA_INGESTA_SYNC = 'ingesta-sync';

/**
 * Opciones de cada lote encolado. Sin `removeOn*` los jobs terminados se acumulan en Redis
 * (`noeviction`, 1 GB) hasta llenarlo, y `removeOnFail` lleva también `count` para que una caída
 * larga de la DB no lo llene. Sin `attempts`/`backoff` a propósito: BullMQ mandaría el lote
 * fallido a `delayed` y el worker procesaría antes lotes más nuevos del mismo teléfono (PC omitido
 * falso); el reintento ante errores transitorios de la DB es en proceso (`procesarLote`).
 */
export const OPCIONES_JOB_INGESTA: JobsOptions = {
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

export interface LoteIngestaJob {
  sindicatoId: string;
  deviceId: string;
  eventos: EventoSync[];
}

/**
 * Solo el productor (encola en BullMQ, QUI-240) — el consumidor real corre en un proceso
 * worker separado (`apps/api/src/worker.ts`, QUI-241), a diferencia de
 * `rotaciones/vencimiento.processor.ts` que combina productor+consumidor en el mismo
 * proceso HTTP. Mismo patrón manual de `bullmq` (no hay `@nestjs/bullmq` en el repo).
 */
@Injectable()
export class SyncQueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<LoteIngestaJob>;

  // `@Inject(ConfigService)` explícito: `tsx`/esbuild (usado por `dev`/`dev:worker`) no
  // emite `design:paramtypes` para clases importadas desde paquetes externos (evanw/esbuild#257)
  // — ver mismo fix en `health/health.service.ts`.
  constructor(@Inject(ConfigService) config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6380';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<LoteIngestaJob>(COLA_INGESTA_SYNC, { connection: this.connection });
  }

  async encolarLote(job: LoteIngestaJob): Promise<void> {
    await this.queue.add('lote', job, OPCIONES_JOB_INGESTA);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
