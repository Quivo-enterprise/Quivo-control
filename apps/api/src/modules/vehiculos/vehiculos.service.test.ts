import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VehiculosService } from './vehiculos.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('VehiculosService', () => {
  const service = new VehiculosService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const socioAId = randomUUID();
  const socioBId = randomUUID();
  const adminQuivo: AuthenticatedUser = {
    userId: 'test-admin-quivo',
    rol: 'admin_quivo',
    sindicatoId: null,
  };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  const vehiculoBase = {
    tipo: 'bus_urbano' as const,
    marca: 'JAC',
    modelo: 'X1',
    color: 'blanco' as const,
    colorSecundario: null,
    capacidad: 40,
    socioId: socioAId,
    estado: 'pendiente' as const,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'Vehiculos Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Vehiculos Test B', estado: 'activo' },
      });
      await tx.socio.create({
        data: {
          id: socioAId,
          sindicatoId: sindicatoAId,
          nombre: 'Socio A',
          documentoIdentidad: 'DOC-A',
        },
      });
      await tx.socio.create({
        data: {
          id: socioBId,
          sindicatoId: sindicatoBId,
          nombre: 'Socio B',
          documentoIdentidad: 'DOC-B',
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.socio.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('fuerza el tenant y no expone vehículos de otro sindicato', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoBId,
      placa: '111-AAA',
    });
    expect(vehiculo.sindicatoId).toBe(sindicatoAId);
    expect(vehiculo.placaNormalizada).toBe('111AAA');
    expect(vehiculo.estado).toBe('pendiente');

    const deB = await service.crear(adminQuivo, {
      ...vehiculoBase,
      socioId: socioBId,
      sindicatoId: sindicatoBId,
      placa: '112BBB',
    });
    await expect(service.obtener(adminSindicatoA, deB.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('permite pendiente → activo → mantenimiento con los datos exigidos', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoAId,
      placa: '113CCC',
    });
    const activo = await service.cambiarEstado(adminSindicatoA, vehiculo.id, { estado: 'activo' });
    const actualizado = await service.cambiarEstado(adminSindicatoA, activo.id, {
      estado: 'mantenimiento',
      motivo: 'Revisión preventiva',
    });
    expect(actualizado.estado).toBe('mantenimiento');
  });

  it('rechaza una transición inválida de mantenimiento a suspendido', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoAId,
      placa: '114DDD',
    });
    await service.cambiarEstado(adminSindicatoA, vehiculo.id, { estado: 'activo' });
    await service.cambiarEstado(adminSindicatoA, vehiculo.id, {
      estado: 'mantenimiento',
      motivo: 'Reparación',
    });
    await expect(
      service.cambiarEstado(adminSindicatoA, vehiculo.id, {
        estado: 'suspendido',
        motivo: 'Sanción',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloquea la activación si falta el socio propietario', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      socioId: null,
      sindicatoId: sindicatoAId,
      placa: '115EEE',
    });
    await expect(
      service.cambiarEstado(adminSindicatoA, vehiculo.id, { estado: 'activo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no permite dejar incompleto un vehículo que ya está activo', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoAId,
      placa: '115EEA',
    });
    await service.cambiarEstado(adminSindicatoA, vehiculo.id, { estado: 'activo' });
    await expect(
      service.actualizar(adminSindicatoA, vehiculo.id, { socioId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aplica unicidad global sobre la placa normalizada', async () => {
    await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoAId,
      placa: '116-FFF',
    });
    await expect(
      service.crear(adminQuivo, {
        ...vehiculoBase,
        socioId: socioBId,
        sindicatoId: sindicatoBId,
        placa: '116 fff',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registra cada cambio en el historial funcional', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoAId,
      placa: '117GGG',
    });
    await service.cambiarEstado(adminSindicatoA, vehiculo.id, { estado: 'activo' });
    const historial = await service.historialEstados(adminSindicatoA, vehiculo.id);
    expect(historial.map((item) => item.estadoHasta)).toEqual(['activo', 'pendiente']);
    expect(historial[0]?.actorId).toBe(adminSindicatoA.userId);
  });

  it('rechaza una placa anterior al reemplaque al verificar disponibilidad', async () => {
    await expect(service.verificarPlaca(adminSindicatoA, 'ABC123')).rejects.toThrow(
      'formato anterior',
    );
  });

  describe('listar() ante filas corruptas (QUI-366)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('omite una fila que no pasa el schema, devuelve las válidas y no lanza', async () => {
      const vehiculoValido = await service.crear(adminSindicatoA, {
        ...vehiculoBase,
        sindicatoId: sindicatoAId,
        placa: '118HHH',
      });

      // Reproduce el incidente real: una fila con placa/color placeholder que
      // `VehiculoSchema.parse()` rechaza, insertada directo (bypass de la validación de
      // `crear()`) tal como puede terminar en la base por un seed o una migración a medias.
      const vehiculoCorruptoId = randomUUID();
      const sufijo = vehiculoCorruptoId.slice(0, 8).toUpperCase();
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.vehiculo.create({
          data: {
            id: vehiculoCorruptoId,
            sindicatoId: sindicatoAId,
            placa: `INV${sufijo}`,
            placaNormalizada: `INV${sufijo}`,
            tipo: 'bus_urbano',
            marca: 'PLACEHOLDER',
            modelo: 'PLACEHOLDER',
            color: 'PLACEHOLDER',
            capacidad: 40,
            estado: 'pendiente',
          },
        }),
      );

      try {
        const listado = await service.listar(adminSindicatoA);

        expect(listado.some((v) => v.id === vehiculoValido.id)).toBe(true);
        expect(listado.some((v) => v.id === vehiculoCorruptoId)).toBe(false);
      } finally {
        await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
          tx.vehiculo.delete({ where: { id: vehiculoCorruptoId } }),
        );
      }
    });

    it('deja rastro en el log de la fila corrupta (id + campos que fallaron)', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const vehiculoCorruptoId = randomUUID();
      const sufijo = vehiculoCorruptoId.slice(0, 8).toUpperCase();
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.vehiculo.create({
          data: {
            id: vehiculoCorruptoId,
            sindicatoId: sindicatoAId,
            placa: `INV${sufijo}`,
            placaNormalizada: `INV${sufijo}`,
            tipo: 'bus_urbano',
            marca: 'PLACEHOLDER',
            modelo: 'PLACEHOLDER',
            color: 'PLACEHOLDER',
            capacidad: 40,
            estado: 'pendiente',
          },
        }),
      );

      try {
        await service.listar(adminSindicatoA);

        const logueoDeLaFilaCorrupta = errorSpy.mock.calls.find(
          (llamada) => typeof llamada[0] === 'string' && llamada[0].includes(vehiculoCorruptoId),
        );
        expect(logueoDeLaFilaCorrupta).toBeDefined();
        expect(logueoDeLaFilaCorrupta?.[0]).toContain('color');
      } finally {
        await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
          tx.vehiculo.delete({ where: { id: vehiculoCorruptoId } }),
        );
      }
    });

    it('con todas las filas válidas se comporta igual que antes (sin regresión)', async () => {
      const vehiculo1 = await service.crear(adminSindicatoA, {
        ...vehiculoBase,
        sindicatoId: sindicatoAId,
        placa: '119III',
      });
      const vehiculo2 = await service.crear(adminSindicatoA, {
        ...vehiculoBase,
        sindicatoId: sindicatoAId,
        placa: '120JJJ',
      });

      const listado = await service.listar(adminSindicatoA);
      const ids = listado.map((v) => v.id);

      expect(ids).toContain(vehiculo1.id);
      expect(ids).toContain(vehiculo2.id);
    });
  });
});
