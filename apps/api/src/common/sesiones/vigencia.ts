import { Prisma } from '@quivo/db';
import { inicioDeJornadaBolivia } from '../tiempo/jornada.js';

const MINUTO_MS = 60_000;

/**
 * Gracia al cruzar medianoche: un turno de anoche que sigue vivo (lag de ingesta de hasta
 * ~71 min medido, pérdida de señal, o backlog cuyos fixes son todos de antes de medianoche)
 * no desaparece justo a las 00:00.
 */
export const GRACIA_ACTIVIDAD_MEDIANOCHE_MS = 2 * 60 * MINUTO_MS;

/**
 * Predicado WHERE único de sesiones visibles ("vigentes"). Fuente única de verdad: la usan el mapa
 * en vivo, el panel de jornadas, la fila de salida y el resumen de flota de Molinos. Alias de
 * `sesiones_operativas`: `so`.
 *
 * Regla: entra la sesión que arrancó en la jornada boliviana de hoy (`so.inicio >= trazaDesde`) O
 * que tiene actividad (`GREATEST(ultimo_fix_ts, ultimo_ingreso_ts)`) de hoy o de las últimas
 * `GRACIA_ACTIVIDAD_MEDIANOCHE_MS`. Una sesión abierta sin actividad de hoy ni de la gracia (la app
 * no cierra sesión al "Finalizar recorrido") es un zombi de un día previo y NO entra; una cerrada
 * ayer tampoco. Al leer solo se ocultan; el cierre real lo hace el job de vencimiento
 * (`RotacionesService.cerrarSesionesVencidas`): pasadas `venceAt` + 4 h sin GPS en las últimas 2 h, o 3 h
 * sin actividad desde `inicio` (aunque la asignación siga vigente).
 *
 * El conjunto "con actividad reciente" es una
 * subquery NO correlacionada (`(id, sindicatoId) IN (...)`: semi-join por hash, sin evaluar
 * un EXISTS por cada fila histórica de `sesiones_operativas`); `sesion_id` se castea del
 * lado de la subquery (`::text`) para no tocar `so.id` y conservar su índice. El par
 * `(id, sindicatoId)` mantiene el aislamiento por tenant que tenían los LATERAL: una fila
 * de resumen de OTRO tenant no hace visible la sesión, ni siquiera como admin_quivo.
 * Sin cota superior en `so.inicio` en ambos: una sesión no arranca en el futuro.
 *
 * shortcut: sin índice en `gps_sesion_resumen(jornada)` ni `sesiones_operativas(inicio)`; la regla corre en cada
 * poll (en-vivo 2 s, vuelta-actual). Agregar ambos índices cuando el p95 de vuelta-actual se acerque a los 150 ms
 * anotados en `fila-datos.ts`.
 */
export function sesionesVisiblesSql(ahora: Date, jornada: Date): Prisma.Sql {
  const trazaDesde = inicioDeJornadaBolivia(jornada);
  const desdeActividad = new Date(
    Math.min(trazaDesde.getTime(), ahora.getTime() - GRACIA_ACTIVIDAD_MEDIANOCHE_MS),
  );
  const jornadaStr = jornada.toISOString().slice(0, 10);
  const jornadaAyerStr = new Date(jornada.getTime() - 24 * 60 * MINUTO_MS)
    .toISOString()
    .slice(0, 10);
  return Prisma.sql`(so.inicio >= ${trazaDesde}
    OR (so.id, so."sindicatoId") IN (
      SELECT gx.sesion_id::text, gx."sindicatoId" FROM gps_sesion_resumen gx
      WHERE gx.jornada IN (${jornadaStr}::date, ${jornadaAyerStr}::date)
        AND GREATEST(gx.ultimo_fix_ts, gx.ultimo_ingreso_ts) >= ${desdeActividad}
    ))`;
}

/**
 * Sesión vigente en una jornada PASADA `jornada`: tuvo actividad GPS registrada ese día (alias `so`).
 * Misma forma/tenant que `sesionesVisiblesSql` (cast del lado de la subquery, par `(id, sindicatoId)`).
 */
export function sesionConActividadEnJornadaSql(jornada: Date): Prisma.Sql {
  const jornadaStr = jornada.toISOString().slice(0, 10);
  return Prisma.sql`((so.id, so."sindicatoId") IN (
      SELECT gx.sesion_id::text, gx."sindicatoId" FROM gps_sesion_resumen gx
      WHERE gx.jornada = ${jornadaStr}::date
    ))`;
}
