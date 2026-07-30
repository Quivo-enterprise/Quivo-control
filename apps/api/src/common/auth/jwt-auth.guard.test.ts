import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { auth } from '@quivo/db';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';

vi.mock('@quivo/db', () => ({
  auth: { api: { verifyJWT: vi.fn() } },
}));

function contextWithHeader(authorization?: string): ExecutionContext {
  const request = { headers: { authorization } } as { headers: Record<string, string | undefined>; user?: unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('rechaza si falta el header Authorization', async () => {
    const guard = new JwtAuthGuard();
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza si el token no verifica (payload null)', async () => {
    vi.mocked(auth.api.verifyJWT).mockResolvedValue({ payload: null });
    const guard = new JwtAuthGuard();
    await expect(guard.canActivate(contextWithHeader('Bearer token-invalido'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('setea request.user y permite pasar si el token verifica', async () => {
    vi.mocked(auth.api.verifyJWT).mockResolvedValue({
      payload: { sub: 'user-1', aud: 'quivo', rol: 'admin_quivo', sindicatoId: null },
    });
    const guard = new JwtAuthGuard();
    const context = contextWithHeader('Bearer token-valido');
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const request = context.switchToHttp().getRequest<{ user?: unknown }>();
    expect(request.user).toEqual({ userId: 'user-1', rol: 'admin_quivo', sindicatoId: null });
  });
});
