import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fechaActualBolivia, finDeJornadaBolivia } from '../../common/tiempo/jornada.js';
import { AuthMovilService } from './auth-movil.service.js';

const GEOMETRIA = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-68.15, -16.5],
    [-68.14, -16.49],
  ],
});

describe('AuthMovilService', () => {
  const service = new AuthMovilService();
  const sindicatoId = randomUUID();
  const rutaId = randomUUID();
  const placa = `MOB${sindicatoId.slice(0, 5)}`;
  const documento = `CI-${sindicatoId.slice(0, 8)}`;
  const pinVehiculo = '246810';
  const pinConductor = '135790';
  const deviceId = `android:test-${sindicatoId.slice(0, 8)}`;

  beforeAll(async () => {
    const [vehiculoHash, conductorHash] = await Promise.all([
      hashPassword(pinVehiculo),
      hashPassword(pinConductor),
    ]);
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Sindicato Auth Móvil' } });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'M1', nombre: 'Línea móvil', color: '#3226B4' },
      });
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA}), 4326)::geography, 'activo', now(), now())
      `;
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa,
          tipo: 'minibus',
          marca: 'Toyota',
          modelo: 'Coaster',
          color: 'blanco',
          capacidad: 30,
          estado: 'activo',
          credencialHash: vehiculoHash,
        },
      });
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId,
          nombre: 'Chofer móvil',
          documentoIdentidad: documento,
          licenciaConducir: `LIC-${documento}`,
          credencialHash: conductorHash,
        },
      });
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: 'auth-movil-test', estado: 'publicada' },
      });
      const fecha = fechaActualBolivia();
      await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha,
          horario: 'manana',
          orden: 1,
          venceAt: finDeJornadaBolivia(fecha),
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.auditLog.deleteMany({ where: { sindicatoId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.desafioAuthMovil.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rotacion: { sindicatoId } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('rechaza el PIN incorrecto del vehículo con un error genérico', async () => {
    await expect(
      service.autenticarVehiculo({ placa, pin: '999999', deviceId }),
    ).rejects.toMatchObject({
      constructor: UnauthorizedException,
      message: 'Credenciales inválidas',
    });
  });

  it('impide usar el desafío desde otro dispositivo', async () => {
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    await expect(
      service.autenticarConductor({
        challengeToken: vehiculo.challengeToken,
        deviceId: 'android:otro-dispositivo',
        documentoIdentidad: documento,
        pin: pinConductor,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('autentica ambos pasos, resuelve línea y rota/revoca tokens', async () => {
    const vehiculo = await service.autenticarVehiculo({
      placa: placa.toLowerCase(),
      pin: pinVehiculo,
      deviceId,
    });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento.toLowerCase(),
      pin: pinConductor,
    });

    expect(login.status).toBe('autenticado');
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');
    expect(login.contexto).toMatchObject({
      vehiculo: { placa },
      conductor: { documentoIdentidad: documento },
      sindicato: { id: sindicatoId },
      linea: { codigo: 'M1', nombre: 'Línea móvil' },
      ruta: { id: rutaId, sentido: 'ida' },
    });

    const sesion = await service.validarAccessToken(login.accessToken);
    await expect(service.obtenerContexto(sesion)).resolves.toEqual(login.contexto);

    const rotado = await service.refresh({ refreshToken: login.refreshToken });
    expect(rotado.refreshToken).not.toBe(login.refreshToken);
    await expect(service.validarAccessToken(login.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refresh({ refreshToken: login.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    await service.logout({ refreshToken: rotado.refreshToken });
    await expect(service.validarAccessToken(rotado.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('al rotar el PIN revoca sesiones y audita sin exponer la credencial', async () => {
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    const conductor = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.conductor.findFirstOrThrow({ where: { sindicatoId }, select: { id: true } }),
    );
    await service.establecerPinConductor(
      { userId: 'admin-auth-movil-test', rol: 'admin_quivo', sindicatoId: null },
      conductor.id,
      { pin: pinConductor },
    );

    await expect(service.validarAccessToken(login.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const auditoria = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: {
          sindicatoId,
          entidad: 'conductor',
          entidadId: conductor.id,
          accion: 'actualizar_credencial_movil',
        },
      }),
    );
    expect(auditoria.diff).toEqual({ desafiosInvalidados: 0, sesionesRevocadas: 1 });
    expect(JSON.stringify(auditoria)).not.toContain(pinConductor);
  });
});
