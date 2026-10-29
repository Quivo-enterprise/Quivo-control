import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { auth, prisma } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AUDIT_ACCION_KEY, AUDIT_ENTIDAD_KEY } from '../../common/audit/audit.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ZodExceptionFilter } from '../../common/validation/zod-exception.filter.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { SancionesService } from '../reglas/sanciones.service.js';
import { InfraccionesController } from './infracciones.controller.js';
import { InfraccionesService } from './infracciones.service.js';

/**
 * `JwtAuthGuard` real, pero con `auth.api.verifyJWT` espiado: el "token" es el payload JSON del
 * JWT. Lo que se prueba acá es la capa HTTP propia del endpoint — guards, DTO Zod, DI del
 * módulo, metadata `@Auditable` — no la verificación criptográfica de Better-Auth (que cubren
 * `jwt-auth.guard.integration.test.ts` y compañía).
 */
@Module({
  controllers: [InfraccionesController],
  providers: [
    InfraccionesService,
    SancionesService,
    RolesGuard,
    JwtAuthGuard,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
class InfraccionesTestModule {}

describe('PATCH/POST /infracciones (guards + DTO Zod + DI)', () => {
  let app: NestFastifyApplication;
  const sindicato = randomUUID();
  const tokenDe = (rol: string) => ({
    authorization: `Bearer ${JSON.stringify({ sub: 'usuario-test', rol, sindicatoId: sindicato })}`,
  });
  const headers = tokenDe('admin_sindicato');
  const cumplimiento = { fechaCumplimiento: '2026-11-05', vueltas: 3, turno: 'noche', paradaSalida: 'molinos' };

  beforeAll(async () => {
    vi.spyOn(auth.api, 'verifyJWT').mockImplementation((async ({ body }: { body: { token: string } }) => ({
      payload: JSON.parse(body.token),
    })) as never);
    app = await NestFactory.create(InfraccionesTestModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  const patch = (id: string, payload: unknown, h: Record<string, string> = headers) =>
    app.inject({ method: 'PATCH', url: `/infracciones/${id}`, headers: h, payload: payload as object });
  const sancionar = (id: string, payload: unknown, h: Record<string, string> = headers) =>
    app.inject({ method: 'POST', url: `/infracciones/${id}/sancionar`, headers: h, payload: payload as object });

  it('rechaza una acción desconocida (400)', async () => {
    expect((await patch(randomUUID(), { accion: 'borrar' })).statusCode).toBe(400);
  });

  it('rechaza una nota de más de 500 caracteres (400)', async () => {
    expect((await patch(randomUUID(), { accion: 'atender', nota: 'x'.repeat(501) })).statusCode).toBe(400);
  });

  it('una infracción inexistente (o de otro tenant) es 404', async () => {
    expect((await patch(randomUUID(), { accion: 'atender', nota: 'ok' })).statusCode).toBe(404);
  });

  it('un rol sin permiso recibe 403', async () => {
    const res = await patch(randomUUID(), { accion: 'atender' }, tokenDe('conductor'));
    expect(res.statusCode).toBe(403);
  });

  it('el operador (control) NO atiende, descarta ni sanciona: 403 en ambas escrituras', async () => {
    const operador = tokenDe('operador');
    expect((await patch(randomUUID(), { accion: 'atender' }, operador)).statusCode).toBe(403);
    expect((await patch(randomUUID(), { accion: 'descartar', nota: 'x' }, operador)).statusCode).toBe(403);
    const res = await sancionar(randomUUID(), cumplimiento, operador);
    expect(res.statusCode).toBe(403);
  });

  it('sancionar solo acepta el agendado: cualquier campo del hecho (motivo, fechaHecho, regla, sujeto) o un valor fuera de rango es 400', async () => {
    const hecho = { motivo: 'm', fechaHecho: '2026-10-12', reglaId: randomUUID(), sujetoTipo: 'conductor', sujetoId: 'x', sindicatoId: randomUUID() };
    for (const [k, v] of Object.entries(hecho)) {
      expect((await sancionar(randomUUID(), { ...cumplimiento, [k]: v })).statusCode).toBe(400);
    }
    expect((await sancionar(randomUUID(), { ...cumplimiento, vueltas: 11 })).statusCode).toBe(400);
    expect((await sancionar(randomUUID(), { ...cumplimiento, turno: 'madrugada' })).statusCode).toBe(400);
    expect((await sancionar(randomUUID(), { ...cumplimiento, paradaSalida: 'otra' })).statusCode).toBe(400);
    expect((await sancionar(randomUUID(), { fechaCumplimiento: '2026-11-05' })).statusCode).toBe(400);
    // El body viejo (el cliente fijaba el hecho) ya no pasa.
    expect((await sancionar(randomUUID(), hecho)).statusCode).toBe(400);
    // Con el body nuevo llega al service: la infracción no existe → 404.
    expect((await sancionar(randomUUID(), cumplimiento)).statusCode).toBe(404);
  });

  it('ambas escrituras son @Auditable (entidad infraccion)', () => {
    const proto = InfraccionesController.prototype;
    expect(Reflect.getMetadata(AUDIT_ENTIDAD_KEY, proto.actualizar)).toBe('infraccion');
    expect(Reflect.getMetadata(AUDIT_ENTIDAD_KEY, proto.sancionar)).toBe('infraccion');
    expect(Reflect.getMetadata(AUDIT_ACCION_KEY, proto.sancionar)).toBe('sancionar');
  });
});
