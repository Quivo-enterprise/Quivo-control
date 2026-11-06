import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { FilaService } from '../salidas/fila.service.js';
import { borrarMundo, crearMundo, type MundoSalidas } from '../salidas/salidas.fixtures.js';
import { AuthService } from './auth.service.js';

/** Delegado de punta a punta contra Postgres + Better-Auth reales: alta, login, JWT y alcance por sindicato. */
describe('rol delegado (integración)', () => {
  let m: MundoSalidas;
  const emails: string[] = [];
  const admin: AuthenticatedUser = { userId: randomUUID(), rol: 'admin_quivo', sindicatoId: null };
  const password = 'clave-delegado-123';
  const auth = new AuthService();
  const fila = new FilaService();
  const delegado = (sindicatoId: string): AuthenticatedUser => ({ userId: randomUUID(), rol: 'delegado', sindicatoId });

  beforeAll(async () => {
    m = await crearMundo(0);
  });
  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const userId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  it('el delegado creado por el admin puede iniciar sesión y su JWT lleva rol y sindicato', async () => {
    const email = `delegado.${randomUUID()}@Ejemplo.test`;
    emails.push(email.toLowerCase());
    const creado = await auth.crearUsuarioComoAdmin(admin, {
      email, name: 'Delegado Test', password, rol: 'delegado', sindicatoId: m.sindicatoB,
    });
    expect(creado).toMatchObject({ rol: 'delegado', sindicatoId: m.sindicatoB, email: email.toLowerCase() });

    const { accessToken, user } = await auth.login({ email: email.toLowerCase(), password });
    expect(user).toMatchObject({ rol: 'delegado', sindicatoId: m.sindicatoB });
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString());
    expect(claims).toMatchObject({ rol: 'delegado', sindicatoId: m.sindicatoB });

    // El reset por email con mayúsculas encuentra al mismo usuario (el alta lo guarda en minúsculas).
    await auth.resetPasswordComoAdmin(admin, { email, newPassword: 'otra-clave-456' });
    await expect(auth.login({ email: email.toLowerCase(), password: 'otra-clave-456' })).resolves.toBeDefined();
  });

  it('un delegado del sindicato B no ve la fila del A', async () => {
    const intento = fila.estadoPanel(delegado(m.sindicatoB), m.pcTerminalA);
    await expect(intento).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un delegado ve la terminal de su propio sindicato', async () => {
    const panel = await fila.estadoPanel(delegado(m.sindicatoB), m.pcTerminalB);
    expect(panel.items).toEqual([]);
  });
});
