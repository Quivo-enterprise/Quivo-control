import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { RutaSchema, type ActualizarRuta, type CrearRuta, type LineaGeoJson, type Ruta } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarLineaVisible } from '../../common/geo/tenant-checks.js';
import { RUTA_PROXIMIDAD_TOLERANCIA_METROS } from '../../common/geo/proximidad-ruta.js';

interface RutaRow {
  id: string;
  lineaId: string;
  sentido: string;
  estado: string;
  publicStatus: string;
  publishedAt: Date | null;
  geometria: string; // GeoJSON como texto — ST_AsGeoJSON devuelve `text`, no JSON nativo.
}

/**
 * `rutas` no tiene RLS propia (QUI-218: no tiene columna `sindicatoId` directa, la hereda
 * transitivamente vía `lineaId` → `linea.sindicatoId`) — la barrera de tenant acá es
 * `asegurarLineaVisible`: toda operación pasa primero por una lectura de `linea` con
 * `withTenantContext`, que SÍ tiene RLS. Si la línea no es visible para el actor (porque es
 * de otro sindicato), esa lectura devuelve null y la ruta se trata como inexistente (404),
 * nunca 403 — no revela que existe.
 *
 * `geometria` es `Unsupported("geography(...)")` en Prisma — el Client normal ni siquiera
 * expone el campo, así que todo esto usa `$queryRaw`/`$executeRaw` con
 * `ST_GeomFromGeoJSON`/`ST_AsGeoJSON` para ida y vuelta en GeoJSON (RF-24..33).
 */
@Injectable()
export class RutasService {
  async listarPorLinea(actor: AuthenticatedUser, lineaId: string): Promise<Ruta[]> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarLineaVisible(tx, lineaId);
      const rows = await tx.$queryRaw<RutaRow[]>`
        SELECT id, "lineaId", sentido, estado, "publicStatus", "publishedAt", ST_AsGeoJSON(geometria) as geometria
        FROM rutas WHERE "lineaId" = ${lineaId} ORDER BY "createdAt" ASC
      `;
      return rows.map(toRuta);
    });
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Ruta> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const row = await obtenerFila(tx, id);
      await asegurarLineaVisible(tx, row.lineaId);
      return toRuta(row);
    });
  }

  async crear(actor: AuthenticatedUser, lineaId: string, data: CrearRuta): Promise<Ruta> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarLineaVisible(tx, lineaId);
      await validarGeometriaValida(tx, data.geometria);

      const id = randomUUID();
      const geoJson = JSON.stringify(data.geometria);
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (
          ${id}, ${lineaId}, ${data.sentido},
          ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}), 4326)::geography,
          ${data.estado}, now(), now()
        )
      `;
      return toRuta(await obtenerFila(tx, id));
    });
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarRuta): Promise<Ruta> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await obtenerFila(tx, id);
      await asegurarLineaVisible(tx, anterior.lineaId);

      if (data.geometria) {
        await validarGeometriaValida(tx, data.geometria);
        await validarParadasCercanasAGeometria(tx, id, data.geometria);
        await tx.$executeRaw`
          UPDATE rutas
          SET geometria = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.geometria)}), 4326)::geography,
              "updatedAt" = now()
          WHERE id = ${id}
        `;
      }
      if (data.sentido !== undefined) {
        await tx.$executeRaw`UPDATE rutas SET sentido = ${data.sentido}, "updatedAt" = now() WHERE id = ${id}`;
      }
      if (data.estado !== undefined) {
        await tx.$executeRaw`UPDATE rutas SET estado = ${data.estado}, "updatedAt" = now() WHERE id = ${id}`;
      }

      return toRuta(await obtenerFila(tx, id));
    });
  }
}

async function obtenerFila(tx: Prisma.TransactionClient, id: string): Promise<RutaRow> {
  const rows = await tx.$queryRaw<RutaRow[]>`
    SELECT id, "lineaId", sentido, estado, "publicStatus", "publishedAt", ST_AsGeoJSON(geometria) as geometria
    FROM rutas WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) {
    throw new NotFoundException('Ruta no encontrada');
  }
  return row;
}

async function validarGeometriaValida(tx: Prisma.TransactionClient, geometria: LineaGeoJson): Promise<void> {
  const [{ valida }] = await tx.$queryRaw<[{ valida: boolean }]>`
    SELECT ST_IsValid(ST_GeomFromGeoJSON(${JSON.stringify(geometria)})) as valida
  `;
  if (!valida) {
    throw new BadRequestException('La geometría de la ruta no es válida');
  }
}

async function validarParadasCercanasAGeometria(
  tx: Prisma.TransactionClient,
  rutaId: string,
  geometria: LineaGeoJson,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string; nombre: string | null; cerca: boolean }>>`
    SELECT p.id, p.nombre,
      ST_DWithin(
        ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometria)}), 4326)::geography,
        p.coord,
        ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}
      ) as cerca
    FROM paradas p
    WHERE p."rutaId" = ${rutaId}
    ORDER BY p.orden ASC
  `;
  const paradaFueraDeRuta = rows.find((row) => !row.cerca);
  if (paradaFueraDeRuta) {
    throw new BadRequestException(
      `La nueva geometría deja la parada "${paradaFueraDeRuta.nombre ?? paradaFueraDeRuta.id}" a más de ${RUTA_PROXIMIDAD_TOLERANCIA_METROS}m de la ruta`,
    );
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function toRuta(row: RutaRow): Ruta {
  return RutaSchema.parse({
    ...row,
    geometria: JSON.parse(row.geometria),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  });
}
