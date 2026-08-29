import { Inject, Injectable, Logger, type OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withTenantContext } from '@quivo/db';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { decryptSecret } from '../../common/crypto/secret-box.js';
import {
  PASSENGER_NOTIFICATIONS_QUEUE,
  type PassengerNotificationJob,
} from './notification-job.js';

interface ExpoTicket {
  status?: string;
  id?: string;
  message?: string;
}

/** Consumidor separado para que una caída del proveedor push no bloquee la API HTTP. */
@Injectable()
export class NotificacionesWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificacionesWorkerService.name);
  private readonly connection: Redis;
  private readonly expoPushUrl: string;
  private worker?: Worker<PassengerNotificationJob>;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6380';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.expoPushUrl =
      config.get<string>('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push/send';
  }

  onModuleInit(): void {
    this.worker = new Worker<PassengerNotificationJob>(
      PASSENGER_NOTIFICATIONS_QUEUE,
      (job) => this.entregar(job),
      { connection: this.connection, concurrency: 5 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error({ jobId: job?.id, error: error.message }, 'Falló entrega de notificación');
    });
  }

  private async entregar(job: Job<PassengerNotificationJob>): Promise<void> {
    const notification = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      (tx) =>
        tx.passengerNotification.findUnique({
          where: { id: job.data.notificationId },
          include: { deliveries: true },
        }),
    );
    if (!notification || (notification.expiresAt && notification.expiresAt <= new Date())) return;

    const preferences = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      (tx) =>
        tx.passengerNotificationPreference.findUnique({
          where: { userId: notification.userId },
        }),
    );
    const pushEnabled = notificationPreferenceEnabled(notification.category, preferences);
    if (!pushEnabled) return;

    const devices = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.passengerDevice.findMany({ where: { userId: notification.userId, enabled: true } }),
    );
    const expoDevices = devices.filter((device) => device.platform === 'expo');
    if (expoDevices.length === 0) return;

    const pending = expoDevices.filter((device) => {
      const delivery = notification.deliveries.find((entry) => entry.deviceId === device.id);
      return delivery?.status !== 'delivered';
    });
    if (pending.length === 0) return;

    const notificationPayload =
      notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
        ? (notification.payload as Record<string, unknown>)
        : {};
    const messages = pending.map((device) => ({
      to: decryptSecret(device.tokenCiphertext),
      title: notification.title,
      body: notification.body,
      data: { deepLink: notification.deepLink, ...notificationPayload },
    }));
    const response = await fetch(this.expoPushUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error(`Expo Push respondió HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: ExpoTicket[] };
    const tickets = payload.data ?? [];

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      for (let index = 0; index < pending.length; index += 1) {
        const device = pending[index]!;
        const ticket = tickets[index];
        const delivered = ticket?.status === 'ok';
        await tx.passengerNotificationDelivery.upsert({
          where: { notificationId_deviceId: { notificationId: notification.id, deviceId: device.id } },
          update: {
            status: delivered ? 'delivered' : 'failed',
            attempts: { increment: 1 },
            providerMessageId: ticket?.id,
            lastError: delivered ? null : ticket?.message ?? 'Expo rechazó el mensaje',
            deliveredAt: delivered ? new Date() : null,
          },
          create: {
            notificationId: notification.id,
            deviceId: device.id,
            status: delivered ? 'delivered' : 'failed',
            attempts: 1,
            providerMessageId: ticket?.id,
            lastError: delivered ? null : ticket?.message ?? 'Expo rechazó el mensaje',
            deliveredAt: delivered ? new Date() : null,
          },
        });
        if (ticket?.message?.toLowerCase().includes('device not found')) {
          await tx.passengerDevice.update({ where: { id: device.id }, data: { enabled: false } });
        }
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection.disconnect();
  }
}

function notificationPreferenceEnabled(
  category: string,
  preferences: {
    serviceAlerts: boolean;
    lineChanges: boolean;
    tripReminders: boolean;
    campaigns: boolean;
    system: boolean;
  } | null,
): boolean {
  if (!preferences) return category !== 'campaign';
  switch (category) {
    case 'service_alert':
      return preferences.serviceAlerts;
    case 'line_change':
      return preferences.lineChanges;
    case 'trip_reminder':
      return preferences.tripReminders;
    case 'campaign':
      return preferences.campaigns;
    case 'system':
      return preferences.system;
    default:
      return false;
  }
}
