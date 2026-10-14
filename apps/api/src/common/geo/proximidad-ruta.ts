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
    SELECT (
      ST_DWithin(
        r.geometria,
        ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(coord)}), 4326)::geography,
        ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}
      )
      -- También vale estar sobre el TRAMO adicional de una variante activa de la ruta (p. ej.
      -- Molinos, al final del ramal Putucu: docs/plan-molinos-designacion.md).
      OR EXISTS (
        SELECT 1 FROM variantes v
        WHERE v."rutaId" = r.id AND v.estado = 'activo' AND v.geometria IS NOT NULL
          AND ST_DWithin(
            v.geometria,
            ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(coord)}), 4326)::geography,
            ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}
          )
      )
    ) as cerca
    FROM rutas r WHERE r.id = ${rutaId}
  `;
  if (!rows[0]?.cerca) {
    throw new BadRequestException(
      `El punto está a más de ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}m de la geometría de la ruta`,
    );
  }
}
