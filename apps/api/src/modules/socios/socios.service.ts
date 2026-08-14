import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import { SocioSchema, type ActualizarSocio, type CrearSocio, type Socio } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * A diferencia de sindicatos (QUI-220, solo `admin_quivo`), acá `admin_sindicato`/`operador`
 * sí operan sobre datos reales de su propio tenant. El filtro explícito por `sindicatoId`
 * en las queries es una comodidad de rendimiento/legibilidad, NO la barrera de seguridad —
 * esa es RLS (QUI-218): si algún método de abajo alguna vez "se olvida" del filtro, la
 * política de Postgres sigue bloqueando cross-tenant igual (ver rls.integration.test.ts en
 * @quivo/db y socios.service.test.ts más abajo, que ejercitan justo ese caso).
 */
@Injectable()
export class SociosService {
  async listar(actor: AuthenticatedUser): Promise<Socio[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.socio.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { nombre: 'asc' },
      }),
    );
    return rows.map(toSocio);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Socio> {
    const socio = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.socio.findUnique({ where: { id } }),
    );
    if (!socio) {
      throw new NotFoundException('Socio no encontrado');
    }
    return toSocio(socio);
  }

  async crear(actor: AuthenticatedUser, data: CrearSocio): Promise<Socio> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    try {
      const socio = await withTenantContext(toTenantContext(actor), (tx) =>
        tx.socio.create({ data: { ...data, sindicatoId } }),
      );
      return toSocio(socio);
    } catch (error: unknown) {
      throw traducirCiDuplicado(error);
    }
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarSocio): Promise<Socio> {
    try {
      const socio = await withTenantContext(toTenantContext(actor), async (tx) => {
        const anterior = await tx.socio.findUnique({ where: { id } });
        if (!anterior) {
          throw new NotFoundException('Socio no encontrado');
        }
        return tx.socio.update({ where: { id }, data });
      });
      return toSocio(socio);
    } catch (error: unknown) {
      throw traducirCiDuplicado(error);
    }
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

/** `admin_quivo` (sin tenant propio) debe mandar `sindicatoId` en el body; cualquier otro
 * rol queda forzado a su propio tenant sin importar qué mande el body — nunca confiar en
 * que el cliente elija de qué sindicato es un alta. */
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
    return new ConflictException('Ya existe un socio con ese CI en este sindicato');
  }
  return error;
}

function toSocio(row: {
  id: string;
  sindicatoId: string;
  nombre: string;
  documentoIdentidad: string;
  estado: string;
}): Socio {
  return SocioSchema.parse(row);
}
