import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  ConductorSchema,
  type ActualizarConductor,
  type Conductor,
  type CrearConductor,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Sin FK fija a vehículo/socio a propósito: un conductor rota entre vehículos (doc técnico
 * §15.3) — esa relación vive en `asignaciones`/rotaciones (M2, QUI-231/232), no como campo
 * fijo acá. Mismo tenant-scoping que socios/vehículos (QUI-221/222).
 */
@Injectable()
export class ConductoresService {
  async listar(actor: AuthenticatedUser): Promise<Conductor[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.conductor.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { nombre: 'asc' },
      }),
    );
    return rows.map(toConductor);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Conductor> {
    const conductor = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.conductor.findUnique({ where: { id } }),
    );
    if (!conductor) {
      throw new NotFoundException('Conductor no encontrado');
    }
    return toConductor(conductor);
  }

  async crear(actor: AuthenticatedUser, data: CrearConductor): Promise<Conductor> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    try {
      const conductor = await withTenantContext(toTenantContext(actor), (tx) =>
        tx.conductor.create({ data: { ...data, sindicatoId } }),
      );
      return toConductor(conductor);
    } catch (error: unknown) {
      throw traducirCiDuplicado(error);
    }
  }

  async actualizar(
    actor: AuthenticatedUser,
    id: string,
    data: ActualizarConductor,
  ): Promise<Conductor> {
    try {
      const conductor = await withTenantContext(toTenantContext(actor), async (tx) => {
        const anterior = await tx.conductor.findUnique({ where: { id } });
        if (!anterior) {
          throw new NotFoundException('Conductor no encontrado');
        }
        return tx.conductor.update({ where: { id }, data });
      });
      return toConductor(conductor);
    } catch (error: unknown) {
      throw traducirCiDuplicado(error);
    }
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function resolverSindicatoId(actor: AuthenticatedUser, sindicatoIdDelBody: string): string {
  if (actor.sindicatoId) {
    return actor.sindicatoId;
  }
  if (!sindicatoIdDelBody) {
    throw new BadRequestException('sindicatoId es obligatorio para admin_quivo');
  }
  return sindicatoIdDelBody;
}

function traducirCiDuplicado(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('Ya existe un conductor con ese CI en este sindicato');
  }
  return error;
}

function toConductor(row: {
  id: string;
  sindicatoId: string;
  nombre: string;
  documentoIdentidad: string;
  licenciaConducir: string;
  estado: string;
}): Conductor {
  return ConductorSchema.parse(row);
}
