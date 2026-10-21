import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import {
  fechaActualBolivia,
  type BaseFrecuencia,
  type CrearFrecuenciaRegla,
  type FrecuenciaRegla,
  type ReglasFrecuenciaPanel,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { diaStr, resolverTerminal, type PuntoControlTerminal } from './fila-datos.js';
import {
  MSG_GRUPO_INVALIDO,
  MSG_VEHICULO_INVALIDO,
  esErrorFk,
  noEncontrado,
} from './salidas.logic.js';

type Tx = Prisma.TransactionClient;
type ReglaDb = Prisma.FrecuenciaReglaGetPayload<object>;

const contexto = (a: AuthenticatedUser) => ({ rol: a.rol, sindicatoId: a.sindicatoId });

/** Lleva `sindicatoId` además del contrato: `@Auditable` lo usa para el registro de auditoría. */
export type ReglaConSindicato = FrecuenciaRegla & { sindicatoId: string };

function aRegla(r: ReglaDb): ReglaConSindicato {
  return {
    id: r.id,
    sindicatoId: r.sindicatoId,
    puntoControlId: r.puntoControlId,
    fecha: diaStr(r.fecha),
    alcance: r.alcance as FrecuenciaRegla['alcance'],
    grupoId: r.grupoId,
    vehiculoId: r.vehiculoId,
    minutos: r.minutos,
    desdeMin: r.desdeMin,
    hastaMin: r.hastaMin,
    creadaPor: r.creadaPor,
    creadaEn: r.creadaEn.toISOString(),
    anuladaEn: r.anuladaEn?.toISOString() ?? null,
    anuladaPor: r.anuladaPor,
  };
}

/**
 * Frecuencia base de la terminal y reglas del día (plan "fila de salida"). El `sindicatoId` de la
 * regla es el del punto de control (resuelto bajo RLS), nunca del body; `fecha`/`creadaEn` los
 * pone el servidor. Una regla se anula, no se borra.
 */
@Injectable()
export class FrecuenciasService {
  /** `GET /salidas/:puntoControlId/reglas`: reglas no anuladas del día + base. */
  async listar(actor: AuthenticatedUser, puntoControlId: string): Promise<ReglasFrecuenciaPanel> {
    const fecha = fechaActualBolivia();
    return withTenantContext(contexto(actor), async (tx) => {
      const pc = await resolverTerminal(tx, puntoControlId);
      const reglas = await tx.frecuenciaRegla.findMany({
        where: { puntoControlId, fecha, anuladaEn: null },
        orderBy: { creadaEn: 'asc' },
      });
      return {
        puntoControlId,
        fecha: diaStr(fecha),
        baseMin: pc.baseMin,
        reglas: reglas.map(aRegla),
      };
    });
  }

  /** `POST /salidas/:puntoControlId/reglas`. */
  async crear(
    actor: AuthenticatedUser,
    puntoControlId: string,
    body: CrearFrecuenciaRegla,
  ): Promise<ReglaConSindicato> {
    const creadaEn = new Date();
    return withTenantContext(contexto(actor), async (tx) => {
      const pc = await resolverTerminal(tx, puntoControlId);
      if (body.grupoId) await this.validarGrupo(tx, pc, body.grupoId);
      if (body.vehiculoId) await this.validarVehiculo(tx, pc, body.vehiculoId);
      try {
        const regla = await tx.frecuenciaRegla.create({
          data: {
            sindicatoId: pc.sindicatoId,
            puntoControlId,
            fecha: fechaActualBolivia(creadaEn),
            alcance: body.alcance,
            grupoId: body.grupoId,
            vehiculoId: body.vehiculoId,
            minutos: body.minutos,
            desdeMin: body.desdeMin,
            hastaMin: body.hastaMin,
            creadaPor: actor.userId,
            creadaEn,
          },
        });
        return aRegla(regla);
      } catch (e) {
        if (esErrorFk(e)) throw noEncontrado(body.grupoId ? MSG_GRUPO_INVALIDO : MSG_VEHICULO_INVALIDO);
        throw e;
      }
    });
  }

  /** `DELETE /salidas/:puntoControlId/reglas/:id`: anula (idempotente). */
  async anular(actor: AuthenticatedUser, puntoControlId: string, reglaId: string): Promise<ReglaConSindicato> {
    return withTenantContext(contexto(actor), async (tx) => {
      await resolverTerminal(tx, puntoControlId);
      const regla = await tx.frecuenciaRegla.findFirst({ where: { id: reglaId, puntoControlId } });
      if (!regla) throw noEncontrado('Regla no encontrada');
      if (regla.anuladaEn) return aRegla(regla);
      return aRegla(
        await tx.frecuenciaRegla.update({
          where: { id: reglaId },
          data: { anuladaEn: new Date(), anuladaPor: actor.userId },
        }),
      );
    });
  }

  /** `PUT /salidas/:puntoControlId/base`: frecuencia base de la terminal (`null` la quita). */
  async fijarBase(actor: AuthenticatedUser, puntoControlId: string, body: BaseFrecuencia) {
    return withTenantContext(contexto(actor), async (tx) => {
      const pc = await resolverTerminal(tx, puntoControlId);
      await tx.puntoControl.update({
        where: { id: puntoControlId },
        data: { frecuenciaSalidaMin: body.frecuenciaSalidaMin },
      });
      return {
        id: puntoControlId,
        sindicatoId: pc.sindicatoId,
        puntoControlId,
        frecuenciaSalidaMin: body.frecuenciaSalidaMin,
      };
    });
  }

  // `admin_quivo` ve todos los sindicatos bajo RLS: además de existir, el grupo/vehículo debe ser
  // del MISMO sindicato que la terminal. Mismo 404 para inexistente y ajeno.
  private async validarGrupo(tx: Tx, pc: PuntoControlTerminal, grupoId: string): Promise<void> {
    const g = await tx.grupoVehiculo.findUnique({ where: { id: grupoId }, select: { sindicatoId: true, estado: true } });
    if (!g || g.sindicatoId !== pc.sindicatoId) throw noEncontrado(MSG_GRUPO_INVALIDO);
    if (g.estado !== 'activo') throw new UnprocessableEntityException('El grupo está inactivo');
  }

  private async validarVehiculo(tx: Tx, pc: PuntoControlTerminal, vehiculoId: string): Promise<void> {
    const v = await tx.vehiculo.findUnique({ where: { id: vehiculoId }, select: { sindicatoId: true } });
    if (!v || v.sindicatoId !== pc.sindicatoId) throw noEncontrado(MSG_VEHICULO_INVALIDO);
  }
}
