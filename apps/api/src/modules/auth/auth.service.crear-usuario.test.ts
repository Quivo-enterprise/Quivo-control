import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, auditCreate, sindicatoFind } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    account: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  auditCreate: vi.fn(),
  sindicatoFind: vi.fn(),
}));

// Sin Better-Auth ni DB: acá solo importa la lógica de alta (duplicados, sindicato, hash, auditoría).
vi.mock('@quivo/db', () => ({
  auth: {},
  prisma: prismaMock,
  resolveJwtSecret: () => 'secreto-de-prueba-solo-para-test',
  withTenantContext: (_ctx: unknown, cb: (tx: unknown) => unknown) =>
    cb({ sindicato: { findUnique: sindicatoFind }, auditLog: { create: auditCreate } }),
}));
vi.mock('better-auth/crypto', () => ({ hashPassword: vi.fn(async (p: string) => `hash(${p.length})`) }));

import { AuthService } from './auth.service.js';

const actor = { userId: 'admin-1', rol: 'admin_quivo', sindicatoId: null };
const SINDICATO = '11111111-1111-4111-8111-111111111111';
const datos = {
  email: 'Delegado.Prueba@Ejemplo.TEST',
  name: 'Delegado de Prueba',
  password: 'clave-de-prueba-123',
  rol: 'delegado' as const,
  sindicatoId: SINDICATO,
};

describe('AuthService.crearUsuarioComoAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sindicatoFind.mockResolvedValue({ id: SINDICATO });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  });

  it('crea el usuario delegado con el email en minúsculas y la contraseña hasheada, y audita sin contraseña', async () => {
    const usuario = await new AuthService().crearUsuarioComoAdmin(actor, datos);

    expect(usuario).toMatchObject({ email: 'delegado.prueba@ejemplo.test', rol: 'delegado', sindicatoId: SINDICATO });
    const cuenta = prismaMock.account.create.mock.calls[0]?.[0].data;
    expect(cuenta).toMatchObject({ providerId: 'credential', password: `hash(${datos.password.length})` });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(datos.password);
    expect(auditCreate.mock.calls[0]?.[0].data).toMatchObject({ entidad: 'usuario', accion: 'crear', sindicatoId: SINDICATO });
  });

  it('409 si el email ya existe, sin crear nada', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'otro' });
    await expect(new AuthService().crearUsuarioComoAdmin(actor, datos)).rejects.toBeInstanceOf(ConflictException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('409 si pierde la carrera contra otro alta (unique de email)', async () => {
    prismaMock.$transaction.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(new AuthService().crearUsuarioComoAdmin(actor, datos)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 si el sindicato no existe', async () => {
    sindicatoFind.mockResolvedValue(null);
    await expect(new AuthService().crearUsuarioComoAdmin(actor, datos)).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
