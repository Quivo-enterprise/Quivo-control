import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenantContext, type Prisma } from '@quivo/db';
import {
  fechaActualBolivia,
  motivoSancion,
  rangoCumplimiento,
  reglaInicialSancion,
  TIPOS_INFRACCION_SOLO_ALERTA,
  type ActualizarInfraccion,
  type EstadoInfraccion,
  type Infraccion,
  type SancionarInfraccion,
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
   * Agenda una sanción compensatoria: crea la `Sancion` (reusando `SancionesService.crearEnTx`) y
   * marca la infracción `sancionada` con `sancionId`, todo en UNA transacción: si cualquiera falla
   * (sin regla, estado inválido) no queda ni sanción huérfana ni infracción marcada.
   *
   * El hecho es inmutable: regla, sujeto (el conductor), motivo, fecha del hecho y evidencia salen
   * de la infracción, nunca del cliente; el cliente solo agenda el cumplimiento. `espera_corta` es
   * solo alerta (decisión del CTO) → 409.
   */
  async sancionar(actor: AuthenticatedUser, id: string, data: SancionarInfraccion): Promise<Infraccion> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const infraccion = await tx.infraccion.findUnique({ where: { id } });
      if (!infraccion) {
        throw new NotFoundException('Infracción no encontrada');
      }
      if ((TIPOS_INFRACCION_SOLO_ALERTA as readonly string[]).includes(infraccion.tipo)) {
        throw new ConflictException('Una infracción de espera corta en Molinos es solo una alerta: no se puede sancionar');
      }
      const { min, max } = rangoCumplimiento(fechaActualBolivia().toISOString().slice(0, 10));
      const dia = data.fechaCumplimiento.toISOString().slice(0, 10);
      if (dia < min || dia > max) {
        throw new BadRequestException(`El día de cumplimiento debe estar entre ${min} y ${max}`);
      }
      const reglas = await tx.regla.findMany({ where: { sindicatoId: infraccion.sindicatoId, estado: 'activo' } });
      const reglaId = reglaInicialSancion({ reglaId: infraccion.reglaId, tipo: infraccion.tipo as Infraccion['tipo'] }, reglas);
      if (!reglaId) {
        throw new ConflictException(`No hay una regla activa para infracciones de tipo "${infraccion.tipo}"`);
      }
      // Numeración del motivo (inmutable) = la del panel: PCs activos sin `espera`. shortcut: la infracción
      // no guarda la variante, así que no se inserta el PC de espera designado; revisar si se guarda `varianteId`.
      const pcs = await tx.puntoControl.findMany({
        where: { rutaId: infraccion.rutaId, estado: 'activo' },
        orderBy: { orden: 'asc' },
        select: { id: true, rol: true },
      });
      const idsPc = pcs.filter((p) => p.rol !== 'espera').map((p) => p.id);
      const vehiculo = await tx.vehiculo.findUnique({ where: { id: infraccion.vehiculoId }, select: { placa: true } });
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
        sindicatoId: infraccion.sindicatoId,
        reglaId,
        sujetoTipo: 'conductor',
        sujetoId: infraccion.conductorId,
        motivo: motivoSancion(
          { tipo: infraccion.tipo as Infraccion['tipo'], detalle: infraccion.detalle as Infraccion['detalle'], inicioTs: infraccion.inicioTs },
          vehiculo?.placa,
          idsPc,
        ),
        fechaHecho: fechaActualBolivia(infraccion.inicioTs),
        evidenciaRef: `infraccion:${infraccion.id} sesion:${infraccion.sesionId}`,
        fechaCumplimiento: data.fechaCumplimiento,
        vueltas: data.vueltas,
        turno: data.turno,
        paradaSalida: data.paradaSalida,
      });
      const actualizada = await tx.infraccion.update({
        where: { id },
        data: { sancionId: sancion.id },
      });
      return toInfraccion(actualizada);
    });
  }
}
