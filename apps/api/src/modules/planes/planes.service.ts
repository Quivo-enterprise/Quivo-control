import { Injectable } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import {
  PassengerEntitlementsSchema,
  PassengerPlanSchema,
  PassengerSubscriptionSchema,
  type PassengerEntitlements,
  type PassengerPlan,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

@Injectable()
export class PlanesService {
  async listarPlanes(): Promise<PassengerPlan[]> {
    const rows = await prisma.passengerPlan.findMany({
      where: { active: true },
      include: { features: { orderBy: { code: 'asc' } } },
      orderBy: [{ priceCents: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toPlan);
  }

  async obtenerEntitlements(actor: AuthenticatedUser): Promise<PassengerEntitlements> {
    const now = new Date();
    const result = await withTenantContext(
      { rol: actor.rol, sindicatoId: null, userId: actor.userId },
      async (tx) => {
        const [freePlan, subscription, grants] = await Promise.all([
          tx.passengerPlan.findUnique({
            where: { code: 'free' },
            include: { features: { orderBy: { code: 'asc' } } },
          }),
          tx.passengerSubscription.findFirst({
            where: {
              userId: actor.userId,
              status: { in: ['trialing', 'active', 'past_due'] },
              OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
            },
            include: { plan: { include: { features: { orderBy: { code: 'asc' } } } } },
            orderBy: [{ currentPeriodEnd: 'desc' }, { createdAt: 'desc' }],
          }),
          tx.passengerEntitlementGrant.findMany({
            where: { userId: actor.userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            orderBy: { code: 'asc' },
          }),
        ]);

        if (!freePlan) throw new Error('El plan free no está configurado');
        const selectedPlan = subscription?.plan ?? freePlan;
        return { selectedPlan, subscription, grants };
      },
    );

    const plan = toPlan(result.selectedPlan);
    const subscription = result.subscription
      ? PassengerSubscriptionSchema.parse({
          id: result.subscription.id,
          planCode: result.subscription.plan.code,
          status: result.subscription.status,
          startsAt: result.subscription.startsAt.toISOString(),
          currentPeriodEnd: result.subscription.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: result.subscription.cancelAtPeriodEnd,
        })
      : null;
    const grants = Object.fromEntries(result.grants.map((grant) => [grant.code, grant.value]));
    return PassengerEntitlementsSchema.parse({ plan, subscription, grants });
  }
}

function toPlan(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  features: Array<{ code: string; value: string }>;
}): PassengerPlan {
  return PassengerPlanSchema.parse({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    interval: row.interval,
    features: row.features.map((feature) => ({ code: feature.code, value: feature.value })),
  });
}
