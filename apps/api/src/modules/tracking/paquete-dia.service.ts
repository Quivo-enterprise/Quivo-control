import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import { PaqueteDiaSchema, TurnoSchema, type PaqueteDia } from '@quivo/shared';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

interface RutaGeomRow {
  id: string;
  sentido: string;
  geometria: string; // GeoJSON como texto — ST_AsGeoJSON devuelve `text`, no JSON nativo.
}

interface ParadaRow {
  id: string;
  tipo: string;
  orden: number;
  coord: string;
}

interface PuntoControlRow {
  id: string;
  orden: number;
  coord: string;
  radioToleranciaM: number;
  obligatorio: boolean;
}

/**
 * RF-68/73 (QUI-236): todo lo que el chofer necesita para completar el recorrido sin red,
 * en una sola llamada — asignación vigente + geometría de ruta/paradas/puntos de control.
 * Mismo patrón de SQL crudo que `rutas.service.ts`/`control-points.service.ts` para las
 * columnas GEOGRAPHY; la asignación ya viene resuelta y de confianza desde la sesión móvil
 * (QUI-235/`AuthMovilGuard`), no hace falta re-derivar tenant desde el body.
 */
@Injectable()
export class PaqueteDiaService {
  async obtenerPaqueteDelDia(sesion: SesionMovilAutenticada): Promise<PaqueteDia> {
    return withTenantContext({ rol: 'conductor', sindicatoId: sesion.sindicatoId }, async (tx) => {
      const ahora = new Date();
      const asignacion = await tx.asignacion.findUnique({
        where: { id: sesion.asignacionId },
        include: { ruta: { include: { linea: true } } },
      });
      if (!asignacion || asignacion.estado !== 'vigente' || asignacion.venceAt <= ahora) {
        throw new UnauthorizedException('La asignación de esta sesión ya no está vigente');
      }

      const [rutaRow] = await tx.$queryRaw<RutaGeomRow[]>`
        SELECT id, sentido, ST_AsGeoJSON(geometria) as geometria
        FROM rutas WHERE id = ${asignacion.rutaId}
      `;
      if (!rutaRow) {
        throw new NotFoundException('Ruta de la asignación no encontrada');
      }

      // `paradas`/`puntos_control` son soft-delete (`estado: 'activo' | 'inactivo'`, nunca
      // DELETE real porque `CumplimientoPc` referencia el id sin FK) — el paquete offline del
      // chofer nunca debe incluir un punto dado de baja: no hay forma de refrescarlo hasta el
      // próximo inicio de jornada, y un punto/parada fantasma en el mapa desorienta el
      // recorrido real. El contrato `PaqueteDiaSchema` (paquete-dia.ts) tampoco expone
      // `estado` — el móvil no necesita filtrar lo que el backend ya filtró.
      const paradaRows = await tx.$queryRaw<ParadaRow[]>`
        SELECT id, tipo, orden, ST_AsGeoJSON(coord) as coord
        FROM paradas WHERE "rutaId" = ${asignacion.rutaId} AND estado = 'activo' ORDER BY orden ASC
      `;
      const puntoControlRows = await tx.$queryRaw<PuntoControlRow[]>`
        SELECT id, orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM", obligatorio
        FROM puntos_control WHERE "rutaId" = ${asignacion.rutaId} AND estado = 'activo' ORDER BY orden ASC
      `;

      return PaqueteDiaSchema.parse({
        asignacion: {
          id: asignacion.id,
          fecha: asignacion.fecha.toISOString().slice(0, 10),
          horario: TurnoSchema.parse(asignacion.horario),
          venceAt: asignacion.venceAt.toISOString(),
        },
        ruta: {
          id: rutaRow.id,
          sentido: rutaRow.sentido,
          geometria: JSON.parse(rutaRow.geometria),
        },
        linea: {
          id: asignacion.ruta.linea.id,
          codigo: asignacion.ruta.linea.codigo,
          nombre: asignacion.ruta.linea.nombre,
          // `Linea.color` es nullable en el schema (QUI-224) — el paquete offline necesita
          // un color para pintar la ruta en el mapa del chofer, así que se resuelve acá con
          // el primario de marca QUIVO en vez de propagar `null` al contrato móvil.
          color: asignacion.ruta.linea.color ?? '#3226B4',
        },
        paradas: paradaRows.map((p) => ({
          id: p.id,
          tipo: p.tipo,
          orden: p.orden,
          coord: JSON.parse(p.coord),
        })),
        puntosControl: puntoControlRows.map((p) => ({
          id: p.id,
          orden: p.orden,
          coord: JSON.parse(p.coord),
          radioToleranciaM: p.radioToleranciaM,
          obligatorio: p.obligatorio,
        })),
      });
    });
  }
}
