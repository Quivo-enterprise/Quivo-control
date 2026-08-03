import { Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { SyncErrorEntrySchema, type SyncErrorEntry, type SyncErroresQuery } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const LIMITE_FILAS = 200;

/** RNF-35 (QUI-242) — `sync_errors` tiene RLS (mismo patrón que `audit_log`, QUI-218):
 * `admin_sindicato` ya queda limitado a su propio tenant por la política. */
@Injectable()
export class SyncErroresService {
  async listar(actor: AuthenticatedUser, filtros: SyncErroresQuery): Promise<SyncErrorEntry[]> {
    const where: Prisma.SyncErrorWhereInput = {
      deviceId: filtros.deviceId,
      sesionId: filtros.sesionId,
      ts:
        filtros.desde || filtros.hasta
          ? { gte: filtros.desde, lte: filtros.hasta }
          : undefined,
    };

    const rows = await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
      tx.syncError.findMany({ where, orderBy: { ts: 'desc' }, take: LIMITE_FILAS }),
    );
    return rows.map((row) => SyncErrorEntrySchema.parse(row));
  }
}
