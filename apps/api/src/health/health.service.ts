import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@quivo/db';
import { Redis } from 'ioredis';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  redis: 'up' | 'down';
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  // `@Inject(ConfigService)` explícito: `tsx`/esbuild (usado por `dev`/`dev:worker`) no
  // implementa `emitDecoratorMetadata` (limitación conocida y no resuelta de esbuild,
  // evanw/esbuild#257) — sin esto, Nest resuelve `config` como `undefined` en runtime
  // (`design:paramtypes` queda vacío) y el bootstrap entero crashea. Verificado con un
  // repro aislado: `tsc` real sí emite la metadata, `tsx` no. Único lugar del código que
  // inyecta un provider externo por tipo en el constructor — el resto de los services de
  // esta app no usa inyección de constructor (llaman a `withTenantContext`/`prisma`
  // directamente), por eso este bug no se había manifestado antes.
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6380', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async check(): Promise<HealthStatus> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    return {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      db,
      redis,
    };
  }

  private async checkDb(): Promise<'up' | 'down'> {
    try {
      // Pool compartido de Prisma (acotado y con timeouts): no abre conexiones propias.
      await prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        await this.redis.connect();
      }
      await this.redis.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
