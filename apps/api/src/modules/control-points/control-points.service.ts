import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import {
  PuntoControlSchema,
  type ActualizarPuntoControl,
  type CrearPuntoControl,
  type PuntoControl,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';
import { validarCercaniaARuta } from '../../common/geo/proximidad-ruta.js';

interface PuntoControlRow {
  id: string;
  rutaId: string;
  orden: number;
  coord: string; // GeoJSON como texto (ST_AsGeoJSON devuelve `text`).
  radioToleranciaM: number;
  obligatorio: boolean;
}

/**
 * RF-34..39 (QUI-226) — solo la gestión del punto; la validación de cumplimiento en
 * recorrido real (RF-39, contra `radioToleranciaM`) es de M3 (worker de tracking). Mismo
 * patrón que paradas.service.ts: sin RLS propia (hereda tenant vía rutaId → linea), `coord`
 * es GEOGRAPHY(POINT) → SQL crudo.
 */
@Injectable()
export class ControlPointsService {
  async listarPorRuta(actor: AuthenticatedUser, rutaId: string): Promise<PuntoControl[]> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      const rows = await tx.$queryRaw<PuntoControlRow[]>`
        SELECT id, "rutaId", orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM", obligatorio
        FROM puntos_control WHERE "rutaId" = ${rutaId} ORDER BY orden ASC
      `;
      return rows.map(toPuntoControl);
    });
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<PuntoControl> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const row = await obtenerFila(tx, id);
      await asegurarRutaVisible(tx, row.rutaId);
      return toPuntoControl(row);
    });
  }

  async crear(actor: AuthenticatedUser, rutaId: string, data: CrearPuntoControl): Promise<PuntoControl> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const ruta = await asegurarRutaVisible(tx, rutaId);
      await validarCercaniaARuta(tx, rutaId, data.coord);

      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (
          ${id}, ${rutaId}, ${data.orden},
          ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.coord)}), 4326)::geography,
          ${data.radioToleranciaM}, ${data.obligatorio}, now(), now()
        )
      `;
      await auditar(tx, actor, 'crear', id, ruta.sindicatoId, data);
      return toPuntoControl(await obtenerFila(tx, id));
    });
  }

  async actualizar(
    actor: AuthenticatedUser,
    id: string,
    data: ActualizarPuntoControl,
  ): Promise<PuntoControl> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await obtenerFila(tx, id);
      const ruta = await asegurarRutaVisible(tx, anterior.rutaId);

      if (data.coord) {
        await validarCercaniaARuta(tx, anterior.rutaId, data.coord);
        await tx.$executeRaw`
          UPDATE puntos_control
          SET coord = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.coord)}), 4326)::geography,
              "updatedAt" = now()
          WHERE id = ${id}
        `;
      }
      if (data.orden !== undefined) {
        await tx.$executeRaw`UPDATE puntos_control SET orden = ${data.orden}, "updatedAt" = now() WHERE id = ${id}`;
      }
      if (data.radioToleranciaM !== undefined) {
        await tx.$executeRaw`
          UPDATE puntos_control SET "radioToleranciaM" = ${data.radioToleranciaM}, "updatedAt" = now() WHERE id = ${id}
        `;
      }
      if (data.obligatorio !== undefined) {
        await tx.$executeRaw`
          UPDATE puntos_control SET obligatorio = ${data.obligatorio}, "updatedAt" = now() WHERE id = ${id}
        `;
      }

      await auditar(tx, actor, 'editar', id, ruta.sindicatoId, { antes: anterior, cambios: data });
      return toPuntoControl(await obtenerFila(tx, id));
    });
  }
}

async function obtenerFila(tx: Prisma.TransactionClient, id: string): Promise<PuntoControlRow> {
  const rows = await tx.$queryRaw<PuntoControlRow[]>`
    SELECT id, "rutaId", orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM", obligatorio
    FROM puntos_control WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) {
    throw new NotFoundException('Punto de control no encontrado');
  }
  return row;
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function toPuntoControl(row: PuntoControlRow): PuntoControl {
  return PuntoControlSchema.parse({ ...row, coord: JSON.parse(row.coord) });
}

async function auditar(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  accion: string,
  entidadId: string,
  sindicatoId: string,
  diff: unknown,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      sindicatoId,
      usuarioId: actor.userId,
      entidad: 'punto_control',
      entidadId,
      accion,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}
