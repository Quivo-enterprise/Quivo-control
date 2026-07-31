import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import { ReglaSchema, type ActualizarRegla, type CrearRegla, type Regla } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

@Injectable()
export class ReglasService {
  async listar(actor: AuthenticatedUser): Promise<Regla[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.regla.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { nombre: 'asc' },
      }),
    );
    return rows.map(toRegla);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Regla> {
    const regla = await withTenantContext(toTenantContext(actor), (tx) => tx.regla.findUnique({ where: { id } }));
    if (!regla) {
      throw new NotFoundException('Regla no encontrada');
    }
    return toRegla(regla);
  }

  async crear(actor: AuthenticatedUser, data: CrearRegla): Promise<Regla> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    const regla = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.regla.create({ data: { ...data, sindicatoId } }),
    );
    return toRegla(regla);
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarRegla): Promise<Regla> {
    const regla = await withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await tx.regla.findUnique({ where: { id } });
      if (!anterior) {
        throw new NotFoundException('Regla no encontrada');
      }
      return tx.regla.update({ where: { id }, data });
    });
    return toRegla(regla);
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function resolverSindicatoId(actor: AuthenticatedUser, sindicatoIdDelBody: string | undefined): string {
  if (actor.sindicatoId) {
    return actor.sindicatoId;
  }
  if (!sindicatoIdDelBody) {
    throw new BadRequestException('sindicatoId es obligatorio para admin_quivo');
  }
  return sindicatoIdDelBody;
}

function toRegla(row: {
  id: string;
  sindicatoId: string;
  nombre: string;
  tipo: string;
  gravedad: string;
  aplicaA: string;
  descripcion: string | null;
  estado: string;
}): Regla {
  return ReglaSchema.parse(row);
}
