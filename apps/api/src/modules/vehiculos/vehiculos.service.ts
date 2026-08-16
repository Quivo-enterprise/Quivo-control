import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  ColorVehiculoSchema,
  HistorialEstadoVehiculoSchema,
  MarcaVehiculoSchema,
  ModeloVehiculoSchema,
  PlacaVehiculoSchema,
  TipoVehiculoSchema,
  VehiculoSchema,
  normalizarPlacaVehiculo,
  type ActualizarVehiculo,
  type CambiarEstadoVehiculo,
  type CrearVehiculo,
  type EstadoVehiculo,
  type HistorialEstadoVehiculo,
  type VerificacionPlacaVehiculo,
  type Vehiculo,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { mapearTolerante } from '../../common/validation/filas-tolerantes.util.js';

const TRANSICIONES_VALIDAS: Record<EstadoVehiculo, EstadoVehiculo[]> = {
  pendiente: ['pendiente', 'activo', 'inactivo'],
  activo: ['activo', 'inactivo', 'suspendido', 'mantenimiento'],
  inactivo: ['inactivo', 'activo'],
  suspendido: ['suspendido', 'activo', 'inactivo'],
  mantenimiento: ['mantenimiento', 'activo', 'inactivo'],
};

const CONTEXTO_ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;

@Injectable()
export class VehiculosService {
  private readonly logger = new Logger(VehiculosService.name);

