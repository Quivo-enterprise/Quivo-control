import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  VehiculoSchema,
  type ActualizarVehiculo,
  type CrearVehiculo,
  type EstadoVehiculo,
  type Vehiculo,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Transiciones de estado válidas (RF-10..14) — no está detallado en el doc técnico más
 * allá de listar los 4 estados posibles, así que esto es una regla razonable pero asumida
 * por este service, no una decisión de Producto confirmada: desde `activo` se puede pasar a
 * cualquier otro estado; desde `inactivo`/`suspendido`/`mantenimiento` solo se puede volver
 * a `activo` (sin transiciones directas entre esos tres). Ajustar acá si Producto define
 * otra cosa.
 */
const TRANSICIONES_VALIDAS: Record<EstadoVehiculo, EstadoVehiculo[]> = {
  activo: ['activo', 'inactivo', 'suspendido', 'mantenimiento'],
  inactivo: ['inactivo', 'activo'],
  suspendido: ['suspendido', 'activo'],
  mantenimiento: ['mantenimiento', 'activo'],
};

@Injectable()
export class VehiculosService {
  async listar(actor: AuthenticatedUser): Promise<Vehiculo[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.vehiculo.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { placa: 'asc' },
      }),
    );
    return rows.map(toVehiculo);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Vehiculo> {
    const vehiculo = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.vehiculo.findUnique({ where: { id } }),
    );
    if (!vehiculo) {
      throw new NotFoundException('Vehículo no encontrado');
    }
    return toVehiculo(vehiculo);
  }

  async crear(actor: AuthenticatedUser, data: CrearVehiculo): Promise<Vehiculo> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    const vehiculo = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.vehiculo.create({ data: { ...data, sindicatoId } }),
    );
    return toVehiculo(vehiculo);
  }

  async actualizar(actor: AuthenticatedUser, id: string, data: ActualizarVehiculo): Promise<Vehiculo> {
    const vehiculo = await withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await tx.vehiculo.findUnique({ where: { id } });
      if (!anterior) {
        throw new NotFoundException('Vehículo no encontrado');
      }
      if (data.estado) {
        validarTransicion(anterior.estado as EstadoVehiculo, data.estado);
      }
      return tx.vehiculo.update({ where: { id }, data });
    });
    return toVehiculo(vehiculo);
  }
}

function validarTransicion(desde: EstadoVehiculo, hacia: EstadoVehiculo): void {
  if (!TRANSICIONES_VALIDAS[desde].includes(hacia)) {
    throw new BadRequestException(`Transición de estado inválida: "${desde}" → "${hacia}"`);
  }
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function resolverSindicatoId(actor: AuthenticatedUser, sindicatoIdDelBody: string): string {
  if (actor.sindicatoId) {
    return actor.sindicatoId;
  }
  if (!sindicatoIdDelBody) {
    throw new BadRequestException('sindicatoId es obligatorio para admin_quivo');
  }
  return sindicatoIdDelBody;
}

/** `credencialHash` nunca sale en la respuesta — es un campo de escritura interna (login
 * por vehículo, QUI-235), no parte del contrato público `VehiculoSchema`. */
function toVehiculo(row: {
  id: string;
  sindicatoId: string;
  socioId: string | null;
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  capacidad: number;
  estado: string;
}): Vehiculo {
  return VehiculoSchema.parse(row);
}
