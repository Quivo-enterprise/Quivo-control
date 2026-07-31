import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  AsignacionSchema,
  RotacionSchema,
  type ActualizarAsignacion,
  type Asignacion,
  type CrearAsignacionManual,
  type GenerarRotacion,
  type Rotacion,
} from '@quivo/shared';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';
import { finDeJornadaBolivia } from '../../common/tiempo/jornada.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const CONFLICTO_UNICIDAD = 'P2002';

@Injectable()
export class RotacionesService {
  async generar(actor: AuthenticatedUser, data: GenerarRotacion): Promise<Rotacion & { asignaciones: Asignacion[] }> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);

    return withTenantContext(toTenantContext(actor), async (tx) => {
      // Cada ruta debe ser visible para este tenant (no tienen sindicatoId propio, se
      // resuelve transitivamente vía linea — mismo check que usan rutas/paradas/puntos de
      // control, ver common/geo/tenant-checks.ts).
      for (const rutaId of data.rutaIds) {
        const ruta = await asegurarRutaVisible(tx, rutaId);
        if (ruta.sindicatoId !== sindicatoId) {
          throw new NotFoundException(`Ruta ${rutaId} no encontrada`);
        }
      }

      const [vehiculos, conductores] = await Promise.all([
        tx.vehiculo.findMany({ where: { sindicatoId, estado: 'activo' }, orderBy: { placa: 'asc' } }),
        tx.conductor.findMany({ where: { sindicatoId, estado: 'activo' }, orderBy: { nombre: 'asc' } }),
      ]);
      if (vehiculos.length === 0) {
        throw new BadRequestException('El sindicato no tiene vehículos activos para repartir');
      }

      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: data.periodo, estado: 'borrador' },
      });

      // Ocupación existente de estos vehículos en estas fechas/horarios (de cualquier
      // rotación, no solo esta) — se chequea en memoria ANTES de insertar. Postgres aborta
      // toda la transacción entera al primer error (25P02: "current transaction is
      // aborted"), así que no se puede usar el constraint único como control de flujo acá
      // (a diferencia de crearAsignacion/actualizarAsignacion, que corren en su propia
      // transacción y sí pueden dejar que el 23505 les llegue y traducirlo).
      const fechasOrdenadas = [...data.fechas].sort((a, b) => a.getTime() - b.getTime());
      const existentes = await tx.asignacion.findMany({
        where: {
          vehiculoId: { in: vehiculos.map((v) => v.id) },
          horario: { in: data.horarios },
          fecha: { in: fechasOrdenadas },
        },
        select: { vehiculoId: true, fecha: true, horario: true },
      });
      const ocupados = new Set(existentes.map((a) => claveOcupacion(a.vehiculoId, a.fecha, a.horario)));

      // Reparto round-robin con mejor esfuerzo (ver comentario en GenerarRotacionSchema):
      // si el vehículo que le toca en el turno ya está ocupado esa fecha/horario, se prueba
      // con el siguiente; si se agotan todos, el slot queda sin cubrir en vez de abortar el
      // resto de la generación.
      let vIdx = 0;
      let cIdx = 0;
      let orden = 1;
      const asignaciones: Asignacion[] = [];

      for (const fecha of fechasOrdenadas) {
        for (const horario of data.horarios) {
          for (const rutaId of data.rutaIds) {
            for (let intento = 0; intento < vehiculos.length; intento++) {
              // `vIdx % vehiculos.length` siempre cae dentro del array (ya se validó
              // `vehiculos.length > 0` más arriba) — TS no lo puede inferir solo.
              const vehiculo = vehiculos[vIdx % vehiculos.length]!;
              vIdx++;
              const clave = claveOcupacion(vehiculo.id, fecha, horario);
              if (ocupados.has(clave)) {
                continue;
              }
              const conductor = conductores.length > 0 ? conductores[cIdx % conductores.length] : null;
              const creada = await tx.asignacion.create({
                data: {
                  rotacionId: rotacion.id,
                  vehiculoId: vehiculo.id,
                  conductorId: conductor?.id ?? null,
                  rutaId,
                  fecha,
                  horario,
                  orden: orden++,
                  venceAt: finDeJornadaBolivia(fecha),
                },
              });
              ocupados.add(clave);
              if (conductor) cIdx++;
              asignaciones.push(toAsignacion(creada));
              break;
            }
          }
        }
      }

      return { ...toRotacion(rotacion), asignaciones };
    });
  }

  async listar(actor: AuthenticatedUser): Promise<Rotacion[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.rotacion.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { periodo: 'desc' },
      }),
    );
    return rows.map(toRotacion);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Rotacion & { asignaciones: Asignacion[] }> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const rotacion = await obtenerRotacionOFallar(tx, id);
      const asignaciones = await tx.asignacion.findMany({ where: { rotacionId: id }, orderBy: { orden: 'asc' } });
      return { ...toRotacion(rotacion), asignaciones: asignaciones.map(toAsignacion) };
    });
  }

  async publicar(actor: AuthenticatedUser, id: string): Promise<Rotacion> {
    // `withTenantContext` ya corre el callback dentro de un `$transaction` (packages/db/src/
    // tenant-context.ts) — la publicación es atómica porque vive en esa misma transacción,
    // no porque haga algo especial acá.
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const rotacion = await obtenerRotacionOFallar(tx, id);
      if (rotacion.estado !== 'borrador') {
        throw new BadRequestException('Solo se puede publicar una rotación en borrador');
      }
      const total = await tx.asignacion.count({ where: { rotacionId: id } });
      if (total === 0) {
        throw new BadRequestException('La rotación no tiene asignaciones para publicar');
      }
      const publicada = await tx.rotacion.update({ where: { id }, data: { estado: 'publicada' } });
      return toRotacion(publicada);
    });
  }

  /** Vuelve una rotación publicada a borrador — para corregir un error antes de que la
   * app móvil la consuma. No es un estado nuevo ("anulada"): asunción de este equipo, el
   * doc técnico no detalla qué significa "anular" más allá de mencionar que se audita. */
  async anular(actor: AuthenticatedUser, id: string): Promise<Rotacion> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const rotacion = await obtenerRotacionOFallar(tx, id);
      if (rotacion.estado !== 'publicada') {
        throw new BadRequestException('Solo se puede anular una rotación publicada');
      }
      const anulada = await tx.rotacion.update({ where: { id }, data: { estado: 'borrador' } });
      return toRotacion(anulada);
    });
  }

  async crearAsignacion(actor: AuthenticatedUser, rotacionId: string, data: CrearAsignacionManual): Promise<Asignacion> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRotacionEditable(tx, rotacionId);
      try {
        const creada = await tx.asignacion.create({
          data: {
            rotacionId,
            vehiculoId: data.vehiculoId,
            conductorId: data.conductorId ?? null,
            rutaId: data.rutaId,
            fecha: data.fecha,
            horario: data.horario,
            orden: data.orden,
            venceAt: finDeJornadaBolivia(data.fecha),
          },
        });
        return toAsignacion(creada);
      } catch (error) {
        throw traducirConflicto(error);
      }
    });
  }

  async actualizarAsignacion(
    actor: AuthenticatedUser,
    rotacionId: string,
    asignacionId: string,
    data: ActualizarAsignacion,
  ): Promise<Asignacion> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRotacionEditable(tx, rotacionId);
      await obtenerAsignacionOFallar(tx, rotacionId, asignacionId);
      try {
        const actualizada = await tx.asignacion.update({ where: { id: asignacionId }, data });
        return toAsignacion(actualizada);
      } catch (error) {
        throw traducirConflicto(error);
      }
    });
  }

  // Devuelve `{ id }` (no `void`): el interceptor de auditoría (QUI-230) usa el `id` de la
  // respuesta para saber qué entidad auditar — sin él, caería al `id` de la ruta, que en
  // este endpoint es el de la rotación, no el de la asignación borrada.
  async eliminarAsignacion(
    actor: AuthenticatedUser,
    rotacionId: string,
    asignacionId: string,
  ): Promise<{ id: string }> {
    await withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRotacionEditable(tx, rotacionId);
      await obtenerAsignacionOFallar(tx, rotacionId, asignacionId);
      await tx.asignacion.delete({ where: { id: asignacionId } });
    });
    return { id: asignacionId };
  }

  /** RF-57 (QUI-234): marca `vencida` toda asignación `vigente` cuya `venceAt` ya pasó — la
   * llama el job repeatable de `vencimiento.processor.ts`, no un request de usuario, así que
   * corre cross-tenant como `admin_quivo` (no hay un "actor" real detrás de un cron). Devuelve
   * cuántas filas marcó, para que el processor lo loguee. */
  async marcarVencidas(ahora: Date = new Date()): Promise<number> {
    const { count } = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.updateMany({
        where: { estado: 'vigente', venceAt: { lt: ahora } },
        data: { estado: 'vencida' },
      }),
    );
    return count;
  }
}

