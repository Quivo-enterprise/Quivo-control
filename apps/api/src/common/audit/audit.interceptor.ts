import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { withTenantContext } from '@quivo/db';
import type { Observable } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { AUDIT_ACCION_KEY, AUDIT_ENTIDAD_KEY } from './audit.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';

const ACCION_POR_METODO: Record<string, string> = {
  POST: 'crear',
  PATCH: 'editar',
  PUT: 'editar',
  DELETE: 'anular',
};

interface RequestConAuditoria {
  method: string;
  body: unknown;
  params: Record<string, string>;
  user?: AuthenticatedUser;
}

/**
 * Interceptor global (registrado en AppModule vía APP_INTERCEPTOR) que reemplaza las
 * llamadas manuales a `auditar()` que tenían sindicatos/socios/vehiculos/conductores/
 * lineas/rutas/variantes/paradas/puntos-control (QUI-220..226) — un solo lugar en vez de
 * nueve copias casi idénticas. Solo actúa si el handler lleva `@Auditable('entidad')`; sin
 * eso, la request pasa de largo (todos los `GET` quedan afuera).
 *
 * `diff` acá es directamente el body de la request (más simple que reconstruir el
 * `{antes, cambios}` que armaban las versiones manuales) — alcanza para lo que pide QUI-230
 * ("diff JSONB"), sin necesitar leer el estado anterior de la entidad en este nivel genérico.
 *
 * `sindicatoId` del registro: se toma del `sindicatoId` de la propia entidad devuelta si lo
 * tiene (socios/vehículos/conductores/líneas), o de su `id` si la entidad ES un sindicato;
 * si no hay ninguno de los dos (rutas/variantes/paradas/puntos-control, que no cargan su
 * `sindicatoId` en la respuesta) cae al tenant del actor — para `admin_quivo` actuando
 * cross-tenant en esos 4 módulos, el registro queda con `sindicatoId: null` en vez del
 * tenant real afectado; imprecisión conocida y aceptada por simplicidad (ver README de
 * módulos: estos 4 no tienen columna `sindicatoId` propia ni siquiera en su tabla real).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  // `@Inject(Reflector)` explícito: `tsx`/esbuild (usado por `dev`) no emite
  // `design:paramtypes` de forma confiable para clases importadas de paquetes externos
  // (evanw/esbuild#257) — sin esto, `reflector` llega `undefined` y ESTE interceptor global
  // (`APP_INTERCEPTOR`, corre en cada request) rompe TODA la API con 500, no solo /health.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const entidad = this.reflector.get<string | undefined>(AUDIT_ENTIDAD_KEY, context.getHandler());
    if (!entidad) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestConAuditoria>();
    const accionOverride = this.reflector.get<string | undefined>(AUDIT_ACCION_KEY, context.getHandler());
    const accion = accionOverride ?? ACCION_POR_METODO[request.method];
    const actor = request.user;
    if (!accion || !actor) {
      return next.handle();
    }

    return next.handle().pipe(
      // `concatMap` (no `tap`): esperamos a que el insert en audit_log termine ANTES de
      // devolver la respuesta — si el insert falla, la request falla también, en vez de
      // fallar en silencio en segundo plano después de que el cliente ya recibió un 200/201.
      concatMap(async (resultado: unknown) => {
        const entidadId = extraerId(resultado) ?? request.params?.id;
        if (!entidadId) {
          return resultado;
        }
        const sindicatoId = resolverSindicatoId(entidad, resultado, actor);
        await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
          tx.auditLog.create({
            data: {
              sindicatoId,
              usuarioId: actor.userId,
              entidad,
              entidadId,
              accion,
              diff: (request.body ?? {}) as object,
            },
          }),
        );
        return resultado;
      }),
    );
  }
}

function extraerId(resultado: unknown): string | undefined {
  if (resultado && typeof resultado === 'object' && 'id' in resultado) {
    return (resultado as { id: unknown }).id as string;
  }
  return undefined;
}

function resolverSindicatoId(entidad: string, resultado: unknown, actor: AuthenticatedUser): string | null {
  if (resultado && typeof resultado === 'object' && 'sindicatoId' in resultado) {
    return (resultado as { sindicatoId: string | null }).sindicatoId;
  }
  if (entidad === 'sindicato') {
    return extraerId(resultado) ?? null;
  }
  return actor.sindicatoId;
}
