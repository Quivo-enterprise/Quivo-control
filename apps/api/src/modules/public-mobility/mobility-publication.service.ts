import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import type { EstadoPublicacion } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarLineaVisible } from '../../common/geo/tenant-checks.js';

export const MOBILITY_RESOURCES = ['lineas', 'rutas', 'variantes', 'paradas'] as const;
export type MobilityResource = (typeof MOBILITY_RESOURCES)[number];

const TRANSICIONES: Record<EstadoPublicacion, EstadoPublicacion[]> = {
  borrador: ['validado', 'archivado'],
  validado: ['borrador', 'publicado', 'archivado'],
  publicado: ['validado', 'archivado'],
  archivado: ['borrador'],
};

@Injectable()
export class MobilityPublicationService {
  async actualizar(
    actor: AuthenticatedUser,
    resource: MobilityResource,
    id: string,
    nextStatus: EstadoPublicacion,
  ): Promise<{ id: string; resource: MobilityResource; status: EstadoPublicacion; publishedAt: string | null }> {
    if (!MOBILITY_RESOURCES.includes(resource)) {
      throw new BadRequestException('Recurso de movilidad inválido');
    }

    const response = await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const currentStatus = await asegurarRecursoVisible(tx, resource, id);
      if (currentStatus === nextStatus) {
        throw new BadRequestException(`El recurso ya está ${nextStatus}`);
      }
      if (!TRANSICIONES[currentStatus].includes(nextStatus)) {
        throw new BadRequestException(`Transición no permitida: ${currentStatus} → ${nextStatus}`);
      }

      const row = await actualizarEstado(tx, resource, id, nextStatus);
      if (!row) throw new NotFoundException('Recurso de movilidad no encontrado');
      return {
        id: row.id,
        resource,
        status: row.publicStatus as EstadoPublicacion,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      };
    });
    return response;
  }
}

async function asegurarRecursoVisible(
  tx: Prisma.TransactionClient,
  resource: MobilityResource,
  id: string,
): Promise<EstadoPublicacion> {
  if (resource === 'lineas') {
    await asegurarLineaVisible(tx, id);
    const row = await tx.$queryRaw<{ publicStatus: string }[]>`
      SELECT "publicStatus" FROM lineas WHERE id = ${id}
    `;
    return estadoActual(row[0]?.publicStatus);
  }

  const rows = resource === 'rutas'
    ? await tx.$queryRaw<{ lineaId: string; publicStatus: string }[]>`
        SELECT "lineaId", "publicStatus" FROM rutas WHERE id = ${id}
      `
    : resource === 'variantes'
      ? await tx.$queryRaw<{ lineaId: string; publicStatus: string }[]>`
          SELECT r."lineaId" AS "lineaId", v."publicStatus" AS "publicStatus"
          FROM variantes v JOIN rutas r ON r.id = v."rutaId" WHERE v.id = ${id}
        `
      : await tx.$queryRaw<{ lineaId: string; publicStatus: string }[]>`
          SELECT r."lineaId" AS "lineaId", p."publicStatus" AS "publicStatus"
          FROM paradas p JOIN rutas r ON r.id = p."rutaId" WHERE p.id = ${id}
        `;
  const row = rows[0];
  if (!row) throw new NotFoundException('Recurso de movilidad no encontrado');
  await asegurarLineaVisible(tx, row.lineaId);
  return estadoActual(row.publicStatus);
}

async function actualizarEstado(
  tx: Prisma.TransactionClient,
  resource: MobilityResource,
  id: string,
  nextStatus: EstadoPublicacion,
): Promise<{ id: string; publicStatus: string; publishedAt: Date | null } | undefined> {
  const rows = resource === 'lineas'
    ? await tx.$queryRaw<{ id: string; publicStatus: string; publishedAt: Date | null }[]>`
        UPDATE lineas SET "publicStatus" = ${nextStatus},
          "publishedAt" = CASE WHEN ${nextStatus} = 'publicado' THEN now() ELSE NULL END,
          "updatedAt" = now() WHERE id = ${id}
        RETURNING id, "publicStatus", "publishedAt"
      `
    : resource === 'rutas'
      ? await tx.$queryRaw<{ id: string; publicStatus: string; publishedAt: Date | null }[]>`
          UPDATE rutas SET "publicStatus" = ${nextStatus},
            "publishedAt" = CASE WHEN ${nextStatus} = 'publicado' THEN now() ELSE NULL END,
            "updatedAt" = now() WHERE id = ${id}
          RETURNING id, "publicStatus", "publishedAt"
        `
      : resource === 'variantes'
        ? await tx.$queryRaw<{ id: string; publicStatus: string; publishedAt: Date | null }[]>`
            UPDATE variantes SET "publicStatus" = ${nextStatus},
              "publishedAt" = CASE WHEN ${nextStatus} = 'publicado' THEN now() ELSE NULL END,
              "updatedAt" = now() WHERE id = ${id}
            RETURNING id, "publicStatus", "publishedAt"
          `
        : await tx.$queryRaw<{ id: string; publicStatus: string; publishedAt: Date | null }[]>`
            UPDATE paradas SET "publicStatus" = ${nextStatus},
              "publishedAt" = CASE WHEN ${nextStatus} = 'publicado' THEN now() ELSE NULL END,
              "updatedAt" = now() WHERE id = ${id}
            RETURNING id, "publicStatus", "publishedAt"
          `;
  return rows[0];
}

function estadoActual(value: string | undefined): EstadoPublicacion {
  if (value === 'borrador' || value === 'validado' || value === 'publicado' || value === 'archivado') return value;
  throw new BadRequestException('Estado de publicación inválido');
}
