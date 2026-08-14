import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';

function contextWithUser(user: { rol: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

function guardWithRoles(roles: string[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(roles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('deja pasar si el handler no tiene @Roles', () => {
    const guard = guardWithRoles(undefined);
    expect(guard.canActivate(contextWithUser({ rol: 'conductor' }))).toBe(true);
  });

  it('deja pasar si el rol del usuario está permitido', () => {
    const guard = guardWithRoles(['admin_quivo']);
    expect(guard.canActivate(contextWithUser({ rol: 'admin_quivo' }))).toBe(true);
  });

  it('rechaza si el rol del usuario no está permitido', () => {
    const guard = guardWithRoles(['admin_quivo']);
    expect(() => guard.canActivate(contextWithUser({ rol: 'admin_sindicato' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza si no hay usuario en el request', () => {
    const guard = guardWithRoles(['admin_quivo']);
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(ForbiddenException);
  });
});
