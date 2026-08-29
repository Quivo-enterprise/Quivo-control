import { Injectable, NotFoundException, Inject, BadRequestException } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  PassengerDeviceSchema,
  PassengerNotificationPreferencesSchema,
  PassengerNotificationSchema,
  PassengerNotificationCategorySchema,
  type PassengerDevice,
  type PassengerNotification,
  type PassengerNotificationCategory,
  type PassengerNotificationPreferences,
  type PassengerAlertTarget,
  type RegisterPassengerDeviceRequest,
  type UpdatePassengerNotificationPreferences,
} from '@quivo/shared';
import { encryptSecret, hashSecret } from '../../common/crypto/secret-box.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { NotificacionesQueue } from './notificaciones.queue.js';

const DEFAULT_PREFERENCES: PassengerNotificationPreferences = {
  serviceAlerts: true,
  lineChanges: true,
  tripReminders: true,
  campaigns: false,
  system: true,
};

@Injectable()
export class NotificacionesService {
  constructor(@Inject(NotificacionesQueue) private readonly queue: NotificacionesQueue) {}

  async registrarDispositivo(
    actor: AuthenticatedUser,
    input: RegisterPassengerDeviceRequest,
  ): Promise<PassengerDevice> {
    const tokenHash = hashSecret(input.token);
    const row = await withTenantContext(
      passengerContext(actor),
      (tx) =>
        tx.passengerDevice.upsert({
          where: { userId_deviceId: { userId: actor.userId, deviceId: input.deviceId } },
          update: {
            platform: input.platform,
            tokenHash,
            tokenCiphertext: encryptSecret(input.token),
            appVersion: input.appVersion,
            enabled: true,
            lastSeenAt: new Date(),
          },
          create: {
            userId: actor.userId,
            deviceId: input.deviceId,
            platform: input.platform,
            tokenHash,
            tokenCiphertext: encryptSecret(input.token),
            appVersion: input.appVersion,
          },
        }),
    );
    return toDevice(row);
  }

  async eliminarDispositivo(actor: AuthenticatedUser, id: string): Promise<void> {
    const result = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerDevice.deleteMany({ where: { id, userId: actor.userId } }),
    );
    if (result.count === 0) throw new NotFoundException('Dispositivo no encontrado');
  }

  async obtenerPreferencias(actor: AuthenticatedUser): Promise<PassengerNotificationPreferences> {
    const row = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerNotificationPreference.upsert({
        where: { userId: actor.userId },
        update: {},
        create: { userId: actor.userId, ...DEFAULT_PREFERENCES },
      }),
    );
    return toPreferences(row);
  }

  async actualizarPreferencias(
    actor: AuthenticatedUser,
    input: UpdatePassengerNotificationPreferences,
  ): Promise<PassengerNotificationPreferences> {
    const row = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerNotificationPreference.upsert({
        where: { userId: actor.userId },
        update: input,
        create: { userId: actor.userId, ...DEFAULT_PREFERENCES, ...input },
      }),
    );
    return toPreferences(row);
  }

  async listar(
    actor: AuthenticatedUser,
    rawLimit?: string,
    unread?: string,
    cursor?: string,
  ): Promise<{
    items: PassengerNotification[];
    nextCursor: string | null;
  }> {
    const limit = parseLimit(rawLimit);
    const onlyUnread = unread === 'true' || unread === '1';
    const cursorRow = cursor
      ? await withTenantContext(passengerContext(actor), (tx) =>
          tx.passengerNotification.findFirst({
            where: { id: cursor, userId: actor.userId },
            select: { id: true, createdAt: true },
          }),
        )
      : null;
    if (cursor && !cursorRow) throw new BadRequestException('cursor inválido');
    const rows = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerNotification.findMany({
        where: {
          userId: actor.userId,
          ...(onlyUnread ? { readAt: null } : {}),
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          ...(cursorRow
            ? {
                AND: [
                  { createdAt: { lte: cursorRow.createdAt } },
                  {
                    OR: [
                      { createdAt: { lt: cursorRow.createdAt } },
                      { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(toNotification),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }

  async marcarLeida(actor: AuthenticatedUser, id: string): Promise<void> {
    const result = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerNotification.updateMany({
        where: { id, userId: actor.userId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    if (result.count === 0) throw new NotFoundException('Notificación no encontrada');
  }

  async marcarTodasLeidas(actor: AuthenticatedUser): Promise<{ updated: number }> {
    const result = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerNotification.updateMany({
        where: { userId: actor.userId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    return { updated: result.count };
  }

  /** Productor interno para eventos de movilidad y campañas autorizadas. */
  async crearParaUsuario(input: {
    userId: string;
    category: PassengerNotificationCategory;
    title: string;
    body: string;
    deepLink?: string | null;
    payload?: Record<string, unknown>;
    expiresAt?: Date | null;
  }): Promise<PassengerNotification> {
    const category = PassengerNotificationCategorySchema.parse(input.category);
    const row = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      (tx) =>
        tx.passengerNotification.create({
          data: {
            userId: input.userId,
            category,
            title: input.title,
            body: input.body,
            deepLink: input.deepLink ?? null,
            payload: input.payload as Prisma.InputJsonObject | undefined,
            expiresAt: input.expiresAt ?? null,
          },
        }),
    );
    const notification = toNotification(row);
    await this.queue.encolar(notification.id);
    return notification;
  }

  async notificarSuscriptores(
    targetType: PassengerAlertTarget,
    targetId: string,
    title: string,
    body: string,
    deepLink: string,
  ): Promise<number> {
    const subscriptions = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.passengerAlertSubscription.findMany({
        where: { targetType, targetId, enabled: true },
        select: { userId: true },
      }),
    );
    for (const subscription of subscriptions) {
      await this.crearParaUsuario({
        userId: subscription.userId,
        category: 'line_change',
        title,
        body,
        deepLink,
      });
    }
    return subscriptions.length;
  }
}

function passengerContext(actor: AuthenticatedUser) {
  return { rol: actor.rol, sindicatoId: null, userId: actor.userId } as const;
}

function parseLimit(rawLimit?: string): number {
  if (!rawLimit) return 30;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestException('limit debe estar entre 1 y 100');
  }
  return limit;
}

function toDevice(row: {
  id: string;
  deviceId: string;
  platform: string;
  appVersion: string | null;
  enabled: boolean;
  lastSeenAt: Date;
  createdAt: Date;
}): PassengerDevice {
  return PassengerDeviceSchema.parse({
    id: row.id,
    deviceId: row.deviceId,
    platform: row.platform,
    appVersion: row.appVersion,
    enabled: row.enabled,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}

function toPreferences(row: {
  serviceAlerts: boolean;
  lineChanges: boolean;
  tripReminders: boolean;
  campaigns: boolean;
  system: boolean;
}): PassengerNotificationPreferences {
  return PassengerNotificationPreferencesSchema.parse({
    serviceAlerts: row.serviceAlerts,
    lineChanges: row.lineChanges,
    tripReminders: row.tripReminders,
    campaigns: row.campaigns,
    system: row.system,
  });
}

function toNotification(row: {
  id: string;
  category: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): PassengerNotification {
  return PassengerNotificationSchema.parse({
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    deepLink: row.deepLink,
    readAt: row.readAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}
