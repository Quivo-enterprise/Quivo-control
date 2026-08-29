import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  PassengerFavoriteLineSchema,
  PassengerAlertSubscriptionSchema,
  PassengerAlertTargetSchema,
  PassengerRecentSearchSchema,
  PassengerSavedPlaceSchema,
  type CreatePassengerRecentSearch,
  type CreatePassengerSavedPlace,
  type PassengerFavoriteLine,
  type PassengerAlertSubscription,
  type PassengerRecentSearch,
  type PassengerSavedPlace,
  type UpdatePassengerSavedPlace,
  uuidSchema,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { PlanesService } from '../planes/planes.service.js';

@Injectable()
export class PasajerosDatosService {
  constructor(@Inject(PlanesService) private readonly planes: PlanesService) {}

  async listarFavoritos(actor: AuthenticatedUser): Promise<PassengerFavoriteLine[]> {
    const rows = await withTenantContext(context(actor), (tx) =>
      tx.passengerFavoriteLine.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((row) =>
      PassengerFavoriteLineSchema.parse({ lineId: row.lineId, createdAt: row.createdAt.toISOString() }),
    );
  }

  async guardarFavorito(actor: AuthenticatedUser, lineId: string): Promise<PassengerFavoriteLine> {
    const validLineId = parseUuid(lineId);
    const row = await withTenantContext(context(actor), (tx) =>
      tx.passengerFavoriteLine.upsert({
        where: { userId_lineId: { userId: actor.userId, lineId: validLineId } },
        update: {},
        create: { userId: actor.userId, lineId: validLineId },
      }),
    );
    return PassengerFavoriteLineSchema.parse({ lineId: row.lineId, createdAt: row.createdAt.toISOString() });
  }

  async eliminarFavorito(actor: AuthenticatedUser, lineId: string): Promise<{ removed: boolean }> {
    const result = await withTenantContext(context(actor), (tx) =>
      tx.passengerFavoriteLine.deleteMany({ where: { userId: actor.userId, lineId: parseUuid(lineId) } }),
    );
    return { removed: result.count > 0 };
  }

  async listarLugares(actor: AuthenticatedUser): Promise<PassengerSavedPlace[]> {
    const rows = await withTenantContext(context(actor), (tx) =>
      tx.passengerSavedPlace.findMany({ where: { userId: actor.userId }, orderBy: { updatedAt: 'desc' } }),
    );
    return rows.map(toSavedPlace);
  }

  async guardarLugar(actor: AuthenticatedUser, input: CreatePassengerSavedPlace): Promise<PassengerSavedPlace> {
    const existing = await withTenantContext(context(actor), (tx) =>
      tx.passengerSavedPlace.count({ where: { userId: actor.userId } }),
    );
    const entitlements = await this.planes.obtenerEntitlements(actor);
    const rawLimit = featureValue(entitlements, 'saved_places_limit');
    const limit = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : Number.POSITIVE_INFINITY;
    if (existing >= limit) {
      throw new ForbiddenException('Tu plan alcanzó el límite de lugares guardados');
    }
    const row = await withTenantContext(context(actor), (tx) =>
      tx.passengerSavedPlace.create({
        data: { name: input.name, coordinate: input.coordinate as Prisma.InputJsonObject, userId: actor.userId },
      }),
    );
    return toSavedPlace(row);
  }

  async actualizarLugar(
    actor: AuthenticatedUser,
    id: string,
    input: UpdatePassengerSavedPlace,
  ): Promise<PassengerSavedPlace> {
    const row = await withTenantContext(context(actor), async (tx) => {
      const result = await tx.passengerSavedPlace.updateMany({
        where: { id: parseUuid(id), userId: actor.userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.coordinate !== undefined
            ? { coordinate: input.coordinate as Prisma.InputJsonObject }
            : {}),
        },
      });
      if (result.count === 0) throw new NotFoundException('Lugar guardado no encontrado');
      return tx.passengerSavedPlace.findUniqueOrThrow({ where: { id: parseUuid(id) } });
    });
    return toSavedPlace(row);
  }

  async eliminarLugar(actor: AuthenticatedUser, id: string): Promise<{ removed: boolean }> {
    const result = await withTenantContext(context(actor), (tx) =>
      tx.passengerSavedPlace.deleteMany({ where: { id: parseUuid(id), userId: actor.userId } }),
    );
    return { removed: result.count > 0 };
  }

