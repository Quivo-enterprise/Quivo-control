import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import {
  VarianteSchema,
  type ActualizarVariante,
  type CrearVariante,
  type LineaGeoJson,
  type Variante,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';

/**
 * Una variante puede traer el TRAMO adicional (`geometria`, geography(LineString), SQL crudo
 * como `rutas.geometria`) y su punto de espera (docs/plan-molinos-designacion.md). Esos dos
 * campos solo los edita un admin (`operador` es CRUD_NUCLEO para el resto). Tenant-scoping igual
 * que rutas: resuelve hacia arriba hasta `linea`.
 */
@Injectable()
export class VariantesService {
  async listarPorRuta(actor: AuthenticatedUser, rutaId: string): Promise<Variante[]> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      const rows = await tx.variante.findMany({ where: { rutaId }, orderBy: { nombre: 'asc' } });
      const geometrias = await leerGeometrias(
        tx,
        rows.map((r) => r.id),
      );
      return rows.map((row) => VarianteSchema.parse({ ...row, geometria: geometrias.get(row.id) ?? null }));
    });
  }

  async crear(actor: AuthenticatedUser, rutaId: string, data: CrearVariante): Promise<Variante> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      const { geometria, ...resto } = data;
      validarEdicionAdmin(actor, data);
      if (resto.puntoEsperaId) await validarPuntoEspera(tx, rutaId, resto.puntoEsperaId);
      const creada = await tx.variante.create({ data: { ...resto, rutaId } });
      if (geometria) await escribirGeometria(tx, creada.id, geometria);
      return this.leer(tx, creada.id);
    });
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Variante> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const variante = await tx.variante.findUnique({ where: { id } });
      if (!variante) {
        throw new NotFoundException('Variante no encontrada');
      }
      await asegurarRutaVisible(tx, variante.rutaId);
      return this.leer(tx, id);
    });
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarVariante): Promise<Variante> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const anterior = await tx.variante.findUnique({ where: { id } });
      if (!anterior) {
        throw new NotFoundException('Variante no encontrada');
      }
      await asegurarRutaVisible(tx, anterior.rutaId);
      validarEdicionAdmin(actor, data);
      const { geometria, ...resto } = data;
      if (resto.puntoEsperaId) await validarPuntoEspera(tx, anterior.rutaId, resto.puntoEsperaId);
      await tx.variante.update({ where: { id }, data: resto });
      if (geometria !== undefined) await escribirGeometria(tx, id, geometria);
      return this.leer(tx, id);
    });
  }

  private async leer(tx: Prisma.TransactionClient, id: string): Promise<Variante> {
    const fila = await tx.variante.findUniqueOrThrow({ where: { id } });
    const geometrias = await leerGeometrias(tx, [id]);
    return VarianteSchema.parse({ ...fila, geometria: geometrias.get(id) ?? null });
  }
}

function validarEdicionAdmin(
  actor: AuthenticatedUser,
  data: { geometria?: LineaGeoJson | null; puntoEsperaId?: string | null },
): void {
  if (actor.rol === 'operador' && (data.geometria !== undefined || data.puntoEsperaId !== undefined)) {
    throw new ForbiddenException('Solo un administrador puede configurar el tramo y el punto de espera de una variante');
  }
}

/** El punto de espera tiene que ser un PC `espera` (con minutos) de LA MISMA ruta de la variante. */
async function validarPuntoEspera(
  tx: Prisma.TransactionClient,
  rutaId: string,
  puntoControlId: string,
): Promise<void> {
  const [pc] = await tx.$queryRaw<
    { rutaId: string; rol: string | null; esperaMin: number | null; estado: string }[]
  >`
    SELECT "rutaId", rol, "esperaMin", estado FROM puntos_control WHERE id = ${puntoControlId}
  `;
  if (!pc || pc.rutaId !== rutaId) {
    throw new BadRequestException('El punto de espera debe ser un punto de control de la misma ruta');
  }
  if (pc.rol !== 'espera') {
    throw new BadRequestException('El punto de espera debe tener rol "espera"');
  }
  if (pc.estado !== 'activo') {
    throw new BadRequestException('El punto de espera está inactivo');
  }
}

async function escribirGeometria(
  tx: Prisma.TransactionClient,
  id: string,
  geometria: LineaGeoJson | null,
): Promise<void> {
  if (geometria === null) {
    await tx.$executeRaw`UPDATE variantes SET geometria = NULL, "updatedAt" = now() WHERE id = ${id}`;
    return;
  }
  await tx.$executeRaw`
    UPDATE variantes
    SET geometria = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometria)}), 4326)::geography,
        "updatedAt" = now()
    WHERE id = ${id}
  `;
}

async function leerGeometrias(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, LineaGeoJson>> {
  if (ids.length === 0) return new Map();
  const filas = await tx.$queryRaw<{ id: string; geometria: string }[]>`
    SELECT id, ST_AsGeoJSON(geometria) AS geometria FROM variantes
    WHERE id = ANY(${ids}::text[]) AND geometria IS NOT NULL
  `;
  return new Map(filas.map((f) => [f.id, JSON.parse(f.geometria) as LineaGeoJson]));
}
