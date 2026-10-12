import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenantContext, type Prisma } from '@quivo/db';
import type {
  ActualizarInfraccion,
  EstadoInfraccion,
  Infraccion,
  SancionarInfraccion,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { SancionesService } from '../reglas/sanciones.service.js';
import { toInfraccion } from './infracciones.mapper.js';

/** Estados de origen válidos por acción (docs/plan-en-vivo-alertas.md, PR A). */
export const ESTADOS_ORIGEN: Record<'atender' | 'descartar' | 'sancionar', EstadoInfraccion[]> = {
  atender: ['abierta'],
  descartar: ['abierta', 'atendida'],
  sancionar: ['abierta', 'atendida'],
};

const ESTADO_DESTINO: Record<'atender' | 'descartar', EstadoInfraccion> = {
  atender: 'atendida',
  descartar: 'descartada',
};

/** Registra quién/cuándo atendió SOLO la primera vez (`atendidaPor` nulo): descartar o
 * sancionar una infracción ya `atendida` no pisa la primera atención. El historial completo
 * de actores queda en el audit log (`@Auditable`). */
async function registrarPrimeraAtencion(
  tx: Prisma.TransactionClient,
  id: string,
  actor: AuthenticatedUser,
): Promise<void> {
  await tx.infraccion.updateMany({
    where: { id, atendidaPor: null },
    data: { atendidaPor: actor.userId, atendidaEn: new Date() },
  });
}

@Injectable()
export class InfraccionesService {
  constructor(@Inject(SancionesService) private readonly sancionesService: SancionesService) {}

  /**
   * `atender` (abierta → atendida) / `descartar` (abierta|atendida → descartada). El UPDATE
   * condicional por estado de origen es atómico: dos admins simultáneos no pueden pisarse; el
   * perdedor recibe 409. `atendidaPor`/`atendidaEn` guardan la PRIMERA atención (actor y hora
   * del server); descartar desde `atendida` no los sobrescribe.
   */
  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarInfraccion): Promise<Infraccion> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const { count } = await tx.infraccion.updateMany({
        where: { id, estado: { in: ESTADOS_ORIGEN[data.accion] } },
        data: {
          estado: ESTADO_DESTINO[data.accion],
          ...(data.nota !== undefined ? { nota: data.nota } : {}),
        },
      });
      if (count > 0) await registrarPrimeraAtencion(tx, id, actor);
      const actual = await tx.infraccion.findUnique({ where: { id } });
      // `findUnique` pasa por RLS: una infracción de otro tenant es indistinguible de una
      // inexistente (404), igual que el resto de los tenant-checks.
      if (!actual) {
        throw new NotFoundException('Infracción no encontrada');
      }
      if (count === 0) {
        throw new ConflictException(
          `No se puede ${data.accion} una infracción en estado "${actual.estado}"`,
        );
      }
      return toInfraccion(actual);
    });
  }

  /**
   * Crea la `Sancion` (reusando `SancionesService.crearEnTx`) y marca la infracción
   * `sancionada` con `sancionId`, todo en UNA transacción: si cualquiera falla (regla
   * inexistente, estado inválido) no queda ni sanción huérfana ni infracción marcada.
   *
   * Reglas de negocio: `pc_omitido` es solo alerta (decisión del CTO) → 409; el sujeto debe ser
   * el conductor o el vehículo de la propia infracción → 400; `evidenciaRef` por defecto
   * `infraccion:{id} sesion:{sesionId}`.
   */
  async sancionar(actor: AuthenticatedUser, id: string, data: SancionarInfraccion): Promise<Infraccion> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const infraccion = await tx.infraccion.findUnique({ where: { id } });
      if (!infraccion) {
        throw new NotFoundException('Infracción no encontrada');
      }
      if (infraccion.tipo === 'pc_omitido') {
        throw new ConflictException(
          'Una infracción de punto de control omitido es solo una alerta: no se puede sancionar',
        );
      }
      const sujetoEsperado =
        data.sujetoTipo === 'conductor'
          ? infraccion.conductorId
          : data.sujetoTipo === 'vehiculo'
            ? infraccion.vehiculoId
            : null;
      if (sujetoEsperado === null || data.sujetoId !== sujetoEsperado) {
        throw new BadRequestException(
          'El sujeto de la sanción debe ser el conductor o el vehículo de la infracción',
        );
      }
      // Reclamo atómico del estado ANTES de crear la sanción: evita dos sanciones para la
      // misma infracción ante doble click / dos admins.
      const { count } = await tx.infraccion.updateMany({
        where: { id, estado: { in: ESTADOS_ORIGEN.sancionar } },
        data: { estado: 'sancionada' },
      });
      if (count === 0) {
        throw new ConflictException(`No se puede sancionar una infracción en estado "${infraccion.estado}"`);
      }
      await registrarPrimeraAtencion(tx, id, actor);
      const sancion = await this.sancionesService.crearEnTx(tx, actor, {
        ...data,
        sindicatoId: infraccion.sindicatoId,
        evidenciaRef: data.evidenciaRef ?? `infraccion:${infraccion.id} sesion:${infraccion.sesionId}`,
      });
      const actualizada = await tx.infraccion.update({
        where: { id },
        data: { sancionId: sancion.id },
      });
      return toInfraccion(actualizada);
    });
  }
}
