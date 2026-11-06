import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FilaSesion {
  id: string;
  userId: string;
  token: string;
  updatedAt: Date;
  expiresAt: Date;
}

const TTL_SEGUNDOS = 30 * 86400;
const filas = new Map<string, FilaSesion>();
// Hook para simular que otro request se adelanta justo antes del updateMany (el CAS).
let antesDelCas: (() => void) | null = null;

vi.mock('@quivo/db', () => {
  const bearer = (headers: Headers) => headers.get('authorization')!.replace('Bearer ', '');
  return {
    SESSION_TTL_SECONDS: 30 * 86400,
    resolveJwtSecret: () => 'secreto-ficticio-de-prueba-con-mas-de-32-caracteres',
    withTenantContext: vi.fn(),
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const fila = [...filas.values()].find((f) => f.token === bearer(headers));
          return fila ? { session: { ...fila }, user: { id: fila.userId } } : null;
        },
        getToken: async ({ headers }: { headers: Headers }) => ({
          token: `jwt(${bearer(headers)})`,
        }),
      },
    },
    prisma: {
      session: {
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; token: string };
          data: Partial<FilaSesion>;
        }) => {
          antesDelCas?.();
          const fila = filas.get(where.id);
          if (!fila || fila.token !== where.token) return { count: 0 };
          Object.assign(fila, data);
          return { count: 1 };
        },
        findUnique: async ({ where }: { where: { id: string } }) => filas.get(where.id) ?? null,
        deleteMany: async ({ where }: { where: { id?: string; userId?: string } }) => {
          let count = 0;
          for (const f of [...filas.values()]) {
            if ((where.id && f.id === where.id) || (where.userId && f.userId === where.userId)) {
              filas.delete(f.id);
              count++;
            }
          }
          return { count };
        },
      },
    },
  };
});

const { AuthService } = await import('./auth.service.js');

function sembrar(id: string, userId: string, token: string): void {
  filas.set(id, {
    id,
    userId,
    token,
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400_000),
  });
}

describe('AuthService.refresh (revocación por sesión y ventana de gracia)', () => {
  const servicio = new AuthService();

  beforeEach(() => {
    filas.clear();
    antesDelCas = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    sembrar('s1', 'u1', 'token-inicial-1');
    sembrar('s2', 'u1', 'token-inicial-2');
  });
  afterEach(() => vi.useRealTimers());

  it('rotar extiende expiresAt a ahora + TTL y marca updatedAt', async () => {
    const { refreshToken } = await servicio.refresh({ refreshToken: 'token-inicial-1' });
    expect(refreshToken).not.toBe('token-inicial-1');
    const fila = filas.get('s1')!;
    expect(fila.token).toBe(refreshToken);
    expect(fila.expiresAt.getTime()).toBe(Date.now() + TTL_SEGUNDOS * 1000);
    expect(fila.updatedAt.getTime()).toBe(Date.now());
  });

  it('reuso dentro de 120 s devuelve el token vigente sin rotar de nuevo', async () => {
    const primero = await servicio.refresh({ refreshToken: 'token-inicial-1' });
    vi.advanceTimersByTime(60_000);
    const repetido = await servicio.refresh({ refreshToken: 'token-inicial-1' });
    expect(repetido.refreshToken).toBe(primero.refreshToken);
    expect(repetido.accessToken).toBe(`jwt(${primero.refreshToken})`);
    expect(filas.get('s1')!.token).toBe(primero.refreshToken); // no rotó
    await expect(servicio.refresh({ refreshToken: primero.refreshToken })).resolves.toBeDefined();
  });

  it('reuso pasados 120 s: 401 y revoca solo esa sesión; la otra del mismo usuario sobrevive', async () => {
    await servicio.refresh({ refreshToken: 'token-inicial-1' });
    vi.advanceTimersByTime(121_000);
    await expect(servicio.refresh({ refreshToken: 'token-inicial-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(filas.has('s1')).toBe(false);
    expect(filas.has('s2')).toBe(true);
    await expect(servicio.refresh({ refreshToken: 'token-inicial-2' })).resolves.toBeDefined();
  });

  it('reuso de un token dos rotaciones atrás: 401 aunque sea reciente, solo esa sesión', async () => {
    const r1 = await servicio.refresh({ refreshToken: 'token-inicial-1' });
    await servicio.refresh({ refreshToken: r1.refreshToken });
    await expect(servicio.refresh({ refreshToken: 'token-inicial-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(filas.has('s1')).toBe(false);
    expect(filas.has('s2')).toBe(true);
  });

  it('pierde el CAS y el token vigente no es el siguiente esperado: 401 y revoca solo esa sesión', async () => {
    antesDelCas = () => {
      antesDelCas = null;
      // Otro request cambia el token justo antes del swap, con un valor que no es el derivado.
      const f = filas.get('s1')!;
      f.token = 'token-ajeno';
      f.updatedAt = new Date();
    };
    await expect(servicio.refresh({ refreshToken: 'token-inicial-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(filas.has('s1')).toBe(false);
    expect(filas.has('s2')).toBe(true);
  });

  it('dos refresh concurrentes con el mismo token: ninguno revoca y ambos devuelven el token vigente', async () => {
    let anidado: Promise<{ refreshToken: string }> | null = null;
    antesDelCas = () => {
      antesDelCas = null;
      anidado = servicio.refresh({ refreshToken: 'token-inicial-1' });
    };
    const uno = await servicio.refresh({ refreshToken: 'token-inicial-1' });
    const dos = await anidado!;
    expect(filas.has('s1')).toBe(true);
    expect(uno.refreshToken).toBe(filas.get('s1')!.token);
    expect(dos.refreshToken).toBe(uno.refreshToken);
  });
});
