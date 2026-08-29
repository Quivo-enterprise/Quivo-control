import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  PASSENGER_NOTIFICATIONS_QUEUE,
  type PassengerNotificationJob,
} from './notification-job.js';

@Injectable()
export class NotificacionesQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<PassengerNotificationJob>;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6380';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<PassengerNotificationJob>(PASSENGER_NOTIFICATIONS_QUEUE, {
      connection: this.connection,
    });
  }

  async encolar(notificationId: string): Promise<void> {
    await this.queue.add(
      'deliver-notification',
      { notificationId },
      {
        jobId: `passenger-notification:${notificationId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: { age: 7 * 86_400, count: 10_000 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
