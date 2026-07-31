import { Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { AuditLogEntrySchema, type AuditLogEntry, type AuditoriaQuery } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/** RF-81..84 (QUI-230) — solo lectura, la UI con filtros completos llega en QUI-248 (M4).
 * `audit_log` tiene RLS (QUI-218): `admin_sindicato` ya queda limitado a su propio tenant
 * por la política, no hace falta un `where` explícito por `sindicatoId` acá. */
const LIMITE_FILAS = 200;

@Injectable()
export class AuditoriaService {
  async listar(actor: AuthenticatedUser, filtros: AuditoriaQuery): Promise<AuditLogEntry[]> {
    const where: Prisma.AuditLogWhereInput = {
      entidad: filtros.entidad,
      accion: filtros.accion,
      ts:
        filtros.desde || filtros.hasta
          ? { gte: filtros.desde, lte: filtros.hasta }
          : undefined,
    };

    const rows = await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
      tx.auditLog.findMany({ where, orderBy: { ts: 'desc' }, take: LIMITE_FILAS }),
    );
    return rows.map((row) => AuditLogEntrySchema.parse(row));
  }
}
