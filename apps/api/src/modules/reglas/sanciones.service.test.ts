import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReglasService } from './reglas.service.js';
import { SancionesService } from './sanciones.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('SancionesService', () => {
  const reglasService = new ReglasService();
  const service = new SancionesService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let reglaAId: string;
  let vehiculoAId: string;

  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Sanciones Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Sanciones Test B', estado: 'activo' } });
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'SAN001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      vehiculoAId = vehiculo.id;
    });
    const regla = await reglasService.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      nombre: 'Desvío de ruta',
      tipo: 'operativo',
      gravedad: 'grave',
      aplicaA: 'vehiculo',
      estado: 'activo',
    });
    reglaAId = regla.id;
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sancion.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.regla.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  function crearBase() {
    return service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      reglaId: reglaAId,
      sujetoTipo: 'vehiculo',
      sujetoId: vehiculoAId,
      motivo: 'Se desvió 2km de la ruta asignada',
      fechaHecho: new Date('2026-08-01'),
    });
  }

  it('crea una sanción en estado pendiente', async () => {
    const sancion = await crearBase();
    expect(sancion.estado).toBe('pendiente');
    expect(sancion.sindicatoId).toBe(sindicatoAId);
  });

  it('rechaza una regla de otro sindicato', async () => {
    await expect(
      service.crear(adminSindicatoA, {
        sindicatoId: sindicatoBId,
        reglaId: randomUUID(),
        sujetoTipo: 'vehiculo',
        sujetoId: vehiculoAId,
        motivo: 'x',
        fechaHecho: new Date('2026-08-01'),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recorre el camino feliz: pendiente → aplicada → pagada', async () => {
    const sancion = await crearBase();
    const aplicada = await service.aplicar(adminSindicatoA, sancion.id);
    expect(aplicada.estado).toBe('aplicada');
    const pagada = await service.pagar(adminSindicatoA, sancion.id);
    expect(pagada.estado).toBe('pagada');
  });

  it('permite apelar una sanción aplicada y luego confirmarla o anularla', async () => {
    const sancion = await crearBase();
    await service.aplicar(adminSindicatoA, sancion.id);
    const apelada = await service.apelar(adminSindicatoA, sancion.id);
    expect(apelada.estado).toBe('apelada');
    const confirmada = await service.aplicar(adminSindicatoA, sancion.id);
    expect(confirmada.estado).toBe('aplicada');
  });

  it('rechaza transiciones inválidas (pendiente → pagada directo)', async () => {
    const sancion = await crearBase();
    await expect(service.pagar(adminSindicatoA, sancion.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pagada y anulada son terminales', async () => {
    const sancion = await crearBase();
    await service.aplicar(adminSindicatoA, sancion.id);
    await service.pagar(adminSindicatoA, sancion.id);
    await expect(service.anular(adminSindicatoA, sancion.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite editar motivo/evidencia mientras está pendiente, no después de aplicada', async () => {
    const sancion = await crearBase();
    const editada = await service.actualizar(adminSindicatoA, sancion.id, { evidenciaRef: 'sesion-123' });
    expect(editada.evidenciaRef).toBe('sesion-123');

    await service.aplicar(adminSindicatoA, sancion.id);
    await expect(
      service.actualizar(adminSindicatoA, sancion.id, { motivo: 'otro motivo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
