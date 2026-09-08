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
    // `estado: { not: 'inactivo' }` — unicidad de placa (docs/plan-unicidad-placa.md): la
    // base sólo garantiza (índice único parcial) que no colisionen dos filas VIGENTES; un
    // vehículo `inactivo` con esta misma placa no es un conflicto real, es exactamente el
    // caso de migración de sindicato que el modelo permite a propósito. Sin este filtro,
    // `asegurarPlacaDisponible` bloquearía por error ese re-registro.
    const coincidencia = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.vehiculo.findFirst({
        where: {
          placaNormalizada,
          estado: { not: 'inactivo' },
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
    await asegurarPlacaDisponible(this, actor, data.placa);

    try {
      const vehiculo = await withTenantContext(toTenantContext(actor), async (tx) => {
        await validarSocioDelSindicato(tx, data.socioId, sindicatoId);
        // `placaNormalizada` NO se escribe: unicidad de placa (docs/plan-unicidad-placa.md)
        // la volvió columna GENERATED ALWAYS — la base la deriva sola de `placa` y rechaza
        // (SQLSTATE 428C9) cualquier intento de escribirla a mano.
        const creado = await tx.vehiculo.create({
          data: {
            ...limpiarDatosVehiculo(data),
            sindicatoId,
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
        // Mensaje alineado con `asegurarPlacaDisponible` (más abajo): el conflicto único
        // sólo puede darse contra un vehículo VIGENTE (el índice es parcial, `WHERE estado
        // <> 'inactivo'`), así que "ya existe" a secas es incompleto — el camino de salida
        // real es dar de baja el otro vehículo, no "eliminar un duplicado".
        throw new ConflictException(
          'Ya existe un vehículo VIGENTE con esta placa. Para reasignar la placa, primero hay que dar de baja (estado inactivo) ese vehículo.',
        );
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
        // `placaNormalizada` NO se escribe (ver comentario en `crear`) — cambiar `placa`
        // alcanza, la base recalcula la columna generada sola.
        const cambios = limpiarDatosVehiculo(data);
        if (anterior.estado === 'activo') {
          validarRequisitosActivacion({ ...anterior, ...cambios });
        }
        return tx.vehiculo.update({ where: { id }, data: cambios });
      });
      return toVehiculo(vehiculo);
    } catch (error: unknown) {
      if (esConflictoUnico(error)) {
        // Mensaje alineado con `asegurarPlacaDisponible` (más abajo): el conflicto único
        // sólo puede darse contra un vehículo VIGENTE (el índice es parcial, `WHERE estado
        // <> 'inactivo'`), así que "ya existe" a secas es incompleto — el camino de salida
        // real es dar de baja el otro vehículo, no "eliminar un duplicado".
        throw new ConflictException(
          'Ya existe un vehículo VIGENTE con esta placa. Para reasignar la placa, primero hay que dar de baja (estado inactivo) ese vehículo.',
        );
      }
      throw error;
    }
  }

  async cambiarEstado(
    actor: AuthenticatedUser,
    id: string,
    data: CambiarEstadoVehiculo,
  ): Promise<Vehiculo> {
    // Capturados fuera de la transacción (que se revierte si el UPDATE choca con el índice
    // único) para poder resolver, en el catch, quién tiene la placa hoy.
    let placaAnterior: string | undefined;
    let sindicatoIdAnterior: string | undefined;
    try {
      const vehiculo = await withTenantContext(toTenantContext(actor), async (tx) => {
        const anterior = await tx.vehiculo.findUnique({ where: { id } });
        if (!anterior) {
          throw new NotFoundException('Vehículo no encontrado');
        }
        placaAnterior = anterior.placa;
        sindicatoIdAnterior = anterior.sindicatoId;
        const desde = anterior.estado as EstadoVehiculo;
        validarTransicion(desde, data.estado);
        if (data.estado === desde) {
          return anterior;
        }
        if (data.estado === 'activo') {
          validarRequisitosActivacion(anterior);
        }
        // Reactivar (`inactivo -> activo`) puede violar el índice único parcial
        // (unicidad de placa, docs/plan-unicidad-placa.md) si, mientras este vehículo
        // estaba de baja, alguien más registró la misma placa en otro lugar. A diferencia
        // de `crear`/`actualizar`, acá no hay un `asegurarPlacaDisponible` previo que lo
        // detecte antes del UPDATE — el catch de abajo es la única red.
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
    } catch (error: unknown) {
      if (esConflictoUnico(error)) {
        // El vehículo que bloquea puede ser de OTRO sindicato: en ese caso "dar de baja ese
        // vehículo" es una instrucción imposible de seguir (RLS impide tocar vehículos de
        // otro sindicato) y deja al operador sin salida. Reusamos `verificarPlaca` (corre
        // bajo CONTEXTO_ADMIN, ve todos los sindicatos) para distinguir los dos casos y dar
        // una instrucción que el operador realmente pueda ejecutar.
        if (placaAnterior) {
          const verificacion = await this.verificarPlaca(actor, placaAnterior, id);
          const coincidencia = verificacion.coincidencia;
          if (coincidencia && coincidencia.sindicatoId === sindicatoIdAnterior) {
            throw new ConflictException(
              `No se puede reactivar este vehículo: la placa ${coincidencia.placa} ya está vigente en otro vehículo de este mismo sindicato (id ${coincidencia.vehiculoId}). Hay que dar de baja ese vehículo primero.`,
            );
          }
          if (coincidencia) {
            throw new ConflictException(
              `No se puede reactivar este vehículo: la placa ${coincidencia.placa} ya está vigente en un vehículo de ${coincidencia.sindicatoNombre}. Este caso no se resuelve desde el panel — contactá a QUIVO para coordinarlo.`,
            );
          }
        }
        // Red de contención: no debería llegar acá (el P2002 implica que `verificarPlaca`
        // debería haber encontrado la fila que colisiona), pero por las dudas — condición de
        // carrera resuelta entre el UPDATE y esta segunda consulta — no dejamos al operador
        // sin ningún mensaje.
        throw new ConflictException(
          'No se puede reactivar este vehículo: ya hay otro vehículo vigente con esta placa. Hay que dar de baja ese otro vehículo primero.',
        );
      }
      throw error;
    }
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

// Perdió el chequeo `!row.placaNormalizada` — unicidad de placa (docs/plan-unicidad-placa.md)
// volvió `placaNormalizada` una columna GENERATED ALWAYS NOT NULL: la base la rellena sola y
// nunca puede faltar. La duplicidad tampoco puede colarse hasta acá: el índice único (parcial,
// entre vigentes) la rechaza en el INSERT/UPDATE, antes de llegar a esta validación.
function validarRequisitosActivacion(row: {
  socioId: string | null;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  capacidad: number;
}): void {
  const faltantes: string[] = [];
  if (!row.socioId) faltantes.push('socio propietario');
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
    // "Dar de baja" y no "ya existe" a secas: `verificarPlaca` ya excluye los `inactivo`
    // (unicidad de placa, docs/plan-unicidad-placa.md), así que si esto dispara es SIEMPRE
    // contra un vehículo VIGENTE — el mensaje le dice al operador la única salida real
    // (dar de baja el vehículo que tiene la placa, no "buscar el duplicado y borrarlo").
    throw new ConflictException(
      `Ya existe un vehículo VIGENTE con esta placa en ${verificacion.coincidencia?.sindicatoNombre ?? 'otro sindicato'}. Para reasignar la placa, primero hay que dar de baja (estado inactivo) ese vehículo.`,
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
  placaNormalizada: string;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  colorSecundario: string | null;
  numeroInterno: string | null;
  distintivo: string | null;
  cartelSuperior: string | null;
  capacidad: number;
  estado: string;
}): Vehiculo {
  // Sin fallback `?? normalizarPlacaVehiculo(row.placa)`: unicidad de placa
  // (docs/plan-unicidad-placa.md) volvió `placaNormalizada` NOT NULL en la base — el
  // fallback existía para el caso `null` que ya no puede ocurrir.
  return VehiculoSchema.parse(row);
}
