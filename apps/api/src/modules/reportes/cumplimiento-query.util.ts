import { Prisma } from '@quivo/db';
import type { AgrupacionCumplimiento } from '@quivo/shared';
import { inicioDeJornadaBolivia, inicioDeJornadaSiguienteBolivia } from '../../common/tiempo/jornada.js';

/**
 * CTE compartido entre `CumplimientoService.obtener` (el reporte en pantalla) y
 * `ExportesService.cumplimientoPorAgrupacion` (su exportación CSV) — RF-74..77/RF-78..80
 * (QUI-246/QUI-249). Viven acá para que el reporte y su export nunca puedan divergir en
 * los números que muestran: ambos arman el `WHERE`/`JOIN` una sola vez, la única diferencia
 * legítima entre los dos consumidores es la paginación (el export pagina, el reporte no).
 */

export const CLAVES_CUMPLIMIENTO: Record<AgrupacionCumplimiento, { id: Prisma.Sql; nombre: Prisma.Sql }> = {
  linea: { id: Prisma.sql`l.id`, nombre: Prisma.sql`l.nombre` },
  vehiculo: { id: Prisma.sql`v.id`, nombre: Prisma.sql`v.placa` },
  ruta: { id: Prisma.sql`r.id`, nombre: Prisma.sql`l.codigo || ' (' || r.sentido || ')'` },
};

export interface FilaCumplimientoRaw {
  id: string;
  nombre: string;
  puntos_cumplidos: bigint;
  puntos_totales: bigint;
  recorridos_asignados: bigint;
  recorridos_completados: bigint;
}

export interface RangoCumplimiento {
  desdeFecha: Date;
  hastaFecha: Date;
  desdeInstante: Date;
  hastaInstante: Date;
}

/**
 * `asignaciones.fecha` es una fecha operativa pura (`@db.Date`); los cumplimientos, en
 * cambio, son instantes. Cada uno requiere su propio límite para incluir el día calendario
 * boliviano completo sin desplazar las asignaciones al día anterior.
 */
export function rangoCumplimiento(desde: Date | undefined, hasta: Date | undefined): RangoCumplimiento {
  return {
    desdeFecha: desde ?? new Date(0),
    hastaFecha: hasta ?? new Date('9999-12-31'),
    desdeInstante: desde ? inicioDeJornadaBolivia(desde) : new Date(0),
    hastaInstante: hasta
      ? inicioDeJornadaSiguienteBolivia(hasta)
      : new Date('9999-12-31T23:59:59.999Z'),
  };
}

/**
 * Una sola query con CTEs: `base` fija el universo de agrupaciones (asignaciones del
 * período) y los `LEFT JOIN` traen los agregados con `COALESCE` a 0 — así una línea con
 * asignaciones pero sin ningún cumplimiento todavía no desaparece del reporte.
 *
 * `recorridos_completados` cuenta `DISTINCT a.id` (asignaciones), no `DISTINCT so.id`
 * (sesiones) — una asignación puede tener más de una `sesionOperativa` (reintentos: el
 * conductor cierra y reabre la app, o corta y retoma el recorrido), y contar sesiones
 * inflaba el completado por encima del asignado (ej. "3/2" en el dashboard, encontrado en
 * auditoría 2026-08-11 con datos reales de dispositivo).
 *
 * `paginacion` es opcional: el reporte en pantalla (`CumplimientoService`) trae todo el
 * resultado de una vez, mientras que la exportación CSV (`ExportesService`) pagina con
 * `LIMIT`/`OFFSET` para mantener cada transacción corta.
 */
export function consultarCumplimientoPorAgrupacion(
  tx: Prisma.TransactionClient,
  clave: { id: Prisma.Sql; nombre: Prisma.Sql },
  rango: RangoCumplimiento,
  paginacion?: { limit: number; offset: number },
): Promise<FilaCumplimientoRaw[]> {
  const { desdeFecha, hastaFecha, desdeInstante, hastaInstante } = rango;
  const limiteClause = paginacion
    ? Prisma.sql`LIMIT ${paginacion.limit} OFFSET ${paginacion.offset}`
    : Prisma.empty;

  return tx.$queryRaw<FilaCumplimientoRaw[]>`
    WITH base AS (
      SELECT DISTINCT ${clave.id} as id, ${clave.nombre} as nombre
      FROM asignaciones a
      JOIN vehiculos v ON v.id = a."vehiculoId"
      JOIN rutas r ON r.id = a."rutaId"
      JOIN lineas l ON l.id = r."lineaId"
      WHERE a.fecha >= ${desdeFecha} AND a.fecha <= ${hastaFecha}
    ),
    recorridos AS (
      SELECT ${clave.id} as id,
        COUNT(DISTINCT a.id) as recorridos_asignados,
        COUNT(DISTINCT a.id) FILTER (WHERE so.fin IS NOT NULL) as recorridos_completados
      FROM asignaciones a
      JOIN vehiculos v ON v.id = a."vehiculoId"
      JOIN rutas r ON r.id = a."rutaId"
      JOIN lineas l ON l.id = r."lineaId"
      LEFT JOIN sesiones_operativas so ON so."asignacionId" = a.id
      WHERE a.fecha >= ${desdeFecha} AND a.fecha <= ${hastaFecha}
      GROUP BY ${clave.id}
    ),
    puntos AS (
      SELECT ${clave.id} as id,
        COUNT(*) FILTER (WHERE cpc.cumplido) as puntos_cumplidos,
        COUNT(*) as puntos_totales
      FROM cumplimientos_pc cpc
      JOIN sesiones_operativas so ON so.id = cpc."sesionId"
      JOIN asignaciones a ON a.id = so."asignacionId"
      JOIN vehiculos v ON v.id = a."vehiculoId"
      JOIN rutas r ON r.id = a."rutaId"
      JOIN lineas l ON l.id = r."lineaId"
      WHERE cpc."validadoPor" = 'worker'
        AND cpc.ts >= ${desdeInstante} AND cpc.ts < ${hastaInstante}
      GROUP BY ${clave.id}
    )
    SELECT
      base.id, base.nombre,
      COALESCE(puntos.puntos_cumplidos, 0) as puntos_cumplidos,
      COALESCE(puntos.puntos_totales, 0) as puntos_totales,
      COALESCE(recorridos.recorridos_asignados, 0) as recorridos_asignados,
      COALESCE(recorridos.recorridos_completados, 0) as recorridos_completados
    FROM base
    LEFT JOIN recorridos ON recorridos.id = base.id
    LEFT JOIN puntos ON puntos.id = base.id
    ORDER BY base.nombre ASC
    ${limiteClause}
  `;
}
