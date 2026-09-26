import { randomUUID } from 'node:crypto';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { CODIGO_SESION_NO_VIGENTE } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fechaActualBolivia, finDeJornadaBolivia } from '../../common/tiempo/jornada.js';
import { AuthMovilService } from './auth-movil.service.js';
import { SesionNoVigenteException } from './auth-movil.exceptions.js';
import { hashTokenOpaco } from './token-opaco.js';

// `verifyPassword` se envuelve en un `vi.fn` que delega a la implementación REAL (scrypt de
// Better Auth) — no hay mock de comportamiento acá, sólo instrumentación para poder contar
// cuántas verificaciones scrypt corrieron en cada test (padding de tiempo, lockout que NO
// debe tocar scrypt). `vi.spyOn` directo no sirve: `better-auth/crypto` es ESM puro y su
// namespace no es configurable (confirmado empíricamente: "Cannot redefine property").
vi.mock('better-auth/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('better-auth/crypto')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const GEOMETRIA = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-68.15, -16.5],
    [-68.14, -16.49],
  ],
});

describe('AuthMovilService', () => {
  const service = new AuthMovilService();
  const sindicatoId = randomUUID();
  const rutaId = randomUUID();
  const placa = `MOB${sindicatoId.slice(0, 5)}`;
  const documento = `CI-${sindicatoId.slice(0, 8)}`;
  const pinVehiculo = '246810';
  const pinConductor = '135790';
  const deviceId = `android:test-${sindicatoId.slice(0, 8)}`;

  beforeAll(async () => {
    const [vehiculoHash, conductorHash] = await Promise.all([
      hashPassword(pinVehiculo),
      hashPassword(pinConductor),
    ]);
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Sindicato Auth Móvil' } });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'M1', nombre: 'Línea móvil', color: '#3226B4' },
      });
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA}), 4326)::geography, 'activo', now(), now())
      `;
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa,
          tipo: 'minibus',
          marca: 'Toyota',
          modelo: 'Coaster',
          color: 'blanco',
          capacidad: 30,
          estado: 'activo',
          credencialHash: vehiculoHash,
        },
      });
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId,
          nombre: 'Chofer móvil',
          documentoIdentidad: documento,
          licenciaConducir: `LIC-${documento}`,
          credencialHash: conductorHash,
        },
      });
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: 'auth-movil-test', estado: 'publicada' },
      });
      const fecha = fechaActualBolivia();
      await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha,
          horario: 'manana',
          orden: 1,
          venceAt: finDeJornadaBolivia(fecha),
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.auditLog.deleteMany({ where: { sindicatoId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.desafioAuthMovil.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rotacion: { sindicatoId } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('rechaza el PIN incorrecto del vehículo con un error genérico', async () => {
    await expect(
      service.autenticarVehiculo({ placa, pin: '999999', deviceId }),
    ).rejects.toMatchObject({
      constructor: UnauthorizedException,
      message: 'Credenciales inválidas',
    });
  });

  it('impide usar el desafío desde otro dispositivo', async () => {
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    await expect(
      service.autenticarConductor({
        challengeToken: vehiculo.challengeToken,
        deviceId: 'android:otro-dispositivo',
        documentoIdentidad: documento,
        pin: pinConductor,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('autentica ambos pasos, resuelve línea y rota/revoca tokens', async () => {
    const vehiculo = await service.autenticarVehiculo({
      placa: placa.toLowerCase(),
      pin: pinVehiculo,
      deviceId,
    });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento.toLowerCase(),
      pin: pinConductor,
    });

    expect(login.status).toBe('autenticado');
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');
    expect(login.contexto).toMatchObject({
      vehiculo: { placa },
      conductor: { documentoIdentidad: documento },
      sindicato: { id: sindicatoId },
      linea: { codigo: 'M1', nombre: 'Línea móvil' },
      ruta: { id: rutaId, sentido: 'ida' },
    });

    const sesion = await service.validarAccessToken(login.accessToken);
    await expect(service.obtenerContexto(sesion)).resolves.toEqual(login.contexto);

    const rotado = await service.refresh({ refreshToken: login.refreshToken });
    expect(rotado.refreshToken).not.toBe(login.refreshToken);
    await expect(service.validarAccessToken(login.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Entrega 28: el refresh token ya rotado es exactamente el caso "sesión no vigente" —
    // sigue siendo un UnauthorizedException (compat hacia atrás), pero ahora es la subclase
    // distinguible.
    await expect(service.refresh({ refreshToken: login.refreshToken })).rejects.toBeInstanceOf(
      SesionNoVigenteException,
    );

    await service.logout({ refreshToken: rotado.refreshToken });
    await expect(service.validarAccessToken(rotado.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('Entrega 28 — SESION_NO_VIGENTE en el refresh rechazado', () => {
    it('un refresh EXITOSO no lanza y no lleva codigo alguno (comportamiento normal intacto)', async () => {
      const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
      const login = await service.autenticarConductor({
        challengeToken: vehiculo.challengeToken,
        deviceId,
        documentoIdentidad: documento,
        pin: pinConductor,
      });
      if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

      const rotado = await service.refresh({ refreshToken: login.refreshToken });
      expect(rotado).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
      expect(rotado).not.toHaveProperty('codigo');

      // Limpieza.
      await service.logout({ refreshToken: rotado.refreshToken });
    });

    it('refresh con un refreshToken NUNCA emitido (inventado) responde 401 con codigo SESION_NO_VIGENTE', async () => {
      const refreshTokenInventado = 'q'.repeat(40);
      const error: unknown = await service
        .refresh({ refreshToken: refreshTokenInventado })
        .catch((e) => e);

      expect(error).toBeInstanceOf(SesionNoVigenteException);
      expect(error).toBeInstanceOf(UnauthorizedException);
      const httpError = error as UnauthorizedException;
      expect(httpError.getStatus()).toBe(401);
      expect(httpError.getResponse()).toMatchObject({
        statusCode: 401,
        codigo: CODIGO_SESION_NO_VIGENTE,
      });
    });

    it('refresh con el refreshToken de una sesión CERRADA (logout) responde con codigo SESION_NO_VIGENTE', async () => {
      const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
      const login = await service.autenticarConductor({
        challengeToken: vehiculo.challengeToken,
        deviceId,
        documentoIdentidad: documento,
        pin: pinConductor,
      });
      if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

      await service.logout({ refreshToken: login.refreshToken });

      const error: unknown = await service
        .refresh({ refreshToken: login.refreshToken })
        .catch((e) => e);
      expect(error).toBeInstanceOf(SesionNoVigenteException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        codigo: CODIGO_SESION_NO_VIGENTE,
      });
    });

    it('refresh con el refreshToken de una sesión REVOCADA por login desplazado (otro dispositivo, mismo vehículo) responde con codigo SESION_NO_VIGENTE', async () => {
      // Reproduce el escenario real del piloto (Entrega 28): un teléfono sostiene un
      // refreshToken de una sesión que quedó desplazada porque OTRO dispositivo volvió a
      // loguear el mismo vehículo (`crearSesionOperativa` cierra las sesiones activas
      // previas del vehículo, ver auth-movil.service.ts).
      const vehiculo1 = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
      const login1 = await service.autenticarConductor({
        challengeToken: vehiculo1.challengeToken,
        deviceId,
        documentoIdentidad: documento,
        pin: pinConductor,
      });
      if (login1.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

      const otroDeviceId = `${deviceId}-desplazado`;
      const vehiculo2 = await service.autenticarVehiculo({
        placa,
        pin: pinVehiculo,
        deviceId: otroDeviceId,
      });
      const login2 = await service.autenticarConductor({
        challengeToken: vehiculo2.challengeToken,
        deviceId: otroDeviceId,
        documentoIdentidad: documento,
        pin: pinConductor,
      });
      if (login2.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

      // El teléfono 1 (desplazado) intenta refrescar con SU refreshToken viejo.
      const error: unknown = await service
        .refresh({ refreshToken: login1.refreshToken })
        .catch((e) => e);
      expect(error).toBeInstanceOf(SesionNoVigenteException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        codigo: CODIGO_SESION_NO_VIGENTE,
      });

      // Limpieza.
      await service.logout({ refreshToken: login2.refreshToken });
    });
  });

  it('logout con un refreshToken YA ROTADO cae al fallback por deviceId y sí cierra la sesión (docs/handoff.md:3382-3385)', async () => {
    // Reproduce el bug de QA del 2026-08-23: el cliente sostiene un refreshToken que el
    // servidor YA rotó (un `refresh()` previo tuvo éxito acá, simulando la rotación cuya
    // respuesta el cliente real nunca llegó a confirmar recibir) — `login.refreshToken` queda
    // "fantasma": inválido para `refresh()`, pero la sesión sigue `'activa'` con otro hash.
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    const rotado = await service.refresh({ refreshToken: login.refreshToken });
    // El token viejo ya no sirve para refrescar — confirma que quedó "fantasma".
    await expect(service.refresh({ refreshToken: login.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // La sesión, sin embargo, sigue activa (con el hash ROTADO) — es la sesión zombi.
    await expect(service.validarAccessToken(rotado.accessToken)).resolves.toMatchObject({
      deviceId,
    });

    // Logout con el token VIEJO (el único que el cliente real sostenía) + deviceId: el match
    // exacto por hash no encuentra nada, pero el fallback por deviceId sí cierra la sesión.
    await service.logout({ refreshToken: login.refreshToken, deviceId });

    await expect(service.validarAccessToken(rotado.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('SEGURIDAD (hallazgo 5): deviceId correcto + refreshToken INVENTADO no cierra la sesión activa', async () => {
    // Escenario del hallazgo: `deviceId` no es secreto (`en-vivo.service.ts` /
    // `recorridos.service.ts` lo devuelven a usuarios web), así que alguien que solo conoce
    // el `deviceId` — sin haber tenido nunca un `refreshToken` real de esta sesión — no debe
    // poder cerrarla mandando cualquier string de 32+ caracteres.
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    const refreshTokenInventado = 'z'.repeat(32);
    await service.logout({ refreshToken: refreshTokenInventado, deviceId });

    // La sesión sigue activa: ni el hash vigente ni `refreshTokenHashAnterior` (todavía
    // `null`, esta sesión nunca refrescó) matchean un string inventado.
    await expect(service.validarAccessToken(login.accessToken)).resolves.toMatchObject({
      deviceId,
    });

    // Repetir el ataque con OTRO string inventado tampoco debe cerrarla — no es un fluke de
    // un solo intento.
    await service.logout({ refreshToken: 'y'.repeat(40), deviceId });
    await expect(service.validarAccessToken(login.accessToken)).resolves.toMatchObject({
      deviceId,
    });

    // Limpieza.
    await service.logout({ refreshToken: login.refreshToken });
  });

  it('SEGURIDAD (hallazgo 5): tras refrescar, un refreshToken inventado TAMPOCO cierra la sesión (tiene refreshTokenHashAnterior, pero no matchea)', async () => {
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    const rotado = await service.refresh({ refreshToken: login.refreshToken });

    // Ahora la sesión SÍ tiene `refreshTokenHashAnterior` (el hash de `login.refreshToken`,
    // que la rotación de arriba dejó atrás) — pero un string inventado no coincide con ESE
    // hash tampoco: la ventana de "prueba de posesión" es exactamente uno, no "cualquiera".
    await service.logout({ refreshToken: 'w'.repeat(32), deviceId });
    await expect(service.validarAccessToken(rotado.accessToken)).resolves.toMatchObject({
      deviceId,
    });

    // Limpieza.
    await service.logout({ refreshToken: rotado.refreshToken });
  });

  it('logout SIN deviceId (cliente viejo, compat hacia atrás) sigue siendo un no-op silencioso si el token no matchea', async () => {
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    const rotado = await service.refresh({ refreshToken: login.refreshToken });

    // Sin `deviceId`, el comportamiento viejo se conserva: no encuentra nada, no lanza, no
    // cierra nada.
    await expect(service.logout({ refreshToken: login.refreshToken })).resolves.toBeUndefined();
    await expect(service.validarAccessToken(rotado.accessToken)).resolves.toMatchObject({
      deviceId,
    });

    // Limpieza: no dejar esta sesión activa para no interferir con otros tests del archivo.
    await service.logout({ refreshToken: rotado.refreshToken });
  });

  it('logout con deviceId ajeno (sin match de hash) NO toca la sesión de OTRO dispositivo', async () => {
    const otroDeviceId = `${deviceId}-fallback-scope`;
    const vehiculo1 = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login1 = await service.autenticarConductor({
      challengeToken: vehiculo1.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login1.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    // deviceId inventado, sin sesión propia — el fallback no encuentra nada que cerrar y la
    // sesión real (otro deviceId, refreshToken tampoco coincide) queda intacta.
    await service.logout({ refreshToken: 'x'.repeat(40), deviceId: otroDeviceId });
    await expect(service.validarAccessToken(login1.accessToken)).resolves.toMatchObject({
      deviceId,
    });

    // Limpieza.
    await service.logout({ refreshToken: login1.refreshToken, deviceId });
  });

  it('al rotar el PIN revoca sesiones y audita sin exponer la credencial', async () => {
    const vehiculo = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login = await service.autenticarConductor({
      challengeToken: vehiculo.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    const conductor = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.conductor.findFirstOrThrow({ where: { sindicatoId }, select: { id: true } }),
    );
    await service.establecerPinConductor(
      { userId: 'admin-auth-movil-test', rol: 'admin_quivo', sindicatoId: null },
      conductor.id,
      { pin: pinConductor },
    );

    await expect(service.validarAccessToken(login.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const auditoria = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: {
          sindicatoId,
          entidad: 'conductor',
          entidadId: conductor.id,
          accion: 'actualizar_credencial_movil',
        },
      }),
    );
    expect(auditoria.diff).toEqual({ desafiosInvalidados: 0, sesionesRevocadas: 1 });
    expect(JSON.stringify(auditoria)).not.toContain(pinConductor);
  }, 15_000);

  it('cierra la sesión activa previa del mismo vehículo al loguear desde OTRO dispositivo (plan §2.4.5)', async () => {
    const vehiculo1 = await service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId });
    const login1 = await service.autenticarConductor({
      challengeToken: vehiculo1.challengeToken,
      deviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login1.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    // Producción: 3 sesiones activas simultáneas del mismo vehículo en 2 dispositivos — el
    // cierre por `deviceId` solo nunca alcanzaba a una sesión abierta desde OTRO teléfono.
    const otroDeviceId = `${deviceId}-otro`;
    const vehiculo2 = await service.autenticarVehiculo({
      placa,
      pin: pinVehiculo,
      deviceId: otroDeviceId,
    });
    const login2 = await service.autenticarConductor({
      challengeToken: vehiculo2.challengeToken,
      deviceId: otroDeviceId,
      documentoIdentidad: documento,
      pin: pinConductor,
    });
    if (login2.status !== 'autenticado') throw new Error('Se esperaba autenticación completa');

    // La sesión del primer dispositivo quedó cerrada por el servidor (no por logout manual).
    await expect(service.validarAccessToken(login1.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // La sesión nueva (segundo dispositivo) sigue viva y con su propio `deviceId`.
    await expect(service.validarAccessToken(login2.accessToken)).resolves.toMatchObject({
      deviceId: otroDeviceId,
    });

    // Limpieza: no dejar esta sesión activa para no interferir con otros tests del archivo.
    await service.logout({ refreshToken: login2.refreshToken });
  });

  it('con MOBILE_LEGACY_AUTH_ENABLED=false, el login legado (/vehiculo) responde 410', async () => {
    const anterior = process.env.MOBILE_LEGACY_AUTH_ENABLED;
    process.env.MOBILE_LEGACY_AUTH_ENABLED = 'false';
    try {
      await expect(
        service.autenticarVehiculo({ placa, pin: pinVehiculo, deviceId }),
      ).rejects.toMatchObject({ status: 410 });
    } finally {
      if (anterior === undefined) delete process.env.MOBILE_LEGACY_AUTH_ENABLED;
      else process.env.MOBILE_LEGACY_AUTH_ENABLED = anterior;
    }
  });
});

describe('AuthMovilService — autenticarSesion (login de un paso, placa + PIN del conductor)', () => {
  const service = new AuthMovilService();
  const sindicatoId = randomUUID();
  const rutaId = randomUUID();
  let contadorPlaca = parseInt(sindicatoId.replace(/-/g, '').slice(0, 6), 16);

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Sindicato Un Paso' } });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'U1', nombre: 'Línea un paso', color: '#112233' },
      });
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA}), 4326)::geography, 'activo', now(), now())
      `;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.intentoAuthMovil.deleteMany({ where: { sindicatoId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.desafioAuthMovil.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rotacion: { sindicatoId } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  // Placa boliviana válida (`PATRON_PLACA_ACTUAL_BOLIVIA`), única por test — cada test usa
  // su PROPIO vehículo para que el lockout (por `vehiculoId`) de un test nunca contamine a
  // otro.
  function letrasDesdeIndice(n: number): string {
    let resultado = '';
    let x = n;
    for (let i = 0; i < 3; i++) {
      resultado = String.fromCharCode(65 + (x % 26)) + resultado;
      x = Math.floor(x / 26);
    }
    return resultado;
  }
  function placaUnica(): string {
    contadorPlaca += 1;
    const digitos = (1000 + (contadorPlaca % 9000)).toString();
    return `${digitos}${letrasDesdeIndice(contadorPlaca)}`;
  }

  async function crearConductor(nombre: string, pin: string) {
    const credencialHash = await hashPassword(pin);
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.conductor.create({
        data: {
          sindicatoId,
          nombre,
          documentoIdentidad: `CI-${randomUUID().slice(0, 8)}`,
          licenciaConducir: `LIC-${randomUUID().slice(0, 8)}`,
          estado: 'activo',
          credencialHash,
        },
      }),
    );
  }

  async function crearVehiculo(placa: string) {
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.create({
        data: {
          sindicatoId,
          placa,
          tipo: 'minibus',
          marca: 'Toyota',
          modelo: 'Coaster',
          color: 'blanco',
          capacidad: 30,
          estado: 'activo',
        },
      }),
    );
  }

  async function crearRotacion(estado: 'publicada' | 'borrador' = 'publicada') {
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.rotacion.create({
        data: { sindicatoId, periodo: `un-paso-${randomUUID().slice(0, 8)}`, estado },
      }),
    );
  }

  async function crearAsignacion(params: {
    rotacionId: string;
    vehiculoId: string;
    conductorId: string;
    fecha: Date;
    horario: string;
  }) {
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.create({
        data: {
          rotacionId: params.rotacionId,
          vehiculoId: params.vehiculoId,
          conductorId: params.conductorId,
          rutaId,
          fecha: params.fecha,
          horario: params.horario,
          orden: 1,
          venceAt: finDeJornadaBolivia(params.fecha),
          estado: 'vigente',
        },
      }),
    );
  }

  it('placa desconocida devuelve 401 genérico y ejecuta el padding de K=3 verificaciones scrypt', async () => {
    vi.mocked(verifyPassword).mockClear();
    await expect(
      service.autenticarSesion({
        placa: '9876ZZZ',
        pin: '123456',
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Placa o PIN incorrectos' });
    // K=3: el tiempo de respuesta con 0 candidatos reales no debe distinguirse de uno con
    // candidatos reales — las 3 verificaciones corren igual, contra el hash dummy.
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(3);
  });

  it('PIN correcto con una asignación vigente hoy autentica y crea la sesión con el conductorId correcto', async () => {
    const conductor = await crearConductor('Chofer Un Paso A', '111111');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'manana',
    });

    const resultado = await service.autenticarSesion({
      placa: vehiculo.placa,
      pin: '111111',
      deviceId: `android:${randomUUID()}`,
    });
    expect(resultado.status).toBe('autenticado');
    if (resultado.status !== 'autenticado') throw new Error('Se esperaba autenticado');
    expect(resultado.contexto.conductor.id).toBe(conductor.id);

    const sesion = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.sesionOperativa.findUnique({ where: { id: resultado.contexto.sesionId } }),
    );
    expect(sesion?.conductorId).toBe(conductor.id);
  });

  it('PIN correcto con 2 asignaciones hoy pide selección, con seleccionToken y DesafioAuthMovil con conductorId poblado', async () => {
    const conductor = await crearConductor('Chofer Un Paso B', '222222');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'manana',
    });
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'tarde',
    });

    const deviceId = `android:${randomUUID()}`;
    const resultado = await service.autenticarSesion({
      placa: vehiculo.placa,
      pin: '222222',
      deviceId,
    });
    expect(resultado.status).toBe('seleccion_requerida');
    if (resultado.status !== 'seleccion_requerida') throw new Error('Se esperaba selección');
    expect(resultado.asignaciones).toHaveLength(2);
    expect(resultado.seleccionToken).toBeTruthy();

    const desafio = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.desafioAuthMovil.findUnique({
        where: { tokenHash: hashTokenOpaco(resultado.seleccionToken) },
      }),
    );
    expect(desafio?.conductorId).toBe(conductor.id);

    // Bonus (no listado explícitamente en el brief, pero es el flujo completo del segundo
    // endpoint nuevo): seleccionar la asignación consume el token y autentica.
    const seleccion = await service.seleccionarAsignacion({
      seleccionToken: resultado.seleccionToken,
      asignacionId: resultado.asignaciones[0]!.id,
      deviceId,
    });
    expect(seleccion.status).toBe('autenticado');

    // El seleccionToken es de un solo uso.
    await expect(
      service.seleccionarAsignacion({
        seleccionToken: resultado.seleccionToken,
        asignacionId: resultado.asignaciones[0]!.id,
        deviceId,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('PIN correcto pero sin rotación publicada hoy (matchea sólo en nivel 2) responde 409 con el nombre del conductor', async () => {
    const conductor = await crearConductor('Chofer Un Paso C', '333333');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const hoy = fechaActualBolivia();
    const haceCincoDias = new Date(hoy);
    haceCincoDias.setUTCDate(haceCincoDias.getUTCDate() - 5);
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha: haceCincoDias,
      horario: 'manana',
    });

    await expect(
      service.autenticarSesion({
        placa: vehiculo.placa,
        pin: '333333',
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(conductor.nombre),
    });
  });

  // H1 (hallazgo de revisión, alto): antes, el 409 de nivel 2 llamaba `resetearIntentos` justo
  // antes de lanzar la excepción — como `buscarCandidatosNivel2` no filtra por
  // `conductor.estado`, alternar 3 PINs errados + 1 PIN que matchea en nivel 2 (el propio, o
  // el de un ex-conductor) volvía `fallos`/`bloqueadoHasta` a cero cada vez y el backoff
  // exponencial nunca enganchaba. Este test fija el comportamiento correcto: el 409 no toca
  // el contador en ningún sentido (ni lo resetea, ni lo incrementa — ver el comentario en
  // `auth-movil.service.ts:autenticarSesion`).
  it('el 409 de nivel 2 no resetea el contador de fallos', async () => {
    const conductor = await crearConductor('Chofer Un Paso C2', '999911');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const hoy = fechaActualBolivia();
    const haceCincoDias = new Date(hoy);
    haceCincoDias.setUTCDate(haceCincoDias.getUTCDate() - 5);
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha: haceCincoDias,
      horario: 'manana',
    });

    // 3 intentos con PIN incorrecto: nivel 1 no matchea nada (sin asignación HOY), nivel 2
    // tampoco (el PIN incorrecto no matchea al candidato de hace 5 días) → 401 + fallos++.
    for (let i = 0; i < 3; i++) {
      await expect(
        service.autenticarSesion({
          placa: vehiculo.placa,
          pin: '000000',
          deviceId: `android:${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    let intento = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.intentoAuthMovil.findUnique({ where: { vehiculoId: vehiculo.id } }),
    );
    expect(intento?.fallos).toBe(3);

    // El PIN CORRECTO sólo matchea en nivel 2 (sin rotación publicada hoy) → 409.
    await expect(
      service.autenticarSesion({
        placa: vehiculo.placa,
        pin: '999911',
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 409 });

    intento = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.intentoAuthMovil.findUnique({ where: { vehiculoId: vehiculo.id } }),
    );
    expect(intento?.fallos).toBe(3);
  });

  it('PIN incorrecto responde 401 e incrementa el contador de fallos', async () => {
    const conductor = await crearConductor('Chofer Un Paso D', '444444');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'manana',
    });

    await expect(
      service.autenticarSesion({
        placa: vehiculo.placa,
        pin: '000000',
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Placa o PIN incorrectos' });

    const intento = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.intentoAuthMovil.findUnique({ where: { vehiculoId: vehiculo.id } }),
    );
    expect(intento?.fallos).toBe(1);
  });

  it('con lockout activo (bloqueadoHasta futuro) responde 429 con retryAfterSeconds y NO ejecuta ninguna verificación scrypt', async () => {
    const conductor = await crearConductor('Chofer Un Paso E', '555555');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'manana',
    });

    const bloqueadoHasta = new Date(Date.now() + 30_000);
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.intentoAuthMovil.create({
        data: { sindicatoId, vehiculoId: vehiculo.id, fallos: 5, bloqueadoHasta },
      }),
    );

    vi.mocked(verifyPassword).mockClear();
    await expect(
      service.autenticarSesion({
        placa: vehiculo.placa,
        pin: '555555',
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({
      status: 429,
      response: { retryAfterSeconds: expect.any(Number) },
    });
    expect(vi.mocked(verifyPassword)).not.toHaveBeenCalled();
  });

  it('dos conductores con el mismo PIN devuelven 401 genérico (no 200) y reportan la colisión', async () => {
    const pinCompartido = '666666';
    const conductorF = await crearConductor('Chofer Un Paso F', pinCompartido);
    const conductorG = await crearConductor('Chofer Un Paso G', pinCompartido);
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductorF.id,
      fecha,
      horario: 'manana',
    });
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductorG.id,
      fecha,
      horario: 'tarde',
    });

    const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      service.autenticarSesion({
        placa: vehiculo.placa,
        pin: pinCompartido,
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Placa o PIN incorrectos' });
    expect(loggerErrorSpy).toHaveBeenCalled();
    loggerErrorSpy.mockRestore();
  });

  it('seleccionToken emitido para otro deviceId responde 401', async () => {
    const conductor = await crearConductor('Chofer Un Paso H', '777777');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'manana',
    });
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'tarde',
    });

    const deviceId = `android:${randomUUID()}`;
    const resultado = await service.autenticarSesion({
      placa: vehiculo.placa,
      pin: '777777',
      deviceId,
    });
    if (resultado.status !== 'seleccion_requerida') throw new Error('Se esperaba selección');

    await expect(
      service.seleccionarAsignacion({
        seleccionToken: resultado.seleccionToken,
        asignacionId: resultado.asignaciones[0]!.id,
        deviceId: `${deviceId}-otro`,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un éxito resetea el contador de fallos a 0', async () => {
    const conductor = await crearConductor('Chofer Un Paso I', '888888');
    const vehiculo = await crearVehiculo(placaUnica());
    const rotacion = await crearRotacion('publicada');
    const fecha = fechaActualBolivia();
    await crearAsignacion({
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      fecha,
      horario: 'manana',
    });

    // Un par de fallos antes del éxito, para tener algo que resetear.
    await expect(
      service.autenticarSesion({
        placa: vehiculo.placa,
        pin: '000000',
        deviceId: `android:${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    let intento = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.intentoAuthMovil.findUnique({ where: { vehiculoId: vehiculo.id } }),
    );
    expect(intento?.fallos).toBe(1);

    await service.autenticarSesion({
      placa: vehiculo.placa,
      pin: '888888',
      deviceId: `android:${randomUUID()}`,
    });

    intento = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.intentoAuthMovil.findUnique({ where: { vehiculoId: vehiculo.id } }),
    );
    expect(intento?.fallos).toBe(0);
    expect(intento?.bloqueadoHasta).toBeNull();
  });
});
