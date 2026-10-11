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
import { DRIFT_ALERTA_MS } from '../ingesta-worker/ingesta-drift.js';

interface JornadaRow {
  vehiculoId: string;
  placa: string;
  numeroInterno: string | null;
  conductorNombre: string | null;
  lineaId: string;
  lineaNombre: string;
  rutaSentido: string;
  horaSalida: Date | null;
  /** `tipo` del último `inicio_recorrido`/`fin_recorrido` del vehículo en la jornada. */
  ultimoEventoRecorrido: string | null;
  inicioJornadaTs: Date | null;
}

/**
 * Precedencia del estado de la jornada de un vehículo (release 13): el recorrido manda sobre
 * la declaración. El último evento de recorrido del día decide: `inicio_recorrido` →
 * `en_recorrido`, `fin_recorrido` → `finalizado`; sin recorrido, una declaración
 * `inicio_jornada` del día → `dia_iniciado`; si no hay nada → `sin_iniciar`.
 *
 * Se deriva de las filas persistidas de `eventos_operativos` y NO de
 * `sesiones_operativas.recorridoEstado`: esa columna es el último estado de la sesión y se
 * pisa con cada evento nuevo, así que no sirve para consultar días anteriores (una sesión
 * puede cruzar medianoche o reutilizarse otro día).
 */
export function derivarEstadoJornada(
  ultimoEventoRecorrido: string | null,
  inicioJornadaTs: Date | null,
): EstadoJornada {
  if (ultimoEventoRecorrido === 'inicio_recorrido') return 'en_recorrido';
  if (ultimoEventoRecorrido === 'fin_recorrido') return 'finalizado';
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
    const toleranciaFuturoS = DRIFT_ALERTA_MS / 1000;

    const filas = await withTenantContext(
      { rol: actor.rol, sindicatoId: actor.sindicatoId },
      (tx) => tx.$queryRaw<JornadaRow[]>`
        SELECT a."vehiculoId" AS "vehiculoId", v.placa, v."numeroInterno" AS "numeroInterno",
          c.nombre AS "conductorNombre", l.id AS "lineaId", l.nombre AS "lineaNombre",
          ru.sentido AS "rutaSentido", a."horaSalida" AS "horaSalida",
          rs.tipo AS "ultimoEventoRecorrido", ij.ts AS "inicioJornadaTs"
        FROM (
          -- Un vehículo con varios turnos el mismo día cuenta una sola vez: el de salida más
          -- temprana (sin hora de salida, al final).
          SELECT DISTINCT ON (a0."vehiculoId")
            a0."vehiculoId", a0."conductorId", a0."rutaId", a0."horaSalida"
          FROM asignaciones a0
          -- Solo rotaciones publicadas, igual que el login móvil (auth-movil.service.ts):
          -- un borrador no es trabajo esperado. No se filtra estado vigente ni
          -- venceAt (el login sí) porque acá se consultan también días pasados, cuyas
          -- asignaciones ya están vencidas.
          JOIN rotaciones ro ON ro.id = a0."rotacionId" AND ro.estado = 'publicada'
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
            -- Mismo criterio de elegibilidad que la ingesta: el evento tiene que venir del
            -- dispositivo dueño de la sesión y del mismo sindicato (el sesionId del payload lo
            -- controla el dispositivo), y su ts no puede estar adelantado más que la
            -- tolerancia de drift respecto de cuando se recibió (el worker no mueve el estado
            -- en ese caso, pero la fila queda en la bitácora).
            AND eo."deviceId" = so."deviceId" AND eo."sindicatoId" = so."sindicatoId"
          WHERE eo."sindicatoId" = v."sindicatoId" AND eo.tipo = 'inicio_jornada'
            AND eo.ts >= ${desde} AND eo.ts < ${hasta}
            AND eo.ts <= eo."receivedAt" + make_interval(secs => ${toleranciaFuturoS}::double precision)
            AND so."vehiculoId" = a."vehiculoId"
          ORDER BY eo.ts DESC
          LIMIT 1
        ) ij ON true
        LEFT JOIN LATERAL (
          -- Último evento de recorrido del vehículo dentro de la jornada, desde la bitácora
          -- (no desde sesiones_operativas.recorridoEstado, que se pisa con cada evento).
          SELECT eo.tipo
          FROM eventos_operativos eo
          JOIN sesiones_operativas so ON so.id = eo."sesionId"
            -- Mismo criterio de elegibilidad que la ingesta: el evento tiene que venir del
            -- dispositivo dueño de la sesión y del mismo sindicato (el sesionId del payload lo
            -- controla el dispositivo), y su ts no puede estar adelantado más que la
            -- tolerancia de drift respecto de cuando se recibió (el worker no mueve el estado
            -- en ese caso, pero la fila queda en la bitácora).
            AND eo."deviceId" = so."deviceId" AND eo."sindicatoId" = so."sindicatoId"
          WHERE eo."sindicatoId" = v."sindicatoId"
            AND eo.tipo IN ('inicio_recorrido', 'fin_recorrido')
            AND eo.ts >= ${desde} AND eo.ts < ${hasta}
            AND eo.ts <= eo."receivedAt" + make_interval(secs => ${toleranciaFuturoS}::double precision)
            AND so."vehiculoId" = a."vehiculoId"
          ORDER BY eo.ts DESC
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
        estado: derivarEstadoJornada(f.ultimoEventoRecorrido, f.inicioJornadaTs),
        inicioJornadaTs: f.inicioJornadaTs ? f.inicioJornadaTs.toISOString() : null,
      })),
    });
  }
}
