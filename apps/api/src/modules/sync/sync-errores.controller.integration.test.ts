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
import { SyncErroresController } from './sync-errores.controller.js';
import { SyncErroresService } from './sync-errores.service.js';

/**
 * Módulo mínimo (sin `AppModule` completo: sin Redis/BullMQ/Sentry/Throttler, que
 * `SyncModule`/`AppModule` sí necesitan) que reproduce EXACTAMENTE la cadena real de
 * `GET /v1/sync-errores`: mismos guards (`JwtAuthGuard`+`RolesGuard`), mismo pipe/filter
 * globales que registra `app.module.ts` (`APP_PIPE`/`APP_FILTER`), mismo controller y
 * service reales — solo se recorta lo que no hace falta para ejercitar el mecanismo bajo
 * prueba (DTO Zod -> pipe global -> handler -> Postgres real con RLS).
 */
@Module({
  controllers: [SyncErroresController],
  providers: [
    SyncErroresService,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
class SyncErroresTestModule {}

/**
 * GAP CONOCIDO DEL ENTORNO DE TEST (docs/plan-correccion-post-piloto-2026-09-09.md,
 * investigación 2026-09-10): Nest resuelve qué schema Zod validar/coerciona en `@Query()`
 * leyendo `design:paramtypes` (metadata que emite `tsc` con `emitDecoratorMetadata`, ver
 * apps/api/tsconfig.json). `vitest` (y `tsx`, que usa el mismo motor) transforma TypeScript
 * con esbuild puro, que NO emite esa metadata (evanw/esbuild#257, ya documentado en este
 * repo vía el `@Inject(Reflector)` explícito de `roles.guard.ts`/`sync-device-throttler.guard.ts`).
 * Verificado a mano: `Reflect.getMetadata('design:paramtypes', SyncErroresController.prototype,
 * 'listar')` da `undefined` bajo vitest. Sin esa metadata, `ZodValidationPipe` nunca encuentra
 * `metatype.schema` y deja pasar el string crudo de la querystring — el `inicioDeJornadaBolivia`
 * de `sync-errores.service.ts` revienta con `fecha.getUTCFullYear is not a function`. Confirmado
 * que es el entorno y no el código: el mismo request contra `node dist/main.js` (build real con
 * `tsc`, igual al Dockerfile de prod) responde 200 y filtra bien.
 *
 * Por eso los tests de HTTP de abajo se activan solo si el runner que los ejecuta SÍ trae la
 * metadata (`metadataDeDecoradoresDisponible`). Si el entorno de test se arregla (ver la
 * propuesta en el handoff), estos empiezan a correr de verdad sin tocar este archivo — y si
 * alguna vez vuelve a faltar la metadata, van a aparecer como "skipped" en vez de mentir con
 * un `expect(500).toBe(200)` forzado.
 */
const paramTypesDeListar = Reflect.getMetadata(
  'design:paramtypes',
  SyncErroresController.prototype,
  'listar',
) as unknown[] | undefined;
const metadataDeDecoradoresDisponible = Array.isArray(paramTypesDeListar) && paramTypesDeListar.length > 0;

describe('GET /sync-errores — entorno de test', () => {
  it('registra si este runner emite design:paramtypes (si no, los tests HTTP de abajo se saltean)', () => {
    if (!metadataDeDecoradoresDisponible) {
      // eslint-disable-next-line no-console
      console.warn(
        '[sync-errores.controller.integration.test] este runner NO emite design:paramtypes ' +
          '(esbuild sin emitDecoratorMetadata) — se saltean los tests HTTP de este archivo. ' +
          'Ver docs/plan-correccion-post-piloto-2026-09-09.md.',
      );
    }
    expect(typeof metadataDeDecoradoresDisponible).toBe('boolean');
  });
});

/**
 * Auditoría post-piloto (QUI-242): se investigó un 500 reportado en
 * `GET /v1/sync-errores?desde=...` con causa "el pipe global no devuelve el `.data` coercido
 * de Zod". Contra un build real (`tsc`) no reprodujimos el 500 — sí lo reprodujimos contra
 * `tsx`/`vitest` (ver bloque de arriba). Este test pega la request real (HTTP -> Fastify ->
 * guards -> pipe -> DTO -> controller -> service -> Postgres) con el mismo query que reportó
 * el 500 y prueba dos cosas que un test a nivel de pipe no puede probar solo: (a) que la
 * request responde 200, no 500, y (b) que el filtro de fecha coercido REALMENTE filtra
 * contra filas reales (no solo "no explota"): inserta una fila antes del corte y otra
 * después, y verifica que solo vuelve la de después.
 */
describe.skipIf(!metadataDeDecoradoresDisponible)(
  'GET /sync-errores (integración real: guards + DTO Zod + pipe global + Postgres/RLS)',
  () => {
    let app: NestFastifyApplication;
    let accessToken: string;

    // Sindicato de aislamiento E2E (seed), no el del piloto — ver docs de seed.
    const sindicatoId = '44444444-4444-4444-8444-444444444444';
    const deviceId = `test-device-${randomUUID()}`;
    const filaAntesDelCorte = randomUUID();
    const filaDespuesDelCorte = randomUUID();

    beforeAll(async () => {
      app = await NestFactory.create(SyncErroresTestModule, new FastifyAdapter(), { logger: false });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const authService = new AuthService();
      const login = await authService.login({ email: 'admin@quivo.local', password: 'Quivo123!' });
      accessToken = login.accessToken;

      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.syncError.create({
          data: {
            id: filaAntesDelCorte,
            sindicatoId,
            deviceId,
            error: 'fila de control — anterior al filtro `desde`, no debe volver',
            payload: {},
            ts: new Date('2026-09-01T00:00:00.000Z'),
          },
        });
        await tx.syncError.create({
          data: {
            id: filaDespuesDelCorte,
            sindicatoId,
            deviceId,
            error: 'fila esperada — dentro del rango [desde, hasta)',
            payload: {},
            ts: new Date('2026-09-03T18:00:00.000Z'),
          },
        });
      });
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.syncError.deleteMany({ where: { deviceId } }),
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
          url: `/sync-errores?deviceId=${deviceId}&desde=2026-09-03T15:20:44.583Z`,
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
            `/sync-errores?deviceId=${deviceId}` +
            `&desde=2026-08-01T00:00:00.000Z&hasta=2026-09-02T00:00:00.000Z`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as Array<{ id: string; ts: string }>;
      // Con `hasta` en 2026-09-02, la fila del 09-03 queda afuera y solo vuelve la del 09-01.
      expect(body.map((fila) => fila.id)).toEqual([filaAntesDelCorte]);
    });
  },
);
