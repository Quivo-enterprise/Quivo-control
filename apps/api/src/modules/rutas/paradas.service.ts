import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { ParadaSchema, type ActualizarParada, type CrearParada, type Parada } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';
import { validarCercaniaARuta } from '../../common/geo/proximidad-ruta.js';

interface ParadaRow {
  id: string;
  rutaId: string;
  tipo: string;
  orden: number;
  coord: string; // GeoJSON como texto (ST_AsGeoJSON devuelve `text`).
  estado: string;
}

/** Mismo patrón que rutas.service.ts: sin RLS propia (hereda tenant vía rutaId → linea),
 * `coord` es GEOGRAPHY(POINT) → SQL crudo con ST_GeomFromGeoJSON/ST_AsGeoJSON. */
@Injectable()
export class ParadasService {
  async listarPorRuta(actor: AuthenticatedUser, rutaId: string): Promise<Parada[]> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      const rows = await tx.$queryRaw<ParadaRow[]>`
        SELECT id, "rutaId", tipo, orden, ST_AsGeoJSON(coord) as coord, estado
        FROM paradas WHERE "rutaId" = ${rutaId} ORDER BY orden ASC
      `;
      return rows.map(toParada);
    });
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Parada> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const row = await obtenerFila(tx, id);
      await asegurarRutaVisible(tx, row.rutaId);
      return toParada(row);
    });
  }

  async crear(actor: AuthenticatedUser, rutaId: string, data: CrearParada): Promise<Parada> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      await validarCercaniaARuta(tx, rutaId, data.coord);

      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO paradas (id, "rutaId", tipo, orden, coord, estado, "createdAt", "updatedAt")
        VALUES (
          ${id}, ${rutaId}, ${data.tipo}, ${data.orden},
          ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.coord)}), 4326)::geography,
          ${data.estado}, now(), now()
        )
      `;
      return toParada(await obtenerFila(tx, id));
    });
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarParada): Promise<Parada> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await obtenerFila(tx, id);
      await asegurarRutaVisible(tx, anterior.rutaId);

      if (data.coord) {
        await validarCercaniaARuta(tx, anterior.rutaId, data.coord);
        await tx.$executeRaw`
          UPDATE paradas
          SET coord = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.coord)}), 4326)::geography,
              "updatedAt" = now()
          WHERE id = ${id}
        `;
      }
      if (data.tipo !== undefined) {
        await tx.$executeRaw`UPDATE paradas SET tipo = ${data.tipo}, "updatedAt" = now() WHERE id = ${id}`;
      }
      if (data.orden !== undefined) {
        await tx.$executeRaw`UPDATE paradas SET orden = ${data.orden}, "updatedAt" = now() WHERE id = ${id}`;
      }
      if (data.estado !== undefined) {
        await tx.$executeRaw`UPDATE paradas SET estado = ${data.estado}, "updatedAt" = now() WHERE id = ${id}`;
      }

      return toParada(await obtenerFila(tx, id));
    });
  }
}

async function obtenerFila(tx: Prisma.TransactionClient, id: string): Promise<ParadaRow> {
  const rows = await tx.$queryRaw<ParadaRow[]>`
    SELECT id, "rutaId", tipo, orden, ST_AsGeoJSON(coord) as coord, estado
    FROM paradas WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) {
    throw new NotFoundException('Parada no encontrada');
  }
  return row;
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function toParada(row: ParadaRow): Parada {
  return ParadaSchema.parse({ ...row, coord: JSON.parse(row.coord) });
}
