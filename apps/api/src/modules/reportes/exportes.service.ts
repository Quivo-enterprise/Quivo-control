import { Injectable } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import type {
  AgrupacionActividad,
  CumplimientoQuery,
  ExportarActividadQuery,
  ExportarRecorridosQuery,
  ExportarSancionesQuery,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import {
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
} from '../../common/tiempo/jornada.js';
import {
  CLAVES_CUMPLIMIENTO,
  consultarCumplimientoPorAgrupacion,
  rangoCumplimiento,
} from './cumplimiento-query.util.js';

const TAMANO_PAGINA = 500;

interface RecorridoExportRow {
  inicio: Date;
  fin: Date | null;
  lineaNombre: string;
  vehiculoPlaca: string;
  conductorNombre: string;
  estado: string;
  puntosCumplidos: bigint;
  puntosTotales: bigint;
}

interface SancionExportRow {
  fechaHecho: Date;
  reglaNombre: string;
  sujetoTipo: string;
  sujetoId: string;
  motivo: string;
  estado: string;
}

interface ActividadExportRow {
  id: string;
  nombre: string;
  recorridos: bigint;
  horasOperadas: number;
  puntosCumplidos: bigint;
  puntosTotales: bigint;
}

/**
 * RF-78..80 (QUI-249): 3 reportes exportables (recorridos por periodo, sanciones por
 * sujeto/estado, actividad por vehículo/conductor). "Streaming para volúmenes grandes": cada
 * página se pide en su propia `withTenantContext` (transacción corta) en vez de una sola
 * transacción abierta durante todo el export — el timeout por defecto de una transacción
 * interactiva de Prisma es 5s, y un export grande puede tardar más que eso en total; paginar
 * con transacciones independientes mantiene cada una bien por debajo del límite sin importar
 * cuántas filas tenga el reporte completo. RLS sigue aplicando en cada página (mismo
 * `rol`/`sindicatoId` del actor).
 */
@Injectable()
export class ExportesService {
  async *cumplimientoPorAgrupacion(
    actor: AuthenticatedUser,
    query: CumplimientoQuery,
  ): AsyncGenerator<(string | number | boolean | null)[]> {
    const clave = CLAVES_CUMPLIMIENTO[query.por];
    const rango = rangoCumplimiento(query.desde, query.hasta);

    for (let offset = 0; ; offset += TAMANO_PAGINA) {
      const filas = await withTenantContext(
        { rol: actor.rol, sindicatoId: actor.sindicatoId },
        (tx) => consultarCumplimientoPorAgrupacion(tx, clave, rango, { limit: TAMANO_PAGINA, offset }),
      );
      for (const f of filas) {
        const puntosTotales = Number(f.puntos_totales);
        const puntosCumplidos = Number(f.puntos_cumplidos);
        const porcentaje = puntosTotales > 0 ? (puntosCumplidos / puntosTotales) * 100 : 0;
        yield [
          f.id,
          f.nombre,
          puntosCumplidos,
          puntosTotales,
          Number(porcentaje.toFixed(2)),
          Number(f.recorridos_asignados),
          Number(f.recorridos_completados),
        ];
      }
      if (filas.length < TAMANO_PAGINA) return;
    }
  }

  async *recorridosPorPeriodo(
    actor: AuthenticatedUser,
    query: ExportarRecorridosQuery,
  ): AsyncGenerator<(string | number | boolean | null)[]> {
    const desde = query.desde;
    const hasta = query.hasta;
    const desdeInstante = desde ? inicioDeJornadaBolivia(desde) : new Date(0);
    const hastaInstante = hasta
      ? inicioDeJornadaSiguienteBolivia(hasta)
      : new Date('9999-12-31T23:59:59.999Z');

    for (let offset = 0; ; offset += TAMANO_PAGINA) {
      const filas: RecorridoExportRow[] = await withTenantContext(
        { rol: actor.rol, sindicatoId: actor.sindicatoId },
        (tx) =>
          tx.$queryRaw<RecorridoExportRow[]>`
            SELECT so.inicio, so.fin, l.nombre as "lineaNombre", v.placa as "vehiculoPlaca",
              c.nombre as "conductorNombre", so.estado,
              COALESCE(cp.cumplidos, 0) as "puntosCumplidos", COALESCE(cp.totales, 0) as "puntosTotales"
            FROM sesiones_operativas so
            JOIN vehiculos v ON v.id = so."vehiculoId"
            JOIN conductores c ON c.id = so."conductorId"
            JOIN asignaciones a ON a.id = so."asignacionId"
            JOIN rutas r ON r.id = a."rutaId"
            JOIN lineas l ON l.id = r."lineaId"
            LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE cpc.cumplido) as cumplidos, COUNT(*) as totales
              FROM cumplimientos_pc cpc
              WHERE cpc."sesionId" = so.id AND cpc."validadoPor" = 'worker'
            ) cp ON true
            WHERE so.inicio >= ${desdeInstante} AND so.inicio < ${hastaInstante}
            ORDER BY so.inicio DESC, so.id ASC
            LIMIT ${TAMANO_PAGINA} OFFSET ${offset}
          `,
      );
      for (const f of filas) {
        yield [
          f.inicio.toISOString(),
          f.fin?.toISOString() ?? '',
          f.lineaNombre,
          f.vehiculoPlaca,
          f.conductorNombre,
          f.estado,
          Number(f.puntosCumplidos),
          Number(f.puntosTotales),
        ];
      }
      if (filas.length < TAMANO_PAGINA) return;
    }
  }

  async *sancionesPorSujetoEstado(
    actor: AuthenticatedUser,
    query: ExportarSancionesQuery,
  ): AsyncGenerator<(string | number | boolean | null)[]> {
    const desde = query.desde ?? new Date(0);
    const hasta = query.hasta ?? new Date('9999-12-31');
    const estado = query.estado ?? null;
    const sujetoTipo = query.sujetoTipo ?? null;

    for (let offset = 0; ; offset += TAMANO_PAGINA) {
      const filas: SancionExportRow[] = await withTenantContext(
        { rol: actor.rol, sindicatoId: actor.sindicatoId },
        (tx) =>
          tx.$queryRaw<SancionExportRow[]>`
            SELECT s."fechaHecho", r.nombre as "reglaNombre", s."sujetoTipo", s."sujetoId",
              s.motivo, s.estado
            FROM sanciones s
            JOIN reglas r ON r.id = s."reglaId"
            WHERE s."fechaHecho" >= ${desde} AND s."fechaHecho" <= ${hasta}
              AND (${estado}::text IS NULL OR s.estado = ${estado})
              AND (${sujetoTipo}::text IS NULL OR s."sujetoTipo" = ${sujetoTipo})
            ORDER BY s."fechaHecho" DESC, s.id ASC
            LIMIT ${TAMANO_PAGINA} OFFSET ${offset}
          `,
      );
      for (const f of filas) {
        yield [
          f.fechaHecho.toISOString().slice(0, 10),
          f.reglaNombre,
          f.sujetoTipo,
          f.sujetoId,
          f.motivo,
          f.estado,
        ];
      }
      if (filas.length < TAMANO_PAGINA) return;
    }
  }

  async *actividadPorVehiculoConductor(
    actor: AuthenticatedUser,
    query: ExportarActividadQuery,
  ): AsyncGenerator<(string | number | boolean | null)[]> {
    const desde = query.desde;
    const hasta = query.hasta;
    const desdeInstante = desde ? inicioDeJornadaBolivia(desde) : new Date(0);
    const hastaInstante = hasta
      ? inicioDeJornadaSiguienteBolivia(hasta)
      : new Date('9999-12-31T23:59:59.999Z');
    const clave = agrupacionAActividadSql(query.por);

    for (let offset = 0; ; offset += TAMANO_PAGINA) {
      const filas: ActividadExportRow[] = await withTenantContext(
        { rol: actor.rol, sindicatoId: actor.sindicatoId },
        (tx) =>
          tx.$queryRaw<ActividadExportRow[]>`
            SELECT ${clave.id} as id, ${clave.nombre} as nombre,
              COUNT(DISTINCT so.id) as recorridos,
              COALESCE(SUM(EXTRACT(EPOCH FROM (so.fin - so.inicio)) / 3600.0) FILTER (WHERE so.fin IS NOT NULL), 0) as "horasOperadas",
              COALESCE(SUM(cp.cumplidos), 0) as "puntosCumplidos", COALESCE(SUM(cp.totales), 0) as "puntosTotales"
            FROM sesiones_operativas so
            JOIN vehiculos v ON v.id = so."vehiculoId"
            JOIN conductores c ON c.id = so."conductorId"
            LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE cpc.cumplido) as cumplidos, COUNT(*) as totales
              FROM cumplimientos_pc cpc
              WHERE cpc."sesionId" = so.id AND cpc."validadoPor" = 'worker'
            ) cp ON true
            WHERE so.inicio >= ${desdeInstante} AND so.inicio < ${hastaInstante}
            GROUP BY ${clave.id}, ${clave.nombre}
            ORDER BY ${clave.nombre} ASC
            LIMIT ${TAMANO_PAGINA} OFFSET ${offset}
          `,
      );
      for (const f of filas) {
        yield [
          f.id,
          f.nombre,
          Number(f.recorridos),
          Number(f.horasOperadas.toFixed(2)),
          Number(f.puntosCumplidos),
          Number(f.puntosTotales),
        ];
      }
      if (filas.length < TAMANO_PAGINA) return;
    }
  }
}

function agrupacionAActividadSql(por: AgrupacionActividad): { id: Prisma.Sql; nombre: Prisma.Sql } {
  return por === 'vehiculo'
    ? { id: Prisma.sql`v.id`, nombre: Prisma.sql`v.placa` }
    : { id: Prisma.sql`c.id`, nombre: Prisma.sql`c.nombre` };
}
