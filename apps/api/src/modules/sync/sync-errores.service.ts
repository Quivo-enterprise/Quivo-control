import { Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { SyncErrorEntrySchema, type SyncErrorEntry, type SyncErroresQuery } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import {
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
} from '../../common/tiempo/jornada.js';

const LIMITE_FILAS = 200;

/** RNF-35 (QUI-242) — `sync_errors` tiene RLS (mismo patrón que `audit_log`, QUI-218):
 * `admin_sindicato` ya queda limitado a su propio tenant por la política. */
@Injectable()
export class SyncErroresService {
  async listar(actor: AuthenticatedUser, filtros: SyncErroresQuery): Promise<SyncErrorEntry[]> {
    const parseDate = (d: unknown) => typeof d === 'string' ? new Date(d) : d as Date;
    const desde = filtros.desde ? inicioDeJornadaBolivia(parseDate(filtros.desde)) : undefined;
    const hasta = filtros.hasta ? inicioDeJornadaSiguienteBolivia(parseDate(filtros.hasta)) : undefined;
    const where: Prisma.SyncErrorWhereInput = {
      deviceId: filtros.deviceId,
      sesionId: filtros.sesionId,
      ts: desde || hasta ? { gte: desde, lt: hasta } : undefined,
    };

    const rows = await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
      tx.syncError.findMany({
        where,
        orderBy: { ts: 'desc' },
        skip: filtros.skip ?? 0,
        take: LIMITE_FILAS,
      }),
    );
    return rows.map((row) => SyncErrorEntrySchema.parse(row));
  }
}