  async listarRecientes(actor: AuthenticatedUser): Promise<PassengerRecentSearch[]> {
    const rows = await withTenantContext(context(actor), (tx) =>
      tx.passengerRecentSearch.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    return rows.map(toRecentSearch);
  }

  async guardarReciente(actor: AuthenticatedUser, input: CreatePassengerRecentSearch): Promise<PassengerRecentSearch> {
    const row = await withTenantContext(context(actor), async (tx) => {
      const created = await tx.passengerRecentSearch.create({
        data: {
          userId: actor.userId,
          label: input.label ?? null,
          origin: input.origin as Prisma.InputJsonObject,
          destination: input.destination as Prisma.InputJsonObject,
        },
      });
      const stale = await tx.passengerRecentSearch.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        select: { id: true },
      });
      if (stale.length > 0) {
        await tx.passengerRecentSearch.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
      }
      return created;
    });
    return toRecentSearch(row);
  }

  async eliminarRecientes(actor: AuthenticatedUser): Promise<{ removed: number }> {
    const result = await withTenantContext(context(actor), (tx) =>
      tx.passengerRecentSearch.deleteMany({ where: { userId: actor.userId } }),
    );
    return { removed: result.count };
  }

  async listarAlertas(actor: AuthenticatedUser): Promise<PassengerAlertSubscription[]> {
    const rows = await withTenantContext(context(actor), (tx) =>
      tx.passengerAlertSubscription.findMany({
        where: { userId: actor.userId, enabled: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((row) =>
      PassengerAlertSubscriptionSchema.parse({
        targetType: row.targetType,
        targetId: row.targetId,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  }

  async suscribirseAlerta(
    actor: AuthenticatedUser,
    rawTargetType: string,
    rawTargetId: string,
  ): Promise<PassengerAlertSubscription> {
    const targetType = PassengerAlertTargetSchema.safeParse(rawTargetType);
    if (!targetType.success) throw new BadRequestException('Tipo de alerta inválido');
    const targetId = parseUuid(rawTargetId);
    if (targetType.data === 'route') {
      const entitlements = await this.planes.obtenerEntitlements(actor);
      const advanced = featureValue(entitlements, 'advanced_alerts');
      if (advanced !== 'true') {
        throw new ForbiddenException('Las alertas avanzadas requieren un plan compatible');
      }
    }
    const row = await withTenantContext(context(actor), (tx) =>
      tx.passengerAlertSubscription.upsert({
        where: {
          userId_targetKey: { userId: actor.userId, targetKey: `${targetType.data}:${targetId}` },
        },
        update: { enabled: true },
        create: {
          userId: actor.userId,
          targetType: targetType.data,
          targetId,
          targetKey: `${targetType.data}:${targetId}`,
        },
      }),
    );
    return PassengerAlertSubscriptionSchema.parse({
      targetType: row.targetType,
      targetId: row.targetId,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
    });
  }

  async eliminarAlerta(
    actor: AuthenticatedUser,
    rawTargetType: string,
    rawTargetId: string,
  ): Promise<{ removed: boolean }> {
    const targetType = PassengerAlertTargetSchema.safeParse(rawTargetType);
    if (!targetType.success) throw new BadRequestException('Tipo de alerta inválido');
    const targetId = parseUuid(rawTargetId);
    const result = await withTenantContext(context(actor), (tx) =>
      tx.passengerAlertSubscription.deleteMany({
        where: { userId: actor.userId, targetKey: `${targetType.data}:${targetId}` },
      }),
    );
    return { removed: result.count > 0 };
  }
}

function context(actor: AuthenticatedUser) {
  return { rol: actor.rol, sindicatoId: null, userId: actor.userId } as const;
}

function featureValue(
  entitlements: { plan: { features: Array<{ code: string; value: string }> }; grants: Record<string, string> },
  code: string,
): string | undefined {
  return entitlements.grants[code] ?? entitlements.plan.features.find((feature) => feature.code === code)?.value;
}

function parseUuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Identificador inválido');
  return parsed.data;
}

function toSavedPlace(row: {
  id: string;
  name: string;
  coordinate: unknown;
  createdAt: Date;
  updatedAt: Date;
}): PassengerSavedPlace {
  return PassengerSavedPlaceSchema.parse({
    id: row.id,
    name: row.name,
    coordinate: row.coordinate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toRecentSearch(row: {
  id: string;
  label: string | null;
  origin: unknown;
  destination: unknown;
  createdAt: Date;
}): PassengerRecentSearch {
  return PassengerRecentSearchSchema.parse({
    id: row.id,
    label: row.label,
    origin: row.origin,
    destination: row.destination,
    createdAt: row.createdAt.toISOString(),
  });
}
