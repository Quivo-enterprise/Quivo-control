import type { Prisma } from '@quivo/db';
import type { VarianteTramo } from '@quivo/shared';

/** Tramos adicionales de las variantes activas de una ruta (los que tienen geometría propia). */
export async function leerVariantesTramo(
  tx: Prisma.TransactionClient,
  rutaId: string,
): Promise<VarianteTramo[]> {
  const filas = await tx.$queryRaw<{ id: string; nombre: string; geometria: string }[]>`
    SELECT id, nombre, ST_AsGeoJSON(geometria) AS geometria FROM variantes
    WHERE "rutaId" = ${rutaId} AND estado = 'activo' AND geometria IS NOT NULL
    ORDER BY "createdAt" ASC
  `;
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, geometria: JSON.parse(f.geometria) }));
}
