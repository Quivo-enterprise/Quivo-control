import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerModule } from '@nestjs/throttler';
import { auth, prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ZodExceptionFilter } from '../../common/validation/zod-exception.filter.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ADMIN, borrarMundo, crearMundo, type MundoSalidas } from '../salidas/salidas.fixtures.js';
import { VueltasService } from '../vueltas/vueltas.service.js';
import { EnVivoController } from './en-vivo.controller.js';
import { EnVivoService } from './en-vivo.service.js';
import { EnVivoUsuarioThrottlerGuard } from './en-vivo-usuario-throttler.guard.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }])],
  controllers: [EnVivoController],
  providers: [
    EnVivoService,
    VueltasService,
    EnVivoUsuarioThrottlerGuard,
    RolesGuard,
    JwtAuthGuard,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
class EnVivoTestModule {}

/** `GET /reportes/en-vivo/infracciones?fecha=hoy`: scope por sindicato (RLS + filtro explícito) y jornada de hoy. */
describe('GET /reportes/en-vivo/infracciones (alertas de hoy)', () => {
  let app: NestFastifyApplication;
  // Dos mundos: el sindicato A de cada uno es un sindicato distinto con su propia sesión de hoy.
  let m1: MundoSalidas;
  let m2: MundoSalidas;
  const infra = { hoyA: randomUUID(), hoyB: randomUUID(), ayerA: randomUUID(), descartadaA: randomUUID() };

  const get = (url: string, rol: string, sindicatoId: string | null) =>
    app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${JSON.stringify({ sub: 'usuario-test', rol, sindicatoId })}` },
    });

  beforeAll(async () => {
    vi.spyOn(auth.api, 'verifyJWT').mockImplementation((async ({ body }: { body: { token: string } }) => ({
      payload: JSON.parse(body.token),
    })) as never);
    m1 = await crearMundo(2);
    m2 = await crearMundo(1);
    const ayer = new Date(Date.now() - 3 * 24 * 3_600_000);
    await withTenantContext(ADMIN, async (tx) => {
      // La segunda sesión de A arrancó hace 3 días y no tiene actividad GPS: fuera de la jornada de hoy.
      await tx.sesionOperativa.update({ where: { id: m1.a[1]!.sesion.sesionId }, data: { inicio: ayer } });
      const lineaDe = async (m: MundoSalidas) =>
        (await tx.$queryRaw<{ lineaId: string }[]>`SELECT "lineaId" FROM rutas WHERE id = ${m.rutaA}`)[0]!.lineaId;
      const crear = async (id: string, m: MundoSalidas, i: number, estado: string) => {
        const s = m.a[i]!.sesion;
        await tx.infraccion.create({
          data: {
            id, sindicatoId: m.sindicatoA, sesionId: s.sesionId, vehiculoId: s.vehiculoId, conductorId: s.conductorId,
            lineaId: await lineaDe(m), rutaId: m.rutaA, tipo: 'desvio_ruta', gravedad: 'grave', estado,
            inicioTs: new Date(), lat: -17.78, lng: -63.18, detalle: {}, dedupeKey: `t-${id}`,
          },
        });
      };
      await crear(infra.hoyA, m1, 0, 'abierta');
      await crear(infra.descartadaA, m1, 0, 'descartada');
      await crear(infra.ayerA, m1, 1, 'abierta');
      await crear(infra.hoyB, m2, 0, 'atendida');
    });
    app = await NestFactory.create(EnVivoTestModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await withTenantContext(ADMIN, (tx) =>
      tx.infraccion.deleteMany({ where: { sindicatoId: { in: [m1.sindicatoA, m2.sindicatoA] } } }),
    );
    await borrarMundo(m1);
    await borrarMundo(m2);
    await prisma.$disconnect();
  });

  const ids = (res: { json: () => { id: string }[] }) => res.json().map((r) => r.id);
  const URL = '/reportes/en-vivo/infracciones?fecha=hoy';

  it('la ruta resuelve (no se lee `infracciones` como sesionId) y trae placa, conductor y línea', async () => {
    const res = await get(URL, 'admin_sindicato', m1.sindicatoA);
    expect(res.statusCode).toBe(200);
    const [fila] = res.json();
    expect(fila).toMatchObject({ id: infra.hoyA, sesionId: m1.a[0]!.sesion.sesionId, vehiculoPlaca: m1.a[0]!.placa });
    expect(fila.conductorNombre).toBeTruthy();
    expect(fila.lineaNombre).toBeTruthy();
  });

  it('admin_sindicato A solo ve lo de A; sin la de ayer ni la descartada', async () => {
    expect(ids(await get(URL, 'admin_sindicato', m1.sindicatoA))).toEqual([infra.hoyA]);
  });

  it('admin_sindicato B solo ve lo de B', async () => {
    expect(ids(await get(URL, 'admin_sindicato', m2.sindicatoA))).toEqual([infra.hoyB]);
  });

  it('admin_quivo ve ambos sindicatos (abierta primero)', async () => {
    expect(ids(await get(URL, 'admin_quivo', null))).toEqual(expect.arrayContaining([infra.hoyA, infra.hoyB]));
    const todas = ids(await get(URL, 'admin_quivo', null));
    expect(todas).not.toContain(infra.ayerA);
    expect(todas.indexOf(infra.hoyA)).toBeLessThan(todas.indexOf(infra.hoyB));
  });

  it('un admin_sindicato sin sindicato en el token no ve nada (falla cerrado)', async () => {
    expect(ids(await get(URL, 'admin_sindicato', null))).toEqual([]);
  });

  it('fecha distinta de hoy es 400', async () => {
    expect((await get('/reportes/en-vivo/infracciones?fecha=ayer', 'admin_sindicato', m1.sindicatoA)).statusCode).toBe(400);
  });

  it('un rol sin acceso al mapa recibe 403', async () => {
    expect((await get(URL, 'conductor', m1.sindicatoA)).statusCode).toBe(403);
  });
});
