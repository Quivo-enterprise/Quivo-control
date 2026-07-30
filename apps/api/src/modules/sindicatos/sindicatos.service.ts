import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { SindicatoSchema, type ActualizarSindicato, type CrearSindicato, type Sindicato } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Todo pasa por `withTenantContext` (QUI-218) aunque este módulo solo lo use `admin_quivo`
 * (el guard de rol ya lo garantiza, ver sindicatos.controller.ts) — es el mismo helper que
 * van a usar los módulos de socios/vehículos/etc. cuando `admin_sindicato` sí necesite el
 * filtro real, y ejercita la política de RLS en vez de esquivarla.
 */
@Injectable()
export class SindicatosService {
  async listar(actor: AuthenticatedUser): Promise<Sindicato[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.sindicato.findMany({ orderBy: { nombre: 'asc' } }),
    );
    return rows.map(toSindicato);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Sindicato> {
    const sindicato = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.sindicato.findUnique({ where: { id } }),
    );
    if (!sindicato) {
      throw new NotFoundException('Sindicato no encontrado');
    }
    return toSindicato(sindicato);
  }

  async crear(actor: AuthenticatedUser, data: CrearSindicato): Promise<Sindicato> {
    const sindicato = await withTenantContext(toTenantContext(actor), async (tx) => {
      const creado = await tx.sindicato.create({ data });
      await auditar(tx, actor, 'crear', creado.id, data);
      return creado;
    });
    return toSindicato(sindicato);
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarSindicato): Promise<Sindicato> {
    const sindicato = await withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await tx.sindicato.findUnique({ where: { id } });
      if (!anterior) {
        throw new NotFoundException('Sindicato no encontrado');
      }
      const actualizado = await tx.sindicato.update({ where: { id }, data });
      await auditar(tx, actor, 'editar', id, { antes: anterior, cambios: data });
      return actualizado;
    });
    return toSindicato(sindicato);
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

/** `estado` es `String` libre en Prisma (QUI-217: la única fuente de verdad del enum es
 * `EstadoSindicatoSchema` en @quivo/shared, no un enum nativo de Postgres) — este `parse`
 * es lo que le devuelve el tipo literal a la salida, y de paso detecta drift si alguna vez
 * entra un valor de `estado` que ya no es válido. */
function toSindicato(row: { id: string; nombre: string; estado: string }): Sindicato {
  return SindicatoSchema.parse(row);
}

/** Auditoría directa (RF-81..84 llega completo con el interceptor genérico de QUI-230) —
 * acá alcanza con dejar constancia de las acciones de este módulo sobre `audit_log`. */
async function auditar(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  accion: string,
  entidadId: string,
  diff: unknown,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      sindicatoId: actor.sindicatoId,
      usuarioId: actor.userId,
      entidad: 'sindicato',
      entidadId,
      accion,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}
