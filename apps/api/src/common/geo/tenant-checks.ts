import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@quivo/db';

/**
 * `rutas`/`variantes`/`paradas`/`puntos_control` no tienen RLS propia (QUI-218 — heredan
 * `sindicatoId` transitivamente vía `lineaId`, sin columna directa). La barrera de tenant
 * para todas ellas es la misma: resolver hacia arriba hasta `linea` (que sí tiene RLS) y
 * dejar que esa lectura decida. Si no es visible para el actor, se trata como inexistente
 * (404), nunca 403 — no revela que el recurso existe en otro tenant.
 */
export async function asegurarLineaVisible(
  tx: Prisma.TransactionClient,
  lineaId: string,
): Promise<{ id: string; sindicatoId: string }> {
  const linea = await tx.linea.findUnique({ where: { id: lineaId } });
  if (!linea) {
    throw new NotFoundException('Línea no encontrada');
  }
  return linea;
}

export async function asegurarRutaVisible(
  tx: Prisma.TransactionClient,
  rutaId: string,
): Promise<{ id: string; lineaId: string; sindicatoId: string }> {
  const ruta = await tx.ruta.findUnique({ where: { id: rutaId } });
  if (!ruta) {
    throw new NotFoundException('Ruta no encontrada');
  }
  const linea = await asegurarLineaVisible(tx, ruta.lineaId);
  return { id: ruta.id, lineaId: ruta.lineaId, sindicatoId: linea.sindicatoId };
}
