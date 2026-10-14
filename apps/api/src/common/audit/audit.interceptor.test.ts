import { randomUUID } from 'node:crypto';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { prisma, withTenantContext } from '@quivo/db';
import { firstValueFrom, of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AUDIT_ACCION_KEY, AUDIT_ENTIDAD_KEY } from './audit.decorator.js';
import { AuditInterceptor } from './audit.interceptor.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';

function contexto(opts: {
  method: string;
  body?: unknown;
  params?: Record<string, string>;
  user?: AuthenticatedUser;
}): ExecutionContext {
  const request = { method: opts.method, body: opts.body ?? {}, params: opts.params ?? {}, user: opts.user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
  } as unknown as ExecutionContext;
}

function handlerQueDevuelve(resultado: unknown): CallHandler {
  return { handle: () => of(resultado) };
}

// El mock del `Reflector` distingue por key (como el real): sin esto, pedir
// `AUDIT_ACCION_KEY` devolvería `entidad` también, pisando el `crear`/`editar` inferido del
// método HTTP (bug real que hizo fallar este test al agregar el override de QUI-232).
function interceptorConEntidad(entidad: string | undefined, accion?: string): AuditInterceptor {
  const reflector = {
    get: vi.fn((key: string) => {
      if (key === AUDIT_ENTIDAD_KEY) return entidad;
      if (key === AUDIT_ACCION_KEY) return accion;
      return undefined;
    }),
  } as unknown as Reflector;
  return new AuditInterceptor(reflector);
}

function adminQuivo(): AuthenticatedUser {
  return { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
}

/** Test de integración real (no mockea `withTenantContext`) — confirma que el interceptor
 * de verdad escribe en `audit_log` con RLS activo y respetando su FK real hacia
 * `sindicatos`, no solo que llama a la función correcta con los parámetros esperados. */
describe('AuditInterceptor', () => {
  // audit_log.sindicatoId tiene FK real hacia sindicatos — a diferencia de entidadId (String
  // libre, sin FK, porque referencia distintas tablas según `entidad`), acá no alcanza con
  // un UUID cualquiera: hace falta un sindicato real para los casos que lo ejercitan.
  const sindicatoId = randomUUID();
  const creadosAuditLog: string[] = [];

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Audit Test', estado: 'activo' } }),
    );
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.auditLog.deleteMany({ where: { entidadId: { in: creadosAuditLog } } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('no hace nada si el handler no tiene @Auditable', async () => {
    const interceptor = interceptorConEntidad(undefined);
    const resultado = { id: randomUUID() };
    const valor = await firstValueFrom(
      interceptor.intercept(contexto({ method: 'POST' }), handlerQueDevuelve(resultado)),
    );
    expect(valor).toBe(resultado);
  });

  it('no hace nada si el método HTTP no es auditable (GET)', async () => {
    const interceptor = interceptorConEntidad('sindicato');
    const resultado = [{ id: randomUUID() }];
    const valor = await firstValueFrom(
      interceptor.intercept(contexto({ method: 'GET', user: adminQuivo() }), handlerQueDevuelve(resultado)),
    );
    expect(valor).toBe(resultado);
  });

  it('audita un POST exitoso usando el sindicatoId de la propia entidad devuelta', async () => {
    const interceptor = interceptorConEntidad('socio');
    const entidadId = randomUUID();
    const resultado = { id: entidadId, sindicatoId, nombre: 'Socio X' };

    await firstValueFrom(
      interceptor.intercept(
        contexto({ method: 'POST', body: { nombre: 'Socio X' }, user: adminQuivo() }),
        handlerQueDevuelve(resultado),
      ),
    );
    creadosAuditLog.push(entidadId);

    const fila = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirst({ where: { entidadId } }),
    );
    expect(fila).not.toBeNull();
    expect(fila?.entidad).toBe('socio');
    expect(fila?.accion).toBe('crear');
    expect(fila?.sindicatoId).toBe(sindicatoId);
    expect(fila?.usuarioId).toBe('test-admin-quivo');
  });

  it('enmascara telefono en el diff y deja el resto del body intacto', async () => {
    const interceptor = interceptorConEntidad('conductor');
    const entidadId = randomUUID();
    await firstValueFrom(
      interceptor.intercept(
        contexto({
          method: 'POST',
          body: { nombre: 'Juan', telefono: '+59171234567' },
          user: adminQuivo(),
        }),
        handlerQueDevuelve({ id: entidadId, sindicatoId }),
      ),
    );
    creadosAuditLog.push(entidadId);
    const fila = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirst({ where: { entidadId } }),
    );
    expect(fila?.diff).toEqual({ nombre: 'Juan', telefono: '+591******67' });
  });

  it('audita un PATCH usando el id de los params si la respuesta no trae id', async () => {
    const interceptor = interceptorConEntidad('variante');
    const entidadId = randomUUID();
    const resultado = { nombre: 'Sin id en la respuesta' };

    await firstValueFrom(
      interceptor.intercept(
        contexto({ method: 'PATCH', params: { id: entidadId }, user: adminQuivo() }),
        handlerQueDevuelve(resultado),
      ),
    );
    creadosAuditLog.push(entidadId);

    const fila = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirst({ where: { entidadId } }),
    );
    expect(fila).not.toBeNull();
    expect(fila?.accion).toBe('editar');
    // Sin sindicatoId propio ni en la entidad (no es 'sindicato') -> cae al del actor.
    expect(fila?.sindicatoId).toBeNull();
  });

  it('registra el id propio como sindicatoId cuando la entidad es "sindicato"', async () => {
    const interceptor = interceptorConEntidad('sindicato');
    const resultado = { id: sindicatoId, nombre: 'Audit Test', estado: 'activo' };

    await firstValueFrom(
      interceptor.intercept(contexto({ method: 'POST', user: adminQuivo() }), handlerQueDevuelve(resultado)),
    );
    creadosAuditLog.push(sindicatoId);

    const fila = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirst({ where: { entidadId: sindicatoId } }),
    );
    expect(fila?.sindicatoId).toBe(sindicatoId);
  });

  it('usa el override de acción del decorador en vez de inferirla del método HTTP (QUI-232)', async () => {
    const interceptor = interceptorConEntidad('rotacion', 'publicar');
    const entidadId = randomUUID();
    const resultado = { id: entidadId, sindicatoId, periodo: '2026-08', estado: 'publicada' };

    await firstValueFrom(
      interceptor.intercept(contexto({ method: 'POST', user: adminQuivo() }), handlerQueDevuelve(resultado)),
    );
    creadosAuditLog.push(entidadId);

    const fila = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirst({ where: { entidadId } }),
    );
    expect(fila?.accion).toBe('publicar');
  });
});
