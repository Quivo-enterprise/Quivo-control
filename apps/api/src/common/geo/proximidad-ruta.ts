import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@quivo/db';
import type { PuntoGeoJson } from '@quivo/shared';

/** Tolerancia de "cercanía a la ruta" para paradas y puntos de control (RF-24..39,
 * ST_DWithin) — no está especificada en el doc técnico, 100m es una asunción razonable
 * para un punto respecto de la geometría de su línea, no una decisión de Producto
 * confirmada. Ajustar acá si Producto define otra cosa (afecta a ambos módulos). */
export const RUTA_PROXIMIDAD_TOLERANCIA_METROS = 100;

export async function validarCercaniaARuta(
  tx: Prisma.TransactionClient,
  rutaId: string,
  coord: PuntoGeoJson,
): Promise<void> {
  const rows = await tx.$queryRaw<[{ cerca: boolean }]>`
    SELECT ST_DWithin(
      geometria,
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(coord)}), 4326)::geography,
      ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}
    ) as cerca
    FROM rutas WHERE id = ${rutaId}
  `;
  if (!rows[0]?.cerca) {
    throw new BadRequestException(
      `El punto está a más de ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}m de la geometría de la ruta`,
    );
  }
}
