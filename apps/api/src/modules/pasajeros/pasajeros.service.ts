import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import {
  PassengerProfileSchema,
  type PassengerProfile,
  type UpdatePassengerProfileRequest,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

@Injectable()
export class PasajerosService {
  async obtenerPerfil(actor: AuthenticatedUser): Promise<PassengerProfile> {
    const row = await withTenantContext(passengerContext(actor), (tx) =>
      tx.passengerProfile.findUnique({ where: { userId: actor.userId } }),
    );
    if (!row) {
      throw new NotFoundException('Perfil de pasajero no encontrado');
    }
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, name: true, email: true, emailVerified: true, rol: true },
    });
    if (!user || user.rol !== 'pasajero') {
      throw new UnauthorizedException('Cuenta de pasajero inválida');
    }
    return toPassengerProfile(row, user);
  }

  async actualizarPerfil(
    actor: AuthenticatedUser,
    input: UpdatePassengerProfileRequest,
  ): Promise<PassengerProfile> {
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, name: true, email: true, emailVerified: true, rol: true },
    });
    if (!user || user.rol !== 'pasajero') {
      throw new UnauthorizedException('Cuenta de pasajero inválida');
    }

    const row = await withTenantContext(passengerContext(actor), async (tx) => {
      if (input.name !== undefined) {
        await tx.user.update({ where: { id: actor.userId }, data: { name: input.name } });
      }
      return tx.passengerProfile.update({
        where: { userId: actor.userId },
        data: {
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        },
      });
    });

    return toPassengerProfile(row, {
      ...user,
      name: input.name ?? user.name,
    });
  }
}

function passengerContext(actor: AuthenticatedUser) {
  return { rol: actor.rol, sindicatoId: null, userId: actor.userId } as const;
}

function toPassengerProfile(
  row: {
    id: string;
    userId: string;
    locale: string;
    timezone: string;
    termsVersion: string;
    termsAcceptedAt: Date;
    estado: string;
    createdAt: Date;
    updatedAt: Date;
  },
  user: { id: string; name: string; email: string; emailVerified: boolean },
): PassengerProfile {
  return PassengerProfileSchema.parse({
    id: row.id,
    userId: row.userId,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    locale: row.locale,
    timezone: row.timezone,
    termsVersion: row.termsVersion,
    termsAcceptedAt: row.termsAcceptedAt.toISOString(),
    estado: row.estado,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
