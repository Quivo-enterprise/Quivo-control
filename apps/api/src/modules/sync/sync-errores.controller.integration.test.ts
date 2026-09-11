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
 * GAP DE ENTORNO YA CERRADO (docs/plan-correccion-post-piloto-2026-09-09.md,
 * investigación 2026-09-10, fix 2026-09-11): Nest resuelve qué schema Zod validar/coerciona
 * en `@Query()` leyendo `design:paramtypes` (metadata que requiere `emitDecoratorMetadata`,
 * ver apps/api/tsconfig.json). `vitest` originalmente transformaba TypeScript con esbuild
 * puro, que NO emite esa metadata (evanw/esbuild#257) — sin ella, `ZodValidationPipe` nunca
 * encontraba `metatype.schema` y dejaba pasar el string crudo de la querystring, y
 * `inicioDeJornadaBolivia` de `sync-errores.service.ts` reventaba con
 * `fecha.getUTCFullYear is not a function`.
 *
 * Ese gap se cerró configurando `unplugin-swc` en `apps/api/vitest.config.ts`: swc SÍ emite
 * `design:paramtypes` bajo vitest, igual que `tsc` en el build real. Hoy, con esa config
 * activa, `Reflect.getMetadata('design:paramtypes', SyncErroresController.prototype,
 * 'listar')` YA NO da `undefined` — trae los tipos reales del handler.
 *
 * Este check pasa de ser un "aviso de gap conocido" a un **guardia de regresión obligatorio**:
 * si alguien borra el plugin de swc, quita `unplugin-swc` del package.json, o una futura
 * versión de vitest vuelve a esbuild puro por defecto, la metadata desaparece y el bug de
 * los 500 con `@Query()` vuelve a producción sin que nadie se entere — a menos que este
 * `expect` FALLE (no se salte) para que CI se ponga rojo. Por eso ya no hay `skipIf`: los
 * tests HTTP de abajo corren siempre, y si la metadata falta, fallan de verdad en vez de
 * desaparecer del reporte.
 */
const paramTypesDeListar = Reflect.getMetadata(
  'design:paramtypes',
  SyncErroresController.prototype,
  'listar',
) as unknown[] | undefined;
const metadataDeDecoradoresDisponible = Array.isArray(paramTypesDeListar) && paramTypesDeListar.length > 0;

describe('GET /sync-errores — entorno de test', () => {
  it('el runner emite design:paramtypes vía swc (si esto falla, los tests HTTP de abajo dejan de proteger nada)', () => {
    expect(
      metadataDeDecoradoresDisponible,
      '[sync-errores.controller.integration.test] falta design:paramtypes: revisá el plugin ' +
        'de swc en apps/api/vitest.config.ts (unplugin-swc) — sin esta metadata, ' +
        'ZodValidationPipe deja de coercionar @Query() y el 500 de producción vuelve sin que ' +
        'CI lo note. Ver docs/plan-correccion-post-piloto-2026-09-09.md.',
    ).toBe(true);
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
describe(
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
