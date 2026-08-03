import { Injectable } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  CumplimientoFilaSchema,
  type AgrupacionCumplimiento,
  type CumplimientoFila,
  type CumplimientoQuery,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

interface FilaCumplimiento {
  id: string;
  nombre: string;
  puntos_cumplidos: bigint;
  puntos_totales: bigint;
  recorridos_asignados: bigint;
  recorridos_completados: bigint;
}

const CLAVES: Record<AgrupacionCumplimiento, { id: Prisma.Sql; nombre: Prisma.Sql }> = {
  linea: { id: Prisma.sql`l.id`, nombre: Prisma.sql`l.nombre` },
  vehiculo: { id: Prisma.sql`v.id`, nombre: Prisma.sql`v.placa` },
  ruta: { id: Prisma.sql`r.id`, nombre: Prisma.sql`l.codigo || ' (' || r.sentido || ')'` },
};

/**
 * RF-74..77 (QUI-246): % de puntos de control cumplidos y recorridos completados vs
 * asignados, agrupado por línea/vehículo/ruta. `cumplimientos_pc`/`sesiones_operativas`
 * tienen RLS propia (QUI-241/QUI-218); `asignaciones`/`rutas` no (QUI-218, la heredan vía
 * `vehiculos`/`lineas`) — el join a esas dos tablas con RLS es la barrera real acá, mismo
 * patrón que el resto del código que consulta geometría/asignaciones sin RLS directa.
 *
 * Fuente de verdad de "cumplido": `validado_por = 'worker'` (RF-39) — el reporte del app
 * (QUI-239) es solo feedback local, no se usa para las métricas del dashboard.
 *
 * Una sola query con CTEs: `base` fija el universo de agrupaciones (asignaciones del
 * período) y los `LEFT JOIN` traen los agregados con `COALESCE` a 0 — así una línea con
 * asignaciones pero sin ningún cumplimiento todavía no desaparece del reporte.
 */
@Injectable()
export class CumplimientoService {
  async obtener(actor: AuthenticatedUser, query: CumplimientoQuery): Promise<CumplimientoFila[]> {
    const clave = CLAVES[query.por];
    const desde = query.desde ?? new Date(0);
    const hasta = query.hasta ?? new Date('9999-12-31');

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await tx.$queryRaw<FilaCumplimiento[]>`
        WITH base AS (
          SELECT DISTINCT ${clave.id} as id, ${clave.nombre} as nombre
          FROM asignaciones a
          JOIN vehiculos v ON v.id = a."vehiculoId"
          JOIN rutas r ON r.id = a."rutaId"
          JOIN lineas l ON l.id = r."lineaId"
          WHERE a.fecha >= ${desde} AND a.fecha <= ${hasta}
        ),
        recorridos AS (
          SELECT ${clave.id} as id,
            COUNT(DISTINCT a.id) as recorridos_asignados,
            COUNT(DISTINCT so.id) FILTER (WHERE so.fin IS NOT NULL) as recorridos_completados
          FROM asignaciones a
          JOIN vehiculos v ON v.id = a."vehiculoId"
          JOIN rutas r ON r.id = a."rutaId"
          JOIN lineas l ON l.id = r."lineaId"
          LEFT JOIN sesiones_operativas so ON so."asignacionId" = a.id
          WHERE a.fecha >= ${desde} AND a.fecha <= ${hasta}
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
          WHERE cpc."validadoPor" = 'worker' AND cpc.ts >= ${desde} AND cpc.ts <= ${hasta}
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
      `;

      return filas.map((f) => {
        const puntosTotales = Number(f.puntos_totales);
        const puntosCumplidos = Number(f.puntos_cumplidos);
        return CumplimientoFilaSchema.parse({
          id: f.id,
          nombre: f.nombre,
          puntosCumplidos,
          puntosTotales,
          porcentajeCumplimiento: puntosTotales > 0 ? (puntosCumplidos / puntosTotales) * 100 : 0,
          recorridosAsignados: Number(f.recorridos_asignados),
          recorridosCompletados: Number(f.recorridos_completados),
        });
      });
    });
  }
}
