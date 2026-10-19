import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerModule } from '@nestjs/throttler';
import { auth, prisma } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AUDIT_ACCION_KEY, AUDIT_ENTIDAD_KEY } from '../../common/audit/audit.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { ROLES_KEY } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ZodExceptionFilter } from '../../common/validation/zod-exception.filter.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { EnVivoController } from '../reportes/en-vivo.controller.js';
import { EnVivoService } from '../reportes/en-vivo.service.js';
import { EnVivoUsuarioThrottlerGuard } from '../reportes/en-vivo-usuario-throttler.guard.js';
import { VueltasMovilController } from './vueltas-movil.controller.js';
import { VueltasService } from './vueltas.service.js';

/**
 * Capa HTTP propia del mapa en vivo con el rol `operador` (control) y de la designación: guards
 * reales (`JwtAuthGuard` con `verifyJWT` espiado, `RolesGuard`), DTO Zod, DI y metadata
 * `@Auditable`. La lógica de la designación se cubre en `vueltas.integration.test.ts`.
 */
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

describe('/reportes/en-vivo para el operador y la designación (guards + DTO Zod + DI)', () => {
  let app: NestFastifyApplication;
  const sindicato = randomUUID();
  const tokenDe = (rol: string) => ({
    authorization: `Bearer ${JSON.stringify({ sub: 'usuario-test', rol, sindicatoId: sindicato })}`,
  });

  beforeAll(async () => {
    vi.spyOn(auth.api, 'verifyJWT').mockImplementation((async ({ body }: { body: { token: string } }) => ({
      payload: JSON.parse(body.token),
    })) as never);
    app = await NestFactory.create(EnVivoTestModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  const get = (url: string, rol: string) => app.inject({ method: 'GET', url, headers: tokenDe(rol) });
  const put = (sesionId: string, payload: unknown, rol: string) =>
    app.inject({
      method: 'PUT',
      url: `/reportes/en-vivo/${sesionId}/vuelta-actual/designacion`,
      headers: tokenDe(rol),
      payload: payload as object,
    });

  it('el operador lee el mapa en vivo: lista, posiciones, resumen Molinos, contexto, traza e infracciones (nunca 403)', async () => {
    const sesion = randomUUID();
    expect((await get('/reportes/en-vivo', 'operador')).statusCode).toBe(200);
    expect((await get('/reportes/en-vivo/posiciones', 'operador')).statusCode).toBe(200);
    expect((await get('/reportes/en-vivo/molinos', 'operador')).statusCode).toBe(200);
    // Una sesión inexistente llega al service (404), no al guard (403).
    expect((await get(`/reportes/en-vivo/${sesion}/contexto`, 'operador')).statusCode).toBe(404);
    expect((await get(`/reportes/en-vivo/${sesion}/posiciones`, 'operador')).statusCode).toBe(404);
    expect((await get(`/reportes/en-vivo/${sesion}/infracciones`, 'operador')).statusCode).toBe(404);
  });

  it('roles sin acceso al mapa (conductor, socio, pasajero, supervisor) reciben 403', async () => {
    for (const rol of ['conductor', 'socio', 'pasajero', 'supervisor']) {
      expect((await get('/reportes/en-vivo/posiciones', rol)).statusCode).toBe(403);
      expect((await put(randomUUID(), { varianteId: null }, rol)).statusCode).toBe(403);
    }
  });

  it('el PUT de designación valida el body (400) y admite a admin_sindicato y operador (404 si la sesión no existe)', async () => {
    const sesion = randomUUID();
    expect((await put(sesion, { varianteId: 'molinos' }, 'operador')).statusCode).toBe(400);
    expect((await put(sesion, {}, 'operador')).statusCode).toBe(400);
    expect((await put(sesion, { varianteId: randomUUID() }, 'operador')).statusCode).toBe(404);
    expect((await put(sesion, { varianteId: null }, 'admin_sindicato')).statusCode).toBe(404);
  });

  it('la designación es @Auditable (entidad vuelta, acción designar) y el controller declara los roles del control', () => {
    const proto = EnVivoController.prototype;
    expect(Reflect.getMetadata(AUDIT_ENTIDAD_KEY, proto.designar)).toBe('vuelta');
    expect(Reflect.getMetadata(AUDIT_ACCION_KEY, proto.designar)).toBe('designar');
    expect([...Reflect.getMetadata(ROLES_KEY, EnVivoController)].sort()).toEqual(
      ['admin_quivo', 'admin_sindicato', 'operador'].sort(),
    );
  });

  it('los endpoints móviles usan AuthMovilGuard y la sesión del token (sin sesionId en la URL ni en el body)', () => {
    const guards = (fn: unknown) => (Reflect.getMetadata('__guards__', fn as object) as { name: string }[]).map((g) => g.name);
    expect(guards(VueltasMovilController.prototype.obtener)).toEqual(['AuthMovilGuard', 'DispositivoThrottlerGuard']);
    expect(guards(VueltasMovilController.prototype.acusar)).toEqual(['AuthMovilGuard', 'DispositivoThrottlerGuard']);
  });
});
