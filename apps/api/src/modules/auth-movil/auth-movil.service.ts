import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  TurnoSchema,
  type AuthConductorMovilRequest,
  type AuthConductorMovilResponse,
  type AuthVehiculoMovilRequest,
  type AuthVehiculoMovilResponse,
  type ContextoOperativoMovil,
  type EstablecerPinMovilRequest,
  type LogoutMovilRequest,
  type RefreshMovilRequest,
  type RefreshMovilResponse,
  type ResumenAsignacionMovil,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { fechaActualBolivia } from '../../common/tiempo/jornada.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';
import { emitirTokenOpaco, hashTokenOpaco } from './token-opaco.js';

const CONTEXTO_ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;
const MAX_INTENTOS_CONDUCTOR = 5;
const DUMMY_HASH_PROMISE = hashPassword('000000');

type Tx = Prisma.TransactionClient;

type VehiculoCredencial = {
  id: string;
  sindicatoId: string;
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  credencialHash: string | null;
};

type AsignacionOperativa = Prisma.AsignacionGetPayload<{
  include: {
    vehiculo: true;
    conductor: true;
    rotacion: { include: { sindicato: true } };
    ruta: { include: { linea: true } };
  };
}>;

@Injectable()
export class AuthMovilService {
  async autenticarVehiculo(data: AuthVehiculoMovilRequest): Promise<AuthVehiculoMovilResponse> {
    const placaNormalizada = normalizarPlaca(data.placa);
    const candidatos = await withTenantContext(
      CONTEXTO_ADMIN,
      (tx) =>
        tx.$queryRaw<VehiculoCredencial[]>`
        SELECT id, "sindicatoId", placa, tipo, marca, modelo, "credencialHash"
        FROM vehiculos
        WHERE estado = 'activo'
          AND (
            "placaNormalizada" = ${placaNormalizada}
            OR (
              "placaNormalizada" IS NULL
              AND regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = ${placaNormalizada}
            )
          )
      `,
    );

    const verificaciones = await Promise.all(
      candidatos.map(async (vehiculo) => ({
        vehiculo,
        valido: await verificarCredencial(data.pin, vehiculo.credencialHash),
      })),
    );
    if (candidatos.length === 0) {
      await verificarCredencial(data.pin, await DUMMY_HASH_PROMISE);
    }
    const validos = verificaciones.filter(({ valido }) => valido);
    if (validos.length !== 1) {
      throw credencialesInvalidas();
    }

    const vehiculo = validos[0]!.vehiculo;
    const token = emitirTokenOpaco('challenge');
    const expiresAt = sumarSegundos(new Date(), ttlSegundos('MOBILE_CHALLENGE_TTL_SECONDS', 300));

    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      await tx.desafioAuthMovil.deleteMany({
        where: {
          vehiculoId: vehiculo.id,
          OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }],
        },
      });
      await tx.desafioAuthMovil.create({
        data: {
          sindicatoId: vehiculo.sindicatoId,
          vehiculoId: vehiculo.id,
          tokenHash: token.hash,
          deviceId: data.deviceId,
          expiresAt,
        },
      });
    });

    return {
      challengeToken: token.value,
      expiresAt: expiresAt.toISOString(),
      vehiculo: { placa: vehiculo.placa, tipo: vehiculo.tipo, marca: vehiculo.marca, modelo: vehiculo.modelo },
    };
  }

  async autenticarConductor(data: AuthConductorMovilRequest): Promise<AuthConductorMovilResponse> {
    const ahora = new Date();
    const desafio = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.desafioAuthMovil.findUnique({ where: { tokenHash: hashTokenOpaco(data.challengeToken) } }),
    );
    if (
      !desafio ||
      desafio.consumedAt ||
      desafio.expiresAt <= ahora ||
      desafio.deviceId !== data.deviceId ||
      desafio.intentosConductor >= MAX_INTENTOS_CONDUCTOR
    ) {
      throw credencialesInvalidas();
    }

    let conductorId = desafio.conductorId;
    if (!conductorId) {
      const documentoIdentidad = data.documentoIdentidad;
      const pin = data.pin;
      if (!documentoIdentidad || !pin) {
        throw credencialesInvalidas();
      }
      const candidatos = await withTenantContext(
        { rol: 'conductor', sindicatoId: desafio.sindicatoId },
        (tx) =>
          tx.conductor.findMany({
            where: {
              sindicatoId: desafio.sindicatoId,
              estado: 'activo',
              documentoIdentidad: { equals: documentoIdentidad.trim(), mode: 'insensitive' },
            },
            select: { id: true, credencialHash: true },
          }),
      );
      if (candidatos.length === 0) {
        await verificarCredencial(pin, await DUMMY_HASH_PROMISE);
      }
      const verificaciones = await Promise.all(
        candidatos.map(async (candidato) => ({
          id: candidato.id,
          valido: await verificarCredencial(pin, candidato.credencialHash),
        })),
      );
      const validos = verificaciones.filter(({ valido }) => valido);
      if (validos.length !== 1) {
        await this.registrarIntentoFallido(desafio.id);
        throw credencialesInvalidas();
      }
      conductorId = validos[0]!.id;
      await withTenantContext(CONTEXTO_ADMIN, (tx) =>
        tx.desafioAuthMovil.update({ where: { id: desafio.id }, data: { conductorId } }),
      );
    }

    const asignaciones = await this.buscarAsignaciones(desafio, conductorId, ahora);
    if (asignaciones.length === 0) {
      throw new NotFoundException(
        'No existe una asignación publicada vigente para este vehículo y chofer',
      );
    }

    const asignacionId = data.asignacionId;
    if (!asignacionId && asignaciones.length > 1) {
      return {
        status: 'seleccion_requerida',
        asignaciones: asignaciones.map(toResumenAsignacion),
      };
    }
    const asignacion = asignacionId
      ? asignaciones.find(({ id }) => id === asignacionId)
      : asignaciones[0];
    if (!asignacion) {
      throw new NotFoundException('Asignación no disponible');
    }

    const access = emitirTokenOpaco('access');
    const refresh = emitirTokenOpaco('refresh');
    const accessTokenExpiresAt = sumarSegundos(
      ahora,
      ttlSegundos('MOBILE_ACCESS_TTL_SECONDS', 15 * 60),
    );
    const refreshTokenExpiresAt = sumarSegundos(
      ahora,
      ttlSegundos('MOBILE_REFRESH_TTL_SECONDS', 30 * 24 * 60 * 60),
    );

    const sesion = await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      const consumido = await tx.desafioAuthMovil.updateMany({
        where: { id: desafio.id, consumedAt: null, expiresAt: { gt: ahora } },
        data: { consumedAt: ahora },
      });
      if (consumido.count !== 1) {
        throw credencialesInvalidas();
      }
      await tx.sesionOperativa.updateMany({
        where: { deviceId: desafio.deviceId, estado: 'activa', revokedAt: null },
        data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
      });
      return tx.sesionOperativa.create({
        data: {
          sindicatoId: desafio.sindicatoId,
          asignacionId: asignacion.id,
          vehiculoId: desafio.vehiculoId,
          conductorId,
          deviceId: desafio.deviceId,
          accessTokenHash: access.hash,
          refreshTokenHash: refresh.hash,
          accessExpiresAt: accessTokenExpiresAt,
          refreshExpiresAt: refreshTokenExpiresAt,
        },
      });
    });

    return {
      status: 'autenticado',
      accessToken: access.value,
      refreshToken: refresh.value,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
      contexto: toContextoOperativo(sesion.id, asignacion),
    };
  }

  async validarAccessToken(accessToken: string): Promise<SesionMovilAutenticada> {
    const sesion = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.findUnique({ where: { accessTokenHash: hashTokenOpaco(accessToken) } }),
    );
    if (
      !sesion ||
      sesion.estado !== 'activa' ||
      sesion.revokedAt ||
      sesion.accessExpiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }
    return {
      sesionId: sesion.id,
      sindicatoId: sesion.sindicatoId,
      asignacionId: sesion.asignacionId,
      vehiculoId: sesion.vehiculoId,
      conductorId: sesion.conductorId,
      deviceId: sesion.deviceId,
    };
  }

  async obtenerContexto(sesionActual: SesionMovilAutenticada): Promise<ContextoOperativoMovil> {
    const sesion = await withTenantContext(
      { rol: 'conductor', sindicatoId: sesionActual.sindicatoId },
      (tx) =>
        tx.sesionOperativa.findUnique({
          where: { id: sesionActual.sesionId },
          include: includeAsignacionSesion,
        }),
    );
    if (!sesion || sesion.revokedAt || sesion.estado !== 'activa') {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }
    return toContextoOperativo(sesion.id, sesion.asignacion);
  }

  async refresh({ refreshToken }: RefreshMovilRequest): Promise<RefreshMovilResponse> {
    const ahora = new Date();
    const hashAnterior = hashTokenOpaco(refreshToken);
    const sesion = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.findUnique({ where: { refreshTokenHash: hashAnterior } }),
    );
    if (
      !sesion ||
      sesion.revokedAt ||
      sesion.estado !== 'activa' ||
      sesion.refreshExpiresAt <= ahora
    ) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }

    const access = emitirTokenOpaco('access');
    const refreshNuevo = emitirTokenOpaco('refresh');
    const accessTokenExpiresAt = sumarSegundos(
      ahora,
      ttlSegundos('MOBILE_ACCESS_TTL_SECONDS', 15 * 60),
    );
    const rotado = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.updateMany({
        where: { id: sesion.id, refreshTokenHash: hashAnterior, revokedAt: null, estado: 'activa' },
        data: {
          accessTokenHash: access.hash,
          refreshTokenHash: refreshNuevo.hash,
          accessExpiresAt: accessTokenExpiresAt,
        },
      }),
    );
    if (rotado.count !== 1) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }
    return {
      accessToken: access.value,
      refreshToken: refreshNuevo.value,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: sesion.refreshExpiresAt.toISOString(),
    };
  }

  async logout({ refreshToken }: LogoutMovilRequest): Promise<void> {
    const ahora = new Date();
    await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.updateMany({
        where: {
          refreshTokenHash: hashTokenOpaco(refreshToken),
          estado: 'activa',
          revokedAt: null,
        },
        data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
      }),
    );
  }

  async establecerPinVehiculo(
    actor: AuthenticatedUser,
    id: string,
    { pin }: EstablecerPinMovilRequest,
  ): Promise<void> {
    await this.establecerPin(actor, 'vehiculo', id, pin);
  }

  async establecerPinConductor(
    actor: AuthenticatedUser,
    id: string,
    { pin }: EstablecerPinMovilRequest,
  ): Promise<void> {
    await this.establecerPin(actor, 'conductor', id, pin);
  }

  private async establecerPin(
    actor: AuthenticatedUser,
    entidad: 'vehiculo' | 'conductor',
    id: string,
    pin: string,
  ): Promise<void> {
    const credencialHash = await hashPassword(pin);
    const contexto = { rol: actor.rol, sindicatoId: actor.sindicatoId };
    const resultado = await withTenantContext(contexto, async (tx) => {
      const ahora = new Date();
      if (entidad === 'vehiculo') {
        const actual = await tx.vehiculo.findUnique({
          where: { id },
          select: { id: true, sindicatoId: true },
        });
        if (!actual) return null;
        await tx.vehiculo.update({ where: { id }, data: { credencialHash } });
        const desafios = await tx.desafioAuthMovil.updateMany({
          where: { vehiculoId: id, consumedAt: null },
          data: { consumedAt: ahora },
        });
        const sesiones = await tx.sesionOperativa.updateMany({
          where: { vehiculoId: id, estado: 'activa', revokedAt: null },
          data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
        });
        await registrarAuditoriaCredencial(tx, actor, entidad, id, actual.sindicatoId, {
          desafiosInvalidados: desafios.count,
          sesionesRevocadas: sesiones.count,
        });
        return actual;
      }
      const actual = await tx.conductor.findUnique({
        where: { id },
        select: { id: true, sindicatoId: true },
      });
      if (!actual) return null;
      await tx.conductor.update({ where: { id }, data: { credencialHash } });
      const desafios = await tx.desafioAuthMovil.updateMany({
        where: { conductorId: id, consumedAt: null },
        data: { consumedAt: ahora },
      });
      const sesiones = await tx.sesionOperativa.updateMany({
        where: { conductorId: id, estado: 'activa', revokedAt: null },
        data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
      });
      await registrarAuditoriaCredencial(tx, actor, entidad, id, actual.sindicatoId, {
        desafiosInvalidados: desafios.count,
        sesionesRevocadas: sesiones.count,
      });
      return actual;
    });
    if (!resultado) {
      throw new NotFoundException(
        entidad === 'vehiculo' ? 'Vehículo no encontrado' : 'Conductor no encontrado',
      );
    }
  }

  private async registrarIntentoFallido(desafioId: string): Promise<void> {
    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      const actual = await tx.desafioAuthMovil.findUnique({ where: { id: desafioId } });
      if (!actual || actual.consumedAt) return;
      const intentosConductor = actual.intentosConductor + 1;
      await tx.desafioAuthMovil.update({
        where: { id: desafioId },
        data: {
          intentosConductor,
          consumedAt: intentosConductor >= MAX_INTENTOS_CONDUCTOR ? new Date() : undefined,
        },
      });
    });
  }

  private buscarAsignaciones(
    desafio: { sindicatoId: string; vehiculoId: string },
    conductorId: string,
    ahora: Date,
  ): Promise<AsignacionOperativa[]> {
    return withTenantContext({ rol: 'conductor', sindicatoId: desafio.sindicatoId }, (tx) =>
      tx.asignacion.findMany({
        where: {
          vehiculoId: desafio.vehiculoId,
          conductorId,
          fecha: fechaActualBolivia(ahora),
          estado: 'vigente',
          venceAt: { gt: ahora },
          rotacion: { sindicatoId: desafio.sindicatoId, estado: 'publicada' },
        },
        include: includeAsignacion,
        orderBy: [{ orden: 'asc' }, { horario: 'asc' }],
      }),
    );
  }
}

