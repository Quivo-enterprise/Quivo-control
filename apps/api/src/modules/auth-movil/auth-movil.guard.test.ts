import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AuthMovilGuard } from './auth-movil.guard.js';
import type { AuthMovilService } from './auth-movil.service.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';

// `AuthMovilGuard.canActivate` solo toca `context.switchToHttp().getRequest()`.
function createContext(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function req(
  ip: string,
  authorization?: string,
): FastifyRequest & { sesionMovil?: SesionMovilAutenticada } {
  return {
    ip,
    headers: authorization ? { authorization } : {},
  } as unknown as FastifyRequest & { sesionMovil?: SesionMovilAutenticada };
}

const sesion: SesionMovilAutenticada = {
  sesionId: 's-1',
  sindicatoId: 'sind-1',
  asignacionId: 'asig-1',
  vehiculoId: 'veh-1',
  conductorId: 'cond-1',
  deviceId: 'device-1',
};

describe('AuthMovilGuard — caché negativa por token (QUI-240 code-review, 3ra vuelta)', () => {
  it('una credencial válida pasa siempre, aunque su IP ya tenga tokens inválidos cacheados', async () => {
    const validarAccessToken = vi.fn();
    const authMovilService = { validarAccessToken } as unknown as AuthMovilService;
    const guard = new AuthMovilGuard(authMovilService);
    const ipCompartida = '190.10.20.30';

    // "Agotar el cupo" de esta IP con 30 tokens inválidos DISTINTOS (simula un teléfono en
    // bucle de reintentos, cada intento con un token nuevo emitido por un refresh fallido).
    validarAccessToken.mockRejectedValue(
      new UnauthorizedException('Sesión móvil inválida o expirada'),
    );
    for (let intento = 0; intento < 30; intento += 1) {
      await expect(
        guard.canActivate(createContext(req(ipCompartida, `Bearer token-vencido-${intento}`))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // Un chofer DISTINTO, misma IP (CGNAT), con credencial válida: tiene que pasar. Nada de
    // lo que hizo el otro teléfono en esta IP puede tumbarlo.
    validarAccessToken.mockResolvedValueOnce(sesion);
    await expect(
      guard.canActivate(createContext(req(ipCompartida, 'Bearer token-valido-de-otro-chofer'))),
    ).resolves.toBe(true);
  });

  it('el bucle de 401 de un teléfono no afecta a otro dispositivo con token válido en la misma IP', async () => {
    // `mockImplementation` keyed por el token recibido (no una cola de "once"): a partir de
    // la 2da vuelta, el token de A ya está cacheado como inválido y el guard NI SIQUIERA
    // llama a `validarAccessToken` para A — con una cola de valores encolados por vuelta esa
    // llamada "sobrante" quedaría sin consumir y correría el turno de B por error.
    const validarAccessToken = vi.fn().mockImplementation(async (token: string) => {
      if (token === 'token-vencido-de-A') {
        throw new UnauthorizedException('Sesión móvil inválida o expirada');
      }
      return sesion;
    });
    const authMovilService = { validarAccessToken } as unknown as AuthMovilService;
    const guard = new AuthMovilGuard(authMovilService);
    const ipCompartida = '190.10.20.40';

    // Intercalado real: el teléfono A reintenta el MISMO token vencido (típico bucle de
    // refresh fallido) mientras el teléfono B sigue sincronizando normalmente.
    for (let intento = 0; intento < 30; intento += 1) {
      await expect(
        guard.canActivate(createContext(req(ipCompartida, 'Bearer token-vencido-de-A'))),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        guard.canActivate(createContext(req(ipCompartida, 'Bearer token-valido-de-B'))),
      ).resolves.toBe(true);
    }

    // El ahorro real: A solo tocó la validación real UNA vez (las otras 29 se cortaron por
    // caché); B la tocó las 30 veces porque su token nunca queda cacheado como inválido.
    expect(validarAccessToken).toHaveBeenCalledTimes(1 + 30);
  });

  it('un error de infraestructura (Postgres caído/timeout) NO se cachea como token inválido', async () => {
    const validarAccessToken = vi.fn().mockRejectedValue(new Error('connection terminated'));
    const authMovilService = { validarAccessToken } as unknown as AuthMovilService;
    const guard = new AuthMovilGuard(authMovilService);
    const request = req('190.10.20.50', 'Bearer token-cualquiera');

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      'connection terminated',
    );
    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      'connection terminated',
    );

    // Se llamó dos veces: el error de infra NO quedó cacheado, así que cada request vuelve a
    // intentar la validación real (ni bien la base se recupera, el chofer puede entrar).
    expect(validarAccessToken).toHaveBeenCalledTimes(2);
  });

  it('un token inválido repetido N veces solo consulta la validación (Postgres) una vez', async () => {
    const validarAccessToken = vi
      .fn()
      .mockRejectedValue(new UnauthorizedException('Sesión móvil inválida o expirada'));
    const authMovilService = { validarAccessToken } as unknown as AuthMovilService;
    const guard = new AuthMovilGuard(authMovilService);
    const request = req('190.10.20.60', 'Bearer token-repetido-basura');

    for (let intento = 0; intento < 15; intento += 1) {
      await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    // El ahorro real del fix: 15 intentos con el MISMO token, una sola consulta real.
    expect(validarAccessToken).toHaveBeenCalledTimes(1);
  });

  it('no regresión de CGNAT: 20 dispositivos válidos, misma IP, 6 req/min cada uno — ninguno falla', async () => {
    const validarAccessToken = vi.fn().mockResolvedValue(sesion);
    const authMovilService = { validarAccessToken } as unknown as AuthMovilService;
    const guard = new AuthMovilGuard(authMovilService);
    const ipCompartida = '190.10.20.70';

    for (let dispositivo = 0; dispositivo < 20; dispositivo += 1) {
      for (let intento = 0; intento < 6; intento += 1) {
        await expect(
          guard.canActivate(
            createContext(req(ipCompartida, `Bearer token-valido-${dispositivo}`)),
          ),
        ).resolves.toBe(true);
      }
    }
  });

  it('sin Bearer no llega a tocar la validación ni la caché', async () => {
    const validarAccessToken = vi.fn();
    const authMovilService = { validarAccessToken } as unknown as AuthMovilService;
    const guard = new AuthMovilGuard(authMovilService);

    await expect(
      guard.canActivate(createContext(req('190.10.20.80'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(validarAccessToken).not.toHaveBeenCalled();
  });
});
