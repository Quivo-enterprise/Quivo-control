import { Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  CumplimientoFilaSchema,
  type CumplimientoFila,
  type CumplimientoQuery,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import {
  CLAVES_CUMPLIMIENTO,
  consultarCumplimientoPorAgrupacion,
  rangoCumplimiento,
} from './cumplimiento-query.util.js';

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
 *
 * `recorridos_completados` cuenta `DISTINCT a.id` (asignaciones), no `DISTINCT so.id`
 * (sesiones) — una asignación puede tener más de una `sesionOperativa` (reintentos: el
 * conductor cierra y reabre la app, o corta y retoma el recorrido), y contar sesiones
 * inflaba el completado por encima del asignado (ej. "3/2" en el dashboard, encontrado en
 * auditoría 2026-08-11 con datos reales de dispositivo).
 */
@Injectable()
export class CumplimientoService {
  async obtener(actor: AuthenticatedUser, query: CumplimientoQuery): Promise<CumplimientoFila[]> {
    const clave = CLAVES_CUMPLIMIENTO[query.por];
    const rango = rangoCumplimiento(query.desde, query.hasta);

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await consultarCumplimientoPorAgrupacion(tx, clave, rango);

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