async function registrarAuditoriaCredencial(
  tx: Tx,
  actor: AuthenticatedUser,
  entidad: 'vehiculo' | 'conductor',
  entidadId: string,
  sindicatoId: string,
  conteos: { desafiosInvalidados: number; sesionesRevocadas: number },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      sindicatoId,
      usuarioId: actor.userId,
      entidad,
      entidadId,
      accion: 'actualizar_credencial_movil',
      diff: conteos,
    },
  });
}

const includeAsignacion = {
  vehiculo: true,
  conductor: true,
  rotacion: { include: { sindicato: true } },
  ruta: { include: { linea: true } },
} as const;

const includeAsignacionSesion = { asignacion: { include: includeAsignacion } } as const;

function toResumenAsignacion(row: AsignacionOperativa): ResumenAsignacionMovil {
  return {
    id: row.id,
    fecha: fechaISO(row.fecha),
    horario: TurnoSchema.parse(row.horario),
    venceAt: row.venceAt.toISOString(),
    linea: { codigo: row.ruta.linea.codigo, nombre: row.ruta.linea.nombre },
    ruta: { sentido: row.ruta.sentido },
  };
}

function toContextoOperativo(sesionId: string, row: AsignacionOperativa): ContextoOperativoMovil {
  if (!row.conductor) {
    throw new NotFoundException('La asignación no tiene un conductor');
  }
  return {
    sesionId,
    asignacion: {
      id: row.id,
      fecha: fechaISO(row.fecha),
      horario: TurnoSchema.parse(row.horario),
      venceAt: row.venceAt.toISOString(),
    },
    vehiculo: {
      id: row.vehiculo.id,
      placa: row.vehiculo.placa,
      tipo: row.vehiculo.tipo,
      marca: row.vehiculo.marca,
      modelo: row.vehiculo.modelo,
    },
    conductor: {
      id: row.conductor.id,
      nombre: row.conductor.nombre,
      documentoIdentidad: row.conductor.documentoIdentidad,
    },
    sindicato: { id: row.rotacion.sindicato.id, nombre: row.rotacion.sindicato.nombre },
    linea: {
      id: row.ruta.linea.id,
      codigo: row.ruta.linea.codigo,
      nombre: row.ruta.linea.nombre,
      color: row.ruta.linea.color,
    },
    ruta: { id: row.ruta.id, sentido: row.ruta.sentido },
  };
}

function normalizarPlaca(placa: string): string {
  return placa
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function verificarCredencial(pin: string, hash: string | null): Promise<boolean> {
  const hashVerificable = hash ?? (await DUMMY_HASH_PROMISE);
  try {
    const valido = await verifyPassword({ password: pin, hash: hashVerificable });
    return hash ? valido : false;
  } catch {
    return false;
  }
}

function credencialesInvalidas(): UnauthorizedException {
  return new UnauthorizedException('Credenciales inválidas');
}

function ttlSegundos(nombre: string, valorPorDefecto: number): number {
  const valor = Number(process.env[nombre] ?? valorPorDefecto);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : valorPorDefecto;
}

function sumarSegundos(fecha: Date, segundos: number): Date {
  return new Date(fecha.getTime() + segundos * 1_000);
}

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
