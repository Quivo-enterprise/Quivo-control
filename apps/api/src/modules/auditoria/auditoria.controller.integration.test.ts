import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ZodExceptionFilter } from '../../common/validation/zod-exception.filter.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AuditoriaController } from './auditoria.controller.js';
import { AuditoriaService } from './auditoria.service.js';

/**
 * Módulo mínimo real (guards + pipe/filter globales + controller/service reales) — mismo
 * criterio que `sync-errores.controller.integration.test.ts` (`SyncErroresQuerySchema` dice
 * explícitamente "mismo criterio que `AuditoriaQuerySchema`", así que este endpoint es el
 * otro afectado por el mismo mecanismo bajo prueba).
 */
@Module({
  controllers: [AuditoriaController],
  providers: [
    AuditoriaService,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
class AuditoriaTestModule {}

/**
 * Mismo gap de entorno que documenta `sync-errores.controller.integration.test.ts`: sin
 * `emitDecoratorMetadata` (vitest/tsx corren esbuild puro) Nest no resuelve el DTO de
 * `@Query()` y `ZodValidationPipe` deja pasar el string crudo — acá se manifestaría igual,
 * `inicioDeJornadaBolivia` recibiendo un string en vez de un `Date`. Ver el archivo hermano
 * para el detalle completo y docs/plan-correccion-post-piloto-2026-09-09.md.
 */
const paramTypesDeListar = Reflect.getMetadata(
  'design:paramtypes',
  AuditoriaController.prototype,
  'listar',
) as unknown[] | undefined;
const metadataDeDecoradoresDisponible = Array.isArray(paramTypesDeListar) && paramTypesDeListar.length > 0;

describe('GET /auditoria — entorno de test', () => {
  it('registra si este runner emite design:paramtypes (si no, los tests HTTP de abajo se saltean)', () => {
    if (!metadataDeDecoradoresDisponible) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auditoria.controller.integration.test] este runner NO emite design:paramtypes ' +
          '(esbuild sin emitDecoratorMetadata) — se saltean los tests HTTP de este archivo. ' +
          'Ver docs/plan-correccion-post-piloto-2026-09-09.md.',
      );
    }
    expect(typeof metadataDeDecoradoresDisponible).toBe('boolean');
  });
});

/**
 * Prueba end-to-end (HTTP -> Fastify -> guards -> pipe -> DTO -> controller -> service ->
 * Postgres) de que `desde`/`hasta` coercidos por Zod realmente filtran filas reales de
 * `audit_log`, no solo "no explota" — mismo criterio que el test hermano de sync-errores.
 */
describe.skipIf(!metadataDeDecoradoresDisponible)(
  'GET /auditoria (integración real: guards + DTO Zod + pipe global + Postgres/RLS)',
  () => {
    let app: NestFastifyApplication;
    let accessToken: string;

    const usuarioId = `test-usuario-${randomUUID()}`;
    const filaAntesDelCorte = randomUUID();
    const filaDespuesDelCorte = randomUUID();

    beforeAll(async () => {
      app = await NestFactory.create(AuditoriaTestModule, new FastifyAdapter(), { logger: false });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const authService = new AuthService();
      const login = await authService.login({ email: 'admin@quivo.local', password: 'Quivo123!' });
      accessToken = login.accessToken;

      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.auditLog.create({
          data: {
            id: filaAntesDelCorte,
            sindicatoId: null,
            usuarioId,
            entidad: 'test',
            entidadId: 'test',
            accion: 'test',
            diff: {},
            ts: new Date('2026-09-01T00:00:00.000Z'),
          },
        });
        await tx.auditLog.create({
          data: {
            id: filaDespuesDelCorte,
            sindicatoId: null,
            usuarioId,
            entidad: 'test',
            entidadId: 'test',
            accion: 'test',
            diff: {},
            ts: new Date('2026-09-03T18:00:00.000Z'),
          },
        });
      });
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.auditLog.deleteMany({ where: { usuarioId } }),
      );
      await app.close();
      await prisma.$disconnect();
    });

    it('responde 200 (no 500) y aplica el filtro `desde` coercido contra filas reales', async () => {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'GET',
          url: `/auditoria?usuarioId=${usuarioId}&desde=2026-09-03T15:20:44.583Z`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as Array<{ id: string; ts: string }>;
      expect(body.map((fila) => fila.id)).toEqual([filaDespuesDelCorte]);
    });

    it('respeta también el límite superior `hasta` (rango [desde, hasta) exclusivo)', async () => {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'GET',
          url:
            `/auditoria?usuarioId=${usuarioId}` +
            `&desde=2026-08-01T00:00:00.000Z&hasta=2026-09-02T00:00:00.000Z`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as Array<{ id: string; ts: string }>;
      expect(body.map((fila) => fila.id)).toEqual([filaAntesDelCorte]);
    });
  },
);
