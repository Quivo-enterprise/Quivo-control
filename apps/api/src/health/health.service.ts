import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  redis: 'up' | 'down';
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.pool = new Pool({ connectionString: config.get<string>('DATABASE_URL') });
    this.redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
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
      await this.pool.query('SELECT 1');
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
    await this.pool.end();
    this.redis.disconnect();
  }
}
