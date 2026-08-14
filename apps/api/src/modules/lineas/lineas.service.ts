import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import { Prisma } from '@quivo/db';
import { LineaSchema, type ActualizarLinea, type CrearLinea, type Linea } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const CODIGO_DUPLICADO = 'P2002';

@Injectable()
export class LineasService {
  async listar(actor: AuthenticatedUser): Promise<Linea[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.linea.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { codigo: 'asc' },
      }),
    );
    return rows.map(toLinea);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Linea> {
    const linea = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.linea.findUnique({ where: { id } }),
    );
    if (!linea) {
      throw new NotFoundException('Línea no encontrada');
    }
    return toLinea(linea);
  }

  async crear(actor: AuthenticatedUser, data: CrearLinea): Promise<Linea> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    try {
      const linea = await withTenantContext(toTenantContext(actor), (tx) =>
        tx.linea.create({ data: { ...data, sindicatoId } }),
      );
      return toLinea(linea);
    } catch (error) {
      throw traducirErrorUnicidad(error, data.codigo);
    }
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarLinea): Promise<Linea> {
    try {
      const linea = await withTenantContext(toTenantContext(actor), async (tx) => {
        const anterior = await tx.linea.findUnique({ where: { id } });
        if (!anterior) {
          throw new NotFoundException('Línea no encontrada');
        }
        return tx.linea.update({ where: { id }, data });
      });
      return toLinea(linea);
    } catch (error) {
      throw traducirErrorUnicidad(error, data.codigo);
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

/** El `@@unique([sindicatoId, codigo])` del schema (QUI-217) es la barrera real — esto solo
 * traduce el P2002 de Postgres a un 409 legible en vez de un 500 genérico. */
function traducirErrorUnicidad(error: unknown, codigo: string | undefined): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === CODIGO_DUPLICADO) {
    return new ConflictException(`Ya existe una línea con el código "${codigo}" en este sindicato`);
  }
  return error;
}

function toLinea(row: {
  id: string;
  sindicatoId: string;
  codigo: string;
  nombre: string;
  color: string | null;
  descripcion: string | null;
}): Linea {
  return LineaSchema.parse(row);
}
