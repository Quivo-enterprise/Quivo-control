import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import { SancionSchema, type ActualizarSancion, type CrearSancion, type EstadoSancion, type Sancion } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Transiciones válidas (RF-40..50) — el doc técnico solo lista los 5 estados posibles, no
 * las transiciones entre ellos; esto es una máquina de estados razonable asumida por este
 * equipo (mismo patrón que las transiciones de estado de vehículos, QUI-222), no una
 * decisión de Producto confirmada. `pagada`/`anulada` son terminales.
 */
const TRANSICIONES_VALIDAS: Record<EstadoSancion, EstadoSancion[]> = {
  pendiente: ['aplicada', 'anulada'],
  aplicada: ['apelada', 'pagada', 'anulada'],
  apelada: ['aplicada', 'anulada'],
  pagada: [],
  anulada: [],
};

@Injectable()
export class SancionesService {
  async listar(actor: AuthenticatedUser): Promise<Sancion[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.sancion.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { fechaHecho: 'desc' },
      }),
    );
    return rows.map(toSancion);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Sancion> {
    const sancion = await withTenantContext(toTenantContext(actor), (tx) => tx.sancion.findUnique({ where: { id } }));
    if (!sancion) {
      throw new NotFoundException('Sanción no encontrada');
    }
    return toSancion(sancion);
  }

  async crear(actor: AuthenticatedUser, data: CrearSancion): Promise<Sancion> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    const sancion = await withTenantContext(toTenantContext(actor), async (tx) => {
      const regla = await tx.regla.findUnique({ where: { id: data.reglaId } });
      if (!regla || regla.sindicatoId !== sindicatoId) {
        throw new NotFoundException('Regla no encontrada');
      }
      return tx.sancion.create({
        data: {
          sindicatoId,
          reglaId: data.reglaId,
          sujetoTipo: data.sujetoTipo,
          sujetoId: data.sujetoId,
          motivo: data.motivo,
          fechaHecho: data.fechaHecho,
          evidenciaRef: data.evidenciaRef ?? null,
          estado: 'pendiente',
        },
      });
    });
    return toSancion(sancion);
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarSancion): Promise<Sancion> {
    const sancion = await withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await obtenerOFallar(tx, id);
      if (anterior.estado !== 'pendiente') {
        throw new BadRequestException('Solo se puede editar una sanción pendiente');
      }
      return tx.sancion.update({ where: { id }, data });
    });
    return toSancion(sancion);
  }

  async aplicar(actor: AuthenticatedUser, id: string): Promise<Sancion> {
    return this.transicionar(actor, id, 'aplicada');
  }

  async anular(actor: AuthenticatedUser, id: string): Promise<Sancion> {
    return this.transicionar(actor, id, 'anulada');
  }

  async apelar(actor: AuthenticatedUser, id: string): Promise<Sancion> {
    return this.transicionar(actor, id, 'apelada');
  }

  async pagar(actor: AuthenticatedUser, id: string): Promise<Sancion> {
    return this.transicionar(actor, id, 'pagada');
  }

  private async transicionar(actor: AuthenticatedUser, id: string, hacia: EstadoSancion): Promise<Sancion> {
    const sancion = await withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await obtenerOFallar(tx, id);
      validarTransicion(anterior.estado as EstadoSancion, hacia);
      return tx.sancion.update({ where: { id }, data: { estado: hacia } });
    });
    return toSancion(sancion);
  }
}

async function obtenerOFallar(tx: Prisma.TransactionClient, id: string): Promise<{ id: string; estado: string }> {
  const sancion = await tx.sancion.findUnique({ where: { id } });
  if (!sancion) {
    throw new NotFoundException('Sanción no encontrada');
  }
  return sancion;
}

function validarTransicion(desde: EstadoSancion, hacia: EstadoSancion): void {
  if (!TRANSICIONES_VALIDAS[desde].includes(hacia)) {
    throw new BadRequestException(`Transición de estado inválida: "${desde}" → "${hacia}"`);
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function resolverSindicatoId(actor: AuthenticatedUser, sindicatoIdDelBody: string | undefined): string {
  if (actor.sindicatoId) {
    return actor.sindicatoId;
  }
  if (!sindicatoIdDelBody) {
    throw new BadRequestException('sindicatoId es obligatorio para admin_quivo');
  }
  return sindicatoIdDelBody;
}

function toSancion(row: {
  id: string;
  sindicatoId: string;
  reglaId: string;
  sujetoTipo: string;
  sujetoId: string;
  motivo: string;
  fechaHecho: Date;
  evidenciaRef: string | null;
  estado: string;
}): Sancion {
  return SancionSchema.parse(row);
}
