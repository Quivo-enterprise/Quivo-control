import { BadRequestException, Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  JornadasDelDiaSchema,
  fechaActualBolivia,
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
  type EstadoJornada,
  type JornadasDelDia,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

interface JornadaRow {
  vehiculoId: string;
  placa: string;
  numeroInterno: string | null;
  conductorNombre: string | null;
  lineaId: string;
  lineaNombre: string;
  rutaSentido: string;
  horaSalida: Date | null;
  recorridoEstado: string | null;
  inicioJornadaTs: Date | null;
}

/**
 * Precedencia del estado de la jornada de un vehículo (release 13): el recorrido manda sobre
 * la declaración. `en_curso` → `en_recorrido`, `finalizado` → `finalizado`; sin recorrido, una
 * declaración `inicio_jornada` del día → `dia_iniciado`; si no hay nada → `sin_iniciar`.
 * `recorridoEstado` es el derivado de `sesiones_operativas` (ver `insertarEventoOperativoEnTx`).
 */
export function derivarEstadoJornada(
  recorridoEstado: string | null,
  inicioJornadaTs: Date | null,
): EstadoJornada {
  if (recorridoEstado === 'en_curso') return 'en_recorrido';
  if (recorridoEstado === 'finalizado') return 'finalizado';
  if (inicioJornadaTs) return 'dia_iniciado';
  return 'sin_iniciar';
}

/** `YYYY-MM-DD` → medianoche UTC de ese día (misma convención que `fechaActualBolivia`).
 * Rechaza fechas con forma válida pero inexistentes (p. ej. `2026-02-31`). */
function parsearFecha(fecha: string): Date {
  const date = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fecha) {
    throw new BadRequestException(`Fecha inválida: ${fecha}`);
  }
  return date;
}

/**
 * Release 13 — panel de jornadas: una fila por vehículo con asignación en la fecha pedida,
 * con su estado del día. Solo lectura; el aislamiento por sindicato lo da RLS vía
 * `withTenantContext`, igual que `EnVivoService`.
 */
@Injectable()
export class JornadasService {
  async listar(
    actor: AuthenticatedUser,
    fecha?: string,
    ahora: Date = new Date(),
  ): Promise<JornadasDelDia> {
    const dia = fecha ? parsearFecha(fecha) : fechaActualBolivia(ahora);
    // `YYYY-MM-DD` como literal de fecha, sin pasar un `Date` por el cast `::date` (que lo
    // interpretaría en la zona horaria de la sesión de Postgres) — mismo criterio que
    // `EnVivoService.listarHoy`.
    const diaStr = dia.toISOString().slice(0, 10);
    const desde = inicioDeJornadaBolivia(dia);
    const hasta = inicioDeJornadaSiguienteBolivia(dia);

    const filas = await withTenantContext(
      { rol: actor.rol, sindicatoId: actor.sindicatoId },
      (tx) => tx.$queryRaw<JornadaRow[]>`
        SELECT a."vehiculoId" AS "vehiculoId", v.placa, v."numeroInterno" AS "numeroInterno",
          c.nombre AS "conductorNombre", l.id AS "lineaId", l.nombre AS "lineaNombre",
          ru.sentido AS "rutaSentido", a."horaSalida" AS "horaSalida",
          rs."recorridoEstado" AS "recorridoEstado", ij.ts AS "inicioJornadaTs"
        FROM (
          -- Un vehículo con varios turnos el mismo día cuenta una sola vez: el de salida más
          -- temprana (sin hora de salida, al final).
          SELECT DISTINCT ON (a0."vehiculoId")
            a0."vehiculoId", a0."conductorId", a0."rutaId", a0."horaSalida"
          FROM asignaciones a0
          WHERE a0.fecha = ${diaStr}::date
          ORDER BY a0."vehiculoId", a0."horaSalida" ASC NULLS LAST, a0.orden ASC
        ) a
        JOIN vehiculos v ON v.id = a."vehiculoId"
        LEFT JOIN conductores c ON c.id = a."conductorId"
        JOIN rutas ru ON ru.id = a."rutaId"
        JOIN lineas l ON l.id = ru."lineaId"
        LEFT JOIN LATERAL (
          -- Última declaración "hoy trabajo" del vehículo dentro de la jornada boliviana.
          SELECT eo.ts
          FROM eventos_operativos eo
          JOIN sesiones_operativas so ON so.id = eo."sesionId"
          WHERE eo."sindicatoId" = v."sindicatoId" AND eo.tipo = 'inicio_jornada'
            AND eo.ts >= ${desde} AND eo.ts < ${hasta}
            AND so."vehiculoId" = a."vehiculoId"
          ORDER BY eo.ts DESC
          LIMIT 1
        ) ij ON true
        LEFT JOIN LATERAL (
          -- Estado derivado del recorrido más reciente del vehículo en esa jornada.
          SELECT so."recorridoEstado"
          FROM sesiones_operativas so
          WHERE so."vehiculoId" = a."vehiculoId" AND so."sindicatoId" = v."sindicatoId"
            AND so."recorridoEstadoTs" >= ${desde} AND so."recorridoEstadoTs" < ${hasta}
          ORDER BY so."recorridoEstadoTs" DESC
          LIMIT 1
        ) rs ON true
        ORDER BY v.placa
      `,
    );

    return JornadasDelDiaSchema.parse({
      fecha: diaStr,
      vehiculos: filas.map((f) => ({
        vehiculoId: f.vehiculoId,
        placa: f.placa,
        numeroInterno: f.numeroInterno,
        conductorNombre: f.conductorNombre,
        lineaId: f.lineaId,
        lineaNombre: f.lineaNombre,
        rutaSentido: f.rutaSentido,
        horaSalida: f.horaSalida ? f.horaSalida.toISOString() : null,
        estado: derivarEstadoJornada(f.recorridoEstado, f.inicioJornadaTs),
        inicioJornadaTs: f.inicioJornadaTs ? f.inicioJornadaTs.toISOString() : null,
      })),
    });
  }
}
