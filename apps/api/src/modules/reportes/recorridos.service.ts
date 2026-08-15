import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  RecorridoDetalleSchema,
  RecorridoResumenSchema,
  type RecorridoDetalle,
  type RecorridoResumen,
  type RecorridosQuery,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import {
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
} from '../../common/tiempo/jornada.js';

interface RutaGeomRow {
  id: string;
  geometria: string; // GeoJSON como texto — ST_AsGeoJSON devuelve `text`, no JSON nativo.
}

interface PuntoControlRow {
  id: string;
  orden: number;
  coord: string;
  radioToleranciaM: number;
}

interface GpsPointRow {
  ts: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
}

interface ResumenRow {
  id: string;
  inicio: Date;
  fin: Date | null;
  estado: string;
  vehiculoPlaca: string;
  conductorNombre: string;
  lineaNombre: string;
}

/**
 * RNF-24 (QUI-247): reconstrucción completa de una sesión operativa — traza GPS real
 * (`gps_points`, particionada, fuera del Client de Prisma — mismo criterio que las columnas
 * GEOGRAPHY, ver comentario en `schema.prisma`) contra la geometría de la ruta asignada,
 * puntos de control con tolerancia, cumplimientos (app vs worker, RF-39) y timeline de
 * `eventos_operativos`.
 *
 * `gps_points`/`eventos_operativos`/`puntos_control` no tienen `sindicatoId` propio — el
 * tenant-check real es el `findUnique` de `sesionOperativa` (RLS, QUI-218) al principio: si
 * la sesión no es visible para el actor, 404 antes de tocar cualquier otra tabla, mismo
 * patrón que `common/geo/tenant-checks.ts`.
 */
const parseDate = (d: unknown) => (typeof d === 'string' ? new Date(d) : (d as Date));

@Injectable()
export class RecorridosService {
  async listar(actor: AuthenticatedUser, query: RecorridosQuery): Promise<RecorridoResumen[]> {
    const desde = query.desde ? parseDate(query.desde) : undefined;
    const hasta = query.hasta ? parseDate(query.hasta) : undefined;
    const desdeInstante = desde ? inicioDeJornadaBolivia(desde) : new Date(0);
    const hastaInstante = hasta
      ? inicioDeJornadaSiguienteBolivia(hasta)
      : new Date('9999-12-31T23:59:59.999Z');

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await tx.$queryRaw<ResumenRow[]>`
        SELECT so.id, so.inicio, so.fin, so.estado,
          v.placa as "vehiculoPlaca", c.nombre as "conductorNombre", l.nombre as "lineaNombre"
        FROM sesiones_operativas so
        JOIN vehiculos v ON v.id = so."vehiculoId"
        JOIN conductores c ON c.id = so."conductorId"
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas r ON r.id = a."rutaId"
        JOIN lineas l ON l.id = r."lineaId"
        WHERE so.inicio >= ${desdeInstante} AND so.inicio < ${hastaInstante}
        ORDER BY so.inicio DESC
        LIMIT 100
      `;

      return filas.map((f) =>
        RecorridoResumenSchema.parse({
          id: f.id,
          inicio: f.inicio.toISOString(),
          fin: f.fin?.toISOString() ?? null,
          estado: f.estado,
          vehiculoPlaca: f.vehiculoPlaca,
          conductorNombre: f.conductorNombre,
          lineaNombre: f.lineaNombre,
        }),
      );
    });
  }

  async obtener(actor: AuthenticatedUser, sesionId: string): Promise<RecorridoDetalle> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const sesion = await tx.sesionOperativa.findUnique({
        where: { id: sesionId },
        include: {
          vehiculo: true,
          conductor: true,
          asignacion: { include: { ruta: { include: { linea: true } } } },
        },
      });
      if (!sesion) {
        throw new NotFoundException('Sesión operativa no encontrada');
      }
      const rutaId = sesion.asignacion.rutaId;

      const [rutaRow] = await tx.$queryRaw<RutaGeomRow[]>`
        SELECT id, ST_AsGeoJSON(geometria) as geometria FROM rutas WHERE id = ${rutaId}
      `;
      if (!rutaRow) {
        throw new NotFoundException('Ruta de la asignación no encontrada');
      }
      const puntoControlRows = await tx.$queryRaw<PuntoControlRow[]>`
        SELECT id, orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM"
        FROM puntos_control WHERE "rutaId" = ${rutaId} ORDER BY orden ASC
      `;
      const gpsRows = await tx.$queryRaw<GpsPointRow[]>`
        SELECT ts, lat, lng, accuracy, speed FROM gps_points
        WHERE sesion_id = ${sesionId}::uuid ORDER BY ts ASC
      `;
      const cumplimientos = await tx.cumplimientoPc.findMany({
        where: { sesionId },
        orderBy: { ts: 'asc' },
      });
      const eventos = await tx.eventoOperativo.findMany({
        where: { sesionId },
        orderBy: { ts: 'asc' },
      });

      return RecorridoDetalleSchema.parse({
        sesion: {
          id: sesion.id,
          inicio: sesion.inicio.toISOString(),
          fin: sesion.fin?.toISOString() ?? null,
          estado: sesion.estado,
          deviceId: sesion.deviceId,
        },
        vehiculo: { id: sesion.vehiculo.id, placa: sesion.vehiculo.placa },
        conductor: { id: sesion.conductor.id, nombre: sesion.conductor.nombre },
        linea: {
          id: sesion.asignacion.ruta.linea.id,
          nombre: sesion.asignacion.ruta.linea.nombre,
          color: sesion.asignacion.ruta.linea.color ?? '#3226B4',
        },
        ruta: { id: rutaRow.id, geometria: JSON.parse(rutaRow.geometria) },
        puntosControl: puntoControlRows.map((p) => ({
          id: p.id,
          orden: p.orden,
          coord: JSON.parse(p.coord),
          radioToleranciaM: p.radioToleranciaM,
        })),
        trazaGps: gpsRows.map((g) => ({
          lat: g.lat,
          lng: g.lng,
          ts: g.ts.toISOString(),
          accuracy: g.accuracy,
          speed: g.speed,
        })),
        cumplimientos: cumplimientos.map((c) => ({
          id: c.id,
          puntoControlId: c.puntoControlId,
          ts: c.ts.toISOString(),
          distanciaM: c.distanciaM,
          cumplido: c.cumplido,
          validadoPor: c.validadoPor,
        })),
        eventos: eventos.map((e) => ({
          id: e.id,
          tipo: e.tipo,
          ts: e.ts.toISOString(),
          payload: e.payload,
        })),
      });
    });
  }
}
