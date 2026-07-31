import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { VarianteSchema, type ActualizarVariante, type CrearVariante, type Variante } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';

/** Sin geometría propia (ver packages/shared/src/entities/variante.ts) — CRUD normal vía
 * Prisma Client. Tenant-scoping igual que rutas: resuelve hacia arriba hasta `linea`. */
@Injectable()
export class VariantesService {
  async listarPorRuta(actor: AuthenticatedUser, rutaId: string): Promise<Variante[]> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      const rows = await tx.variante.findMany({ where: { rutaId }, orderBy: { nombre: 'asc' } });
      return rows.map((row) => VarianteSchema.parse(row));
    });
  }

  async crear(actor: AuthenticatedUser, rutaId: string, data: CrearVariante): Promise<Variante> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const ruta = await asegurarRutaVisible(tx, rutaId);
      const creada = await tx.variante.create({ data: { ...data, rutaId } });
      await auditar(tx, actor, 'crear', creada.id, ruta.sindicatoId, data);
      return VarianteSchema.parse(creada);
    });
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarVariante): Promise<Variante> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const anterior = await tx.variante.findUnique({ where: { id } });
      if (!anterior) {
        throw new NotFoundException('Variante no encontrada');
      }
      const ruta = await asegurarRutaVisible(tx, anterior.rutaId);
      const actualizada = await tx.variante.update({ where: { id }, data });
      await auditar(tx, actor, 'editar', id, ruta.sindicatoId, { antes: anterior, cambios: data });
      return VarianteSchema.parse(actualizada);
    });
  }
}

async function auditar(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  accion: string,
  entidadId: string,
  sindicatoId: string,
  diff: unknown,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      sindicatoId,
      usuarioId: actor.userId,
      entidad: 'variante',
      entidadId,
      accion,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}
