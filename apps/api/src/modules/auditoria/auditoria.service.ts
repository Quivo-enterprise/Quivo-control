import { Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { AuditLogEntrySchema, type AuditLogEntry, type AuditoriaQuery } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import {
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
} from '../../common/tiempo/jornada.js';

/** RF-81..84 (QUI-230/248). `audit_log` tiene RLS (QUI-218): `admin_sindicato` ya queda
 * limitado a su propio tenant por la política, no hace falta un `where` explícito por
 * `sindicatoId` acá. */
const LIMITE_FILAS = 200;

const parseDate = (d: unknown) => (typeof d === 'string' ? new Date(d) : (d as Date));

@Injectable()
export class AuditoriaService {
  async listar(actor: AuthenticatedUser, filtros: AuditoriaQuery): Promise<AuditLogEntry[]> {
    const desde = filtros.desde ? inicioDeJornadaBolivia(parseDate(filtros.desde)) : undefined;
    const hasta = filtros.hasta ? inicioDeJornadaSiguienteBolivia(parseDate(filtros.hasta)) : undefined;
    const where: Prisma.AuditLogWhereInput = {
      entidad: filtros.entidad,
      accion: filtros.accion,
      usuarioId: filtros.usuarioId,
      ts: desde || hasta ? { gte: desde, lt: hasta } : undefined,
    };

    const rows = await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
      tx.auditLog.findMany({
        where,
        orderBy: { ts: 'desc' },
        skip: filtros.skip ?? 0,
        take: LIMITE_FILAS,
      }),
    );
    return rows.map((row) => AuditLogEntrySchema.parse(row));
  }
}