  async listar(actor: AuthenticatedUser): Promise<Vehiculo[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.vehiculo.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { placa: 'asc' },
      }),
    );
    // QUI-366: una fila con datos corruptos/placeholder (ej. el vehículo piloto con
    // `color: 'PLACEHOLDER'`) no debe tumbar el listado completo — se omite y se loguea
    // (ver mapearTolerante), el resto de las filas válidas sí llega al usuario.
    return mapearTolerante(rows, toVehiculo, this.logger, 'Vehículo');
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

  async verificarPlaca(
    _actor: AuthenticatedUser,
    placa: string,
    excluirVehiculoId?: string,
  ): Promise<VerificacionPlacaVehiculo> {
    const placaValida = PlacaVehiculoSchema.safeParse(placa);
    if (!placaValida.success) {
      throw new BadRequestException(
        placaValida.error.issues[0]?.message ?? 'La placa no es válida.',
      );
    }
    const placaNormalizada = normalizarPlacaVehiculo(placaValida.data);
    const coincidencia = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.vehiculo.findFirst({
        where: {
          placaNormalizada,
          ...(excluirVehiculoId ? { id: { not: excluirVehiculoId } } : {}),
        },
        select: {
          id: true,
          placa: true,
          sindicatoId: true,
          sindicato: { select: { nombre: true } },
        },
      }),
    );
    return {
      placaNormalizada,
      disponible: !coincidencia,
      coincidencia: coincidencia
        ? {
            vehiculoId: coincidencia.id,
            placa: coincidencia.placa,
            sindicatoId: coincidencia.sindicatoId,
            sindicatoNombre: coincidencia.sindicato.nombre,
          }
        : null,
    };
  }

  async crear(actor: AuthenticatedUser, data: CrearVehiculo): Promise<Vehiculo> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);
    validarTipoAutorizado(actor, data.tipo);
    const placaNormalizada = normalizarPlacaVehiculo(data.placa);
    await asegurarPlacaDisponible(this, actor, data.placa);

    try {
      const vehiculo = await withTenantContext(toTenantContext(actor), async (tx) => {
        await validarSocioDelSindicato(tx, data.socioId, sindicatoId);
        const creado = await tx.vehiculo.create({
          data: {
            ...limpiarDatosVehiculo(data),
            sindicatoId,
            placaNormalizada,
            estado: 'pendiente',
          },
        });
        await tx.historialEstadoVehiculo.create({
          data: {
            sindicatoId,
            vehiculoId: creado.id,
            estadoDesde: null,
            estadoHasta: 'pendiente',
            actorId: actor.userId,
          },
        });
        return creado;
      });
      return toVehiculo(vehiculo);
    } catch (error: unknown) {
      if (esConflictoUnico(error)) {
        throw new ConflictException('Ya existe un vehículo registrado con esta placa.');
      }
      throw error;
    }
  }

  async actualizar(
    actor: AuthenticatedUser,
    id: string,
    data: ActualizarVehiculo,
  ): Promise<Vehiculo> {
    if (data.tipo) {
      validarTipoAutorizado(actor, data.tipo);
    }
    if (data.placa) {
      await asegurarPlacaDisponible(this, actor, data.placa, id);
    }
    try {
      const vehiculo = await withTenantContext(toTenantContext(actor), async (tx) => {
        const anterior = await tx.vehiculo.findUnique({ where: { id } });
        if (!anterior) {
          throw new NotFoundException('Vehículo no encontrado');
        }
        await validarSocioDelSindicato(tx, data.socioId, anterior.sindicatoId);
        const cambios = {
          ...limpiarDatosVehiculo(data),
          ...(data.placa ? { placaNormalizada: normalizarPlacaVehiculo(data.placa) } : {}),
        };
        if (anterior.estado === 'activo') {
          validarRequisitosActivacion({ ...anterior, ...cambios });
        }
        return tx.vehiculo.update({ where: { id }, data: cambios });
      });
      return toVehiculo(vehiculo);
    } catch (error: unknown) {
      if (esConflictoUnico(error)) {
        throw new ConflictException('Ya existe un vehículo registrado con esta placa.');
      }
      throw error;
    }
  }

  async cambiarEstado(
    actor: AuthenticatedUser,
    id: string,
    data: CambiarEstadoVehiculo,
  ): Promise<Vehiculo> {
    const vehiculo = await withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await tx.vehiculo.findUnique({ where: { id } });
      if (!anterior) {
        throw new NotFoundException('Vehículo no encontrado');
      }
      const desde = anterior.estado as EstadoVehiculo;
      validarTransicion(desde, data.estado);
      if (data.estado === desde) {
        return anterior;
      }
      if (data.estado === 'activo') {
        validarRequisitosActivacion(anterior);
      }
      const actualizado = await tx.vehiculo.update({
        where: { id },
        data: { estado: data.estado },
      });
      await tx.historialEstadoVehiculo.create({
        data: {
          sindicatoId: anterior.sindicatoId,
          vehiculoId: anterior.id,
          estadoDesde: desde,
          estadoHasta: data.estado,
          motivo: data.motivo || null,
          observacion: data.observacion || null,
          retornoEstimado: data.retornoEstimado ? new Date(data.retornoEstimado) : null,
          actorId: actor.userId,
        },
      });
      return actualizado;
    });
    return toVehiculo(vehiculo);
  }

  async historialEstados(actor: AuthenticatedUser, id: string): Promise<HistorialEstadoVehiculo[]> {
    await this.obtener(actor, id);
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.historialEstadoVehiculo.findMany({
        where: { vehiculoId: id },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((row) =>
      HistorialEstadoVehiculoSchema.parse({
        ...row,
        retornoEstimado: row.retornoEstimado?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  }
}

function validarTransicion(desde: EstadoVehiculo, hacia: EstadoVehiculo): void {
  if (!TRANSICIONES_VALIDAS[desde].includes(hacia)) {
    throw new BadRequestException(`Transición de estado inválida: "${desde}" → "${hacia}"`);
  }
}

function validarRequisitosActivacion(row: {
  socioId: string | null;
  placaNormalizada: string | null;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  capacidad: number;
}): void {
  const faltantes: string[] = [];
  if (!row.socioId) faltantes.push('socio propietario');
  if (!row.placaNormalizada) faltantes.push('placa válida y sin duplicidad');
  if (!TipoVehiculoSchema.safeParse(row.tipo).success) faltantes.push('tipo de vehículo');
  if (!MarcaVehiculoSchema.safeParse(row.marca).success) faltantes.push('marca');
  if (!ModeloVehiculoSchema.safeParse(row.modelo).success) faltantes.push('modelo');
  if (!ColorVehiculoSchema.safeParse(row.color).success) faltantes.push('color principal');
  if (!Number.isInteger(row.capacidad) || row.capacidad <= 0) faltantes.push('capacidad');
  if (faltantes.length > 0) {
    throw new BadRequestException(
      `No se puede activar el vehículo. Revisa: ${faltantes.join(', ')}.`,
    );
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

function validarTipoAutorizado(actor: AuthenticatedUser, tipo: string): void {
  if (tipo === 'otro' && actor.rol !== 'admin_quivo') {
    throw new BadRequestException('El tipo “Otro autorizado” requiere permiso de admin_quivo.');
  }
}

async function validarSocioDelSindicato(
  tx: {
    socio: {
      findFirst: (args: {
        where: { id: string; sindicatoId: string; estado: string };
      }) => Promise<unknown>;
    };
  },
  socioId: string | null | undefined,
  sindicatoId: string,
): Promise<void> {
  if (socioId === undefined || socioId === null) {
    return;
  }
  const socio = await tx.socio.findFirst({ where: { id: socioId, sindicatoId, estado: 'activo' } });
  if (!socio) {
    throw new BadRequestException(
      'El socio propietario debe estar activo y pertenecer al mismo sindicato.',
    );
  }
}

function limpiarDatosVehiculo<T extends ActualizarVehiculo | CrearVehiculo>(data: T): T {
  return {
    ...data,
    ...(data.placa ? { placa: data.placa.trim().toUpperCase() } : {}),
    ...(data.marca ? { marca: normalizarEspacios(data.marca) } : {}),
    ...(data.modelo ? { modelo: normalizarEspacios(data.modelo) } : {}),
  };
}

function normalizarEspacios(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ');
}

async function asegurarPlacaDisponible(
  service: VehiculosService,
  actor: AuthenticatedUser,
  placa: string,
  excluirVehiculoId?: string,
): Promise<void> {
  const verificacion = await service.verificarPlaca(actor, placa, excluirVehiculoId);
  if (!verificacion.disponible) {
    throw new ConflictException(
      `Ya existe un vehículo registrado con esta placa en ${verificacion.coincidencia?.sindicatoNombre ?? 'otro sindicato'}.`,
    );
  }
}

function esConflictoUnico(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** `credencialHash` nunca sale en la respuesta — es un campo de escritura interna (login
 * por vehículo, QUI-235), no parte del contrato público `VehiculoSchema`. */
function toVehiculo(row: {
  id: string;
  sindicatoId: string;
  socioId: string | null;
  placa: string;
  placaNormalizada: string | null;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  colorSecundario: string | null;
  capacidad: number;
  estado: string;
}): Vehiculo {
  return VehiculoSchema.parse({
    ...row,
    placaNormalizada: row.placaNormalizada ?? normalizarPlacaVehiculo(row.placa),
  });
}
