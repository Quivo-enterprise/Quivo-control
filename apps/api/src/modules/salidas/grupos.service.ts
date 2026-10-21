import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import type {
  ActualizarGrupoVehiculo,
  CrearGrupoVehiculo,
  EstadoGrupoVehiculo,
  GrupoVehiculo,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { MSG_GRUPO_INVALIDO, MSG_VEHICULO_INVALIDO, esErrorFk, noEncontrado } from './salidas.logic.js';

type Tx = Prisma.TransactionClient;
type GrupoDb = Prisma.GrupoVehiculoGetPayload<{ include: { miembros: { select: { vehiculoId: true } } } }>;

const contexto = (a: AuthenticatedUser) => ({ rol: a.rol, sindicatoId: a.sindicatoId });
const incluirMiembros = { miembros: { select: { vehiculoId: true } } } as const;

/** Lleva `sindicatoId` además del contrato: `@Auditable` lo usa para el registro de auditoría. */
export type GrupoConSindicato = GrupoVehiculo & { sindicatoId: string };

function aGrupo(g: GrupoDb): GrupoConSindicato {
  return {
    id: g.id,
    sindicatoId: g.sindicatoId,
    nombre: g.nombre,
    estado: g.estado as EstadoGrupoVehiculo,
    vehiculoIds: g.miembros.map((m) => m.vehiculoId),
  };
}

const MSG_YA_EN_GRUPO = 'El trufi ya pertenece a otro grupo: un trufi está en un solo grupo';

/**
 * Grupos de trufis para las frecuencias (solo `admin_quivo`/`admin_sindicato`, lo fuerza el
 * controller). El sindicato sale del actor, nunca del body; los vehículos se leen bajo RLS y deben
 * ser del mismo sindicato que el grupo (404 uniforme si no). Un trufi en un solo grupo (unique en
 * BD): si ya está en otro, 409.
 */
@Injectable()
export class GruposService {
  async listar(actor: AuthenticatedUser): Promise<GrupoConSindicato[]> {
    return withTenantContext(contexto(actor), async (tx) => {
      const grupos = await tx.grupoVehiculo.findMany({ include: incluirMiembros, orderBy: { nombre: 'asc' } });
      return grupos.map(aGrupo);
    });
  }

  async crear(actor: AuthenticatedUser, body: CrearGrupoVehiculo): Promise<GrupoConSindicato> {
    // admin_quivo no tiene sindicato propio y el body no puede traerlo: crea grupos un admin del sindicato.
    const sindicatoId = actor.sindicatoId;
    if (!sindicatoId) throw new BadRequestException('Solo un administrador de sindicato puede crear grupos');
    const vehiculoIds = [...new Set(body.vehiculoIds)];
    return this.conTraduccion(() =>
      withTenantContext(contexto(actor), async (tx) => {
        await this.validarVehiculos(tx, sindicatoId, vehiculoIds);
        const grupo = await tx.grupoVehiculo.create({ data: { sindicatoId, nombre: body.nombre } });
        await tx.grupoVehiculoMiembro.createMany({
          data: vehiculoIds.map((vehiculoId) => ({ grupoId: grupo.id, vehiculoId, sindicatoId })),
        });
        return aGrupo({ ...grupo, miembros: vehiculoIds.map((vehiculoId) => ({ vehiculoId })) });
      }),
    );
  }

  async actualizar(actor: AuthenticatedUser, grupoId: string, body: ActualizarGrupoVehiculo): Promise<GrupoConSindicato> {
    return withTenantContext(contexto(actor), async (tx) => {
      await this.obtener(tx, grupoId);
      return aGrupo(
        await tx.grupoVehiculo.update({
          where: { id: grupoId },
          data: { nombre: body.nombre, estado: body.estado },
          include: incluirMiembros,
        }),
      );
    });
  }

  async agregarMiembro(actor: AuthenticatedUser, grupoId: string, vehiculoId: string): Promise<GrupoConSindicato> {
    return this.conTraduccion(() =>
      withTenantContext(contexto(actor), async (tx) => {
        const grupo = await this.obtener(tx, grupoId);
        await this.validarVehiculos(tx, grupo.sindicatoId, [vehiculoId], grupoId);
        await tx.grupoVehiculoMiembro.createMany({
          data: [{ grupoId, vehiculoId, sindicatoId: grupo.sindicatoId }],
          skipDuplicates: true,
        });
        return aGrupo(await this.obtener(tx, grupoId));
      }),
    );
  }

  /** Idempotente: quitar a quien no está en el grupo no falla. */
  async quitarMiembro(actor: AuthenticatedUser, grupoId: string, vehiculoId: string): Promise<GrupoConSindicato> {
    return withTenantContext(contexto(actor), async (tx) => {
      await this.obtener(tx, grupoId);
      await tx.grupoVehiculoMiembro.deleteMany({ where: { grupoId, vehiculoId } });
      return aGrupo(await this.obtener(tx, grupoId));
    });
  }

  private async obtener(tx: Tx, grupoId: string): Promise<GrupoDb> {
    const grupo = await tx.grupoVehiculo.findUnique({ where: { id: grupoId }, include: incluirMiembros });
    if (!grupo) throw noEncontrado(MSG_GRUPO_INVALIDO);
    return grupo;
  }

  /** Existen, son del sindicato del grupo y no están en OTRO grupo. */
  private async validarVehiculos(tx: Tx, sindicatoId: string, ids: string[], grupoActualId?: string): Promise<void> {
    if (ids.length === 0) return;
    const vehiculos = await tx.vehiculo.findMany({ where: { id: { in: ids }, sindicatoId }, select: { id: true } });
    if (vehiculos.length !== ids.length) throw noEncontrado(MSG_VEHICULO_INVALIDO);
    const enOtro = await tx.grupoVehiculoMiembro.findFirst({
      where: { vehiculoId: { in: ids }, ...(grupoActualId ? { grupoId: { not: grupoActualId } } : {}) },
      select: { vehiculoId: true },
    });
    if (enOtro) throw new ConflictException(MSG_YA_EN_GRUPO);
  }

  // Carrera entre dos altas: el unique de `vehiculoId` (P2002) es el mismo 409; FK (P2003) es el 404 uniforme.
  private async conTraduccion<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(MSG_YA_EN_GRUPO);
      if (esErrorFk(e)) throw noEncontrado(MSG_VEHICULO_INVALIDO);
      throw e;
    }
  }
}
