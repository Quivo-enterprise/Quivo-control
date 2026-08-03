import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { EventoSync } from '@quivo/shared';

export const COLA_INGESTA_SYNC = 'ingesta-sync';

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
    await this.queue.add('lote', job);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