async function obtenerRotacionOFallar(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ id: string; sindicatoId: string; periodo: string; estado: string }> {
  const rotacion = await tx.rotacion.findUnique({ where: { id } });
  if (!rotacion) {
    throw new NotFoundException('Rotación no encontrada');
  }
  return rotacion;
}

async function obtenerAsignacionOFallar(
  tx: Prisma.TransactionClient,
  rotacionId: string,
  asignacionId: string,
): Promise<void> {
  const asignacion = await tx.asignacion.findUnique({ where: { id: asignacionId } });
  if (!asignacion || asignacion.rotacionId !== rotacionId) {
    throw new NotFoundException('Asignación no encontrada');
  }
}

async function asegurarRotacionEditable(tx: Prisma.TransactionClient, rotacionId: string): Promise<void> {
  const rotacion = await obtenerRotacionOFallar(tx, rotacionId);
  if (rotacion.estado !== 'borrador') {
    throw new BadRequestException('Solo se pueden editar asignaciones de una rotación en borrador');
  }
}

function claveOcupacion(vehiculoId: string, fecha: Date, horario: string): string {
  return `${vehiculoId}|${fecha.toISOString().slice(0, 10)}|${horario}`;
}

function esConflictoUnicidad(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === CONFLICTO_UNICIDAD;
}

/** El `@@unique([vehiculoId, fecha, horario])` del schema (QUI-231) es la barrera real —
 * esto solo traduce el P2002 de Postgres a un 409 legible en vez de un 500 genérico. */
function traducirConflicto(error: unknown): unknown {
  if (esConflictoUnicidad(error)) {
    return new ConflictException('Ese vehículo ya tiene una asignación en esa fecha y horario');
  }
  return error;
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

function toRotacion(row: { id: string; sindicatoId: string; periodo: string; estado: string }): Rotacion {
  return RotacionSchema.parse(row);
}

function toAsignacion(row: {
  id: string;
  rotacionId: string;
  vehiculoId: string;
  conductorId: string | null;
  rutaId: string;
  fecha: Date;
  horario: string;
  orden: number;
  venceAt: Date;
  estado: string;
}): Asignacion {
  return AsignacionSchema.parse(row);
}
