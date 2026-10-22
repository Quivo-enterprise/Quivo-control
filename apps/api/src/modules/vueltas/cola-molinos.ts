import { Prisma } from '@quivo/db';
import { MOLINOS_ESPERA_PENDIENTE_MAX_H, UMBRAL_VECINO_FRESCO_MS } from '@quivo/shared';

export interface EntradaColaMolinos {
  puntoEsperaId: string;
  vueltaId: string;
  esperaLlegadaTs: Date;
  sesionId: string;
  vehiculoId: string;
  placa: string;
  lineaId: string;
  lineaNombre: string;
  /** 1 = el primero en llegar (empate: id de vuelta). */
  posicion: number;
}

/**
 * ÚNICA fuente de la cola de Molinos (la usan `vuelta-actual` del chofer y el resumen del panel):
 * vueltas en curso agrupadas por el punto de espera de su variante, llegadas y sin salir. Solo
 * cuentan las que el worker todavía puede cerrar (llegada dentro de `MOLINOS_ESPERA_PENDIENTE_MAX_H`)
 * y cuya sesión sigue activa con un fix reciente: un teléfono muerto o sin GPS no traba a los de
 * atrás. Orden de llegada; informativo, no bloquea nada. `sindicatoId` null = sin filtro (RLS).
 * `varianteId` (opcional) = solo la cola del punto de espera de esa variante (se resuelve en SQL).
 */
export async function leerColaMolinos(
  tx: Prisma.TransactionClient,
  sindicatoId: string | null,
  ahora: Date,
  varianteId: string | null = null,
): Promise<EntradaColaMolinos[]> {
  const llegadaMinima = new Date(ahora.getTime() - MOLINOS_ESPERA_PENDIENTE_MAX_H * 3_600_000);
  const fixDesde = new Date(ahora.getTime() - UMBRAL_VECINO_FRESCO_MS);
  // Un fix fresco (EXISTS de abajo) ya implica sesión vigente según `sesionesVisiblesSql`: no se repite.
  const filtroPunto = varianteId
    ? Prisma.sql`AND ov."puntoEsperaId" = (SELECT vp."puntoEsperaId" FROM variantes vp WHERE vp.id = ${varianteId})`
    : Prisma.empty;
  const filtroTenant = sindicatoId ? Prisma.sql`AND o."sindicatoId" = ${sindicatoId}` : Prisma.empty;
  return tx.$queryRaw<EntradaColaMolinos[]>`
    SELECT ov."puntoEsperaId" AS "puntoEsperaId", o.id AS "vueltaId", o."esperaLlegadaTs" AS "esperaLlegadaTs",
           o."sesionId" AS "sesionId", os."vehiculoId" AS "vehiculoId", ve.placa AS placa,
           l.id AS "lineaId", l.nombre AS "lineaNombre",
           (row_number() OVER (PARTITION BY ov."puntoEsperaId" ORDER BY o."esperaLlegadaTs", o.id))::int AS posicion
    FROM vueltas o
    JOIN variantes ov ON ov.id = o."varianteId"
    JOIN rutas ru ON ru.id = ov."rutaId"
    JOIN lineas l ON l.id = ru."lineaId"
    JOIN sesiones_operativas os ON os.id = o."sesionId" AND os.estado = 'activa' AND os.fin IS NULL
                                 AND os."recorridoEstado" IS DISTINCT FROM 'finalizado'
    JOIN vehiculos ve ON ve.id = os."vehiculoId"
    WHERE ov."puntoEsperaId" IS NOT NULL
      ${filtroPunto}
      ${filtroTenant}
      AND o.estado = 'en_curso'
      AND o."esperaSalidaTs" IS NULL
      AND o."esperaLlegadaTs" >= ${llegadaMinima}
      AND EXISTS (
        SELECT 1 FROM gps_sesion_resumen gr
        WHERE gr.sesion_id = o."sesionId"::uuid AND gr."sindicatoId" = o."sindicatoId"
          AND gr.ultimo_fix_ts >= ${fixDesde}
      )
    ORDER BY ov."puntoEsperaId", posicion
  `;
}
