import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { EnVivoService, derivarFrescura } from './en-vivo.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.395, -34.6] });
const PC_INACTIVO_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.397, -34.6] });

const MINUTO = 60_000;

/**
 * Reloj determinista anclado al **mediodía UTC de hoy**, no a `new Date()`. Dos razones:
 *
 * 1. Todos los `gps_points` del test caen dentro de la partición del día UTC en curso, así
 *    que alcanza con asegurar UNA partición. Importa: `crear_particion_gps_points` corre
 *    `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY` en **cada** llamada (ver
 *    `20260817130000_particion_gps_points_idempotente`), y ese `ALTER TABLE` toma un
 *    `AccessExclusiveLock` sobre la partición aunque ya exista — con vitest corriendo los
 *    archivos de test en paralelo, cada llamada extra es una chance de deadlock contra otro
 *    archivo que esté leyendo/escribiendo `gps_points`.
 * 2. `listarHoy`/`obtenerContexto`/`obtenerTraza` reciben `ahora` inyectable: con un reloj
 *    fijo las aserciones de frescura son exactas en vez de aproximadas.
 */
const AHORA = (() => {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 12));
})();

describe('EnVivoService', () => {
  const service = new EnVivoService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rutaId: string;
  let puntoControlId: string;
  /** Sesión activa con 2 fixes. */
  let sesionConPuntosId: string;
  /** Sesión activa sin ningún fix — el caso "esperando el primer punto GPS". */
  let sesionSinPuntosId: string;
  /** `inicio` de `sesionConPuntosId`, ancla de la ventana de traza. */
  let inicioSesion: Date;
  /** `ts` de los 2 fixes cargados, en orden. */
  let tsFixes: [Date, Date];

  const adminQuivo: AuthenticatedUser = {
    userId: 'test-admin-quivo',
    rol: 'admin_quivo',
    sindicatoId: null,
  };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };
  const adminSindicatoB: AuthenticatedUser = {
    userId: 'test-admin-b',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoBId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'EnVivo Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'EnVivo Test B', estado: 'activo' },
      });

      const linea = await tx.linea.create({
        data: {
          sindicatoId: sindicatoAId,
          codigo: 'EV1',
          nombre: 'Línea En Vivo',
          color: '#FD9E15',
        },
      });
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      puntoControlId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${puntoControlId}, ${rutaId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;
      // Punto de control dado de baja (soft-delete): NO debe aparecer en el contexto.
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${rutaId}, 1, ST_SetSRID(ST_GeomFromGeoJSON(${PC_INACTIVO_COORD}), 4326)::geography, 30, true, 'inactivo', now(), now())
      `;

      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'EVD001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Conductor En Vivo',
          documentoIdentidad: `EVD-${randomUUID()}`,
          licenciaConducir: 'LIC-EV',
        },
      });
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId: sindicatoAId, periodo: '2026-08', estado: 'publicada' },
      });
      const ahora = AHORA;
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha: ahora,
          horario: 'manana',
          orden: 1,
          venceAt: new Date(ahora.getTime() + 60 * MINUTO),
          estado: 'vigente',
        },
      });

      const credenciales = () => ({
        accessTokenHash: randomUUID(),
        refreshTokenHash: randomUUID(),
        accessExpiresAt: new Date(ahora.getTime() + 60 * MINUTO),
        refreshExpiresAt: new Date(ahora.getTime() + 60 * MINUTO),
      });

      // La sesión arranca 30 min atrás para que la ventana `[inicio - 60s, ...)` tenga
      // margen a ambos lados y el clamp de `desde` se pueda observar.
      inicioSesion = new Date(ahora.getTime() - 30 * MINUTO);
      const conPuntos = await tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoAId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-en-vivo-1',
          inicio: inicioSesion,
          estado: 'activa',
          ...credenciales(),
        },
      });
      sesionConPuntosId = conPuntos.id;

      const sinPuntos = await tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoAId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-en-vivo-2',
          inicio: new Date(ahora.getTime() - 10 * MINUTO),
          estado: 'activa',
          ...credenciales(),
        },
      });
      sesionSinPuntosId = sinPuntos.id;

      // Una sola llamada: con el reloj anclado al mediodía UTC, todos los fixes del test
      // (incluido el previo al inicio de la sesión) caen en la partición de hoy.
      await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE)`;

      tsFixes = [new Date(ahora.getTime() - 20 * MINUTO), new Date(ahora.getTime() - 5 * MINUTO)];
      await tx.$executeRaw`
        INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
        VALUES
          (${randomUUID()}::uuid, ${sesionConPuntosId}::uuid, 'device-en-vivo-1', ${tsFixes[0]}::timestamptz, -34.6, -58.4, 5, 8.3, ${tsFixes[0]}::timestamptz, ${sindicatoAId}),
          (${randomUUID()}::uuid, ${sesionConPuntosId}::uuid, 'device-en-vivo-1', ${tsFixes[1]}::timestamptz, -34.599, -58.399, 5, 9.1, ${tsFixes[1]}::timestamptz, ${sindicatoAId})
      `;

      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId: sindicatoAId,
          sesionId: sesionConPuntosId,
          puntoControlId,
          ts: tsFixes[1],
          distanciaM: 10,
          cumplido: true,
          validadoPor: 'worker',
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id = ${sesionConPuntosId}::uuid`;
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" = ${rutaId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sindicato.deleteMany({ where: { id: { in: [sindicatoAId, sindicatoBId] } } });
    });
    await prisma.$disconnect();
  });

  describe('derivarFrescura (los tres estados que pidió la jornada del 2026-08-18)', () => {
    const ahora = new Date('2026-08-18T18:00:00.000Z');
    const inicio = new Date('2026-08-18T12:00:00.000Z');

    it('fix e ingesta recientes ⇒ "reportando"', () => {
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() - 20_000),
        new Date(ahora.getTime() - 3_000),
      );
      expect(f.estadoFrescura).toBe('reportando');
      expect(f.antiguedadFixMs).toBe(20_000);
      expect(f.antiguedadIngestaMs).toBe(3_000);
      expect(f.inactivaDesdeMs).toBe(3_000);
    });

    it('fix viejo pero ingesta fresca ⇒ "detenido" (vehículo parado, teléfono vivo)', () => {
      // Hueco de 40 min con el vehículo detenido en terminal: medido en producción, llegó
      // a 56 min. No es una falla y no debe reportarse como pérdida de señal.
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() - 40 * MINUTO),
        new Date(ahora.getTime() - 60_000),
      );
      expect(f.estadoFrescura).toBe('detenido');
      expect(f.antiguedadFixMs).toBe(40 * MINUTO);
      expect(f.inactivaDesdeMs).toBe(60_000);
    });

    it('un lag de ingesta dentro del p95 medido (814 s) sigue siendo "reportando"', () => {
      const lag = 814_000;
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() - lag),
        new Date(ahora.getTime() - lag),
      );
      expect(f.estadoFrescura).toBe('reportando');
    });

    it('ni fixes ni ingesta ⇒ "perdido"', () => {
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() - 90 * MINUTO),
        new Date(ahora.getTime() - 90 * MINUTO),
      );
      expect(f.estadoFrescura).toBe('perdido');
    });

    it('sin ningún punto ⇒ "sin_datos" y la inactividad se mide desde `inicio`', () => {
      const f = derivarFrescura(ahora, inicio, null, null);
      expect(f.estadoFrescura).toBe('sin_datos');
      expect(f.ultimoFixTs).toBeNull();
      expect(f.ultimoIngresoTs).toBeNull();
      expect(f.antiguedadFixMs).toBeNull();
      expect(f.inactivaDesdeMs).toBe(6 * 60 * MINUTO);
    });

    it('clampea a 0 el skew de reloj entre Postgres y Node', () => {
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() + 500),
        new Date(ahora.getTime() + 500),
      );
      expect(f.antiguedadFixMs).toBe(0);
      expect(f.antiguedadIngestaMs).toBe(0);
    });
  });

  describe('listarHoy', () => {
    it('devuelve las sesiones con agregados de fix e ingesta', async () => {
      const filas = await service.listarHoy(adminQuivo, AHORA);
      const fila = filas.find((f) => f.id === sesionConPuntosId);

      expect(fila).toBeDefined();
      expect(fila?.deviceId).toBe('device-en-vivo-1');
      expect(fila?.activa).toBe(true);
      expect(fila?.vehiculoPlaca).toBe('EVD001');
      expect(fila?.conductorNombre).toBe('Conductor En Vivo');
      expect(fila?.lineaNombre).toBe('Línea En Vivo');
      expect(fila?.totalPuntos).toBe(2);
      expect(fila?.ultimoFixTs).toBe(tsFixes[1].toISOString());
      expect(fila?.ultimoIngresoTs).toBe(tsFixes[1].toISOString());
      expect(fila?.servidorTs).toBeTruthy();
      expect(fila?.estadoFrescura).toBe('reportando');
    });

    it('incluye una sesión activa sin ningún punto ("esperando el primer fix")', async () => {
      const filas = await service.listarHoy(adminQuivo, AHORA);
      const fila = filas.find((f) => f.id === sesionSinPuntosId);

      expect(fila).toBeDefined();
      expect(fila?.totalPuntos).toBe(0);
      expect(fila?.ultimoFixTs).toBeNull();
      expect(fila?.ultimoIngresoTs).toBeNull();
      expect(fila?.estadoFrescura).toBe('sin_datos');
      // Sin `fin` no hay corte posible por `fin`: el cliente corta con esto, medido
      // desde `inicio` cuando la sesión nunca recibió un punto.
      expect(fila?.inactivaDesdeMs).toBe(10 * MINUTO);
    });

    it('incluye una sesión colgada de un día anterior (fin NULL + estado activa)', async () => {
      // Reproduce el defecto real: "Finalizar recorrido" no cierra la sesión, así que
      // `fin` queda NULL para siempre y la rama por día calendario no la alcanzaría.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.sesionOperativa.update({
          where: { id: sesionSinPuntosId },
          data: { inicio: new Date('2026-07-01T14:00:00.000Z') },
        }),
      );

      const filas = await service.listarHoy(adminQuivo, AHORA);
      expect(filas.some((f) => f.id === sesionSinPuntosId)).toBe(true);

      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.sesionOperativa.update({
          where: { id: sesionSinPuntosId },
          data: { inicio: new Date(AHORA.getTime() - 10 * MINUTO) },
        }),
      );
    });

    it('admin_sindicato de otro tenant no ve las sesiones (RLS)', async () => {
      const filas = await service.listarHoy(adminSindicatoB, AHORA);
      expect(filas.some((f) => f.id === sesionConPuntosId)).toBe(false);
    });
  });

  describe('obtenerContexto', () => {
    it('devuelve ruta, línea y solo los puntos de control activos', async () => {
      const ctx = await service.obtenerContexto(adminSindicatoA, sesionConPuntosId, AHORA);

      expect(ctx.sesion.id).toBe(sesionConPuntosId);
      expect(ctx.ruta.geometria.type).toBe('LineString');
      expect(ctx.linea.nombre).toBe('Línea En Vivo');
      expect(ctx.puntosControl).toHaveLength(1);
      expect(ctx.puntosControl[0]?.id).toBe(puntoControlId);
      expect(ctx.servidorTs).toBeTruthy();
    });

    it('admin_sindicato de otro tenant recibe 404 (RLS, no 403)', async () => {
      await expect(
        service.obtenerContexto(adminSindicatoB, sesionConPuntosId, AHORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una sesión inexistente devuelve 404', async () => {
      await expect(service.obtenerContexto(adminQuivo, randomUUID(), AHORA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('obtenerTraza', () => {
    it('devuelve la traza completa, el cursor y los cumplimientos', async () => {
      const traza = await service.obtenerTraza(
        adminQuivo,
        sesionConPuntosId,
        { limite: 100 },
        AHORA,
      );

      expect(traza.puntos).toHaveLength(2);
      expect(traza.puntos[0]?.ts).toBe(tsFixes[0].toISOString());
      expect(traza.cursor).toBe(tsFixes[1].toISOString());
      expect(traza.hayMas).toBe(false);
      expect(traza.totalPuntos).toBe(2);
      expect(traza.cumplimientos).toHaveLength(1);
      expect(traza.cumplimientos[0]?.validadoPor).toBe('worker');
      expect(traza.sesionFin).toBeNull();
      expect(traza.sesionEstado).toBe('activa');
      expect(traza.ultimoFixTs).toBe(tsFixes[1].toISOString());
      expect(traza.ultimoIngresoTs).toBe(tsFixes[1].toISOString());
      expect(traza.estadoFrescura).toBe('reportando');
    });

    it('una sesión sin puntos devuelve traza vacía sin romper (cursor null)', async () => {
      const traza = await service.obtenerTraza(
        adminQuivo,
        sesionSinPuntosId,
        { limite: 100 },
        AHORA,
      );

      expect(traza.puntos).toEqual([]);
      expect(traza.cursor).toBeNull();
      expect(traza.hayMas).toBe(false);
      expect(traza.totalPuntos).toBe(0);
      expect(traza.estadoFrescura).toBe('sin_datos');
    });

    it('`desde` recorta el delta y `hayMas` avisa cuando falta traer más', async () => {
      const delta = await service.obtenerTraza(
        adminQuivo,
        sesionConPuntosId,
        {
          desde: new Date(tsFixes[0].getTime() + 1),
          limite: 100,
        },
        AHORA,
      );
      expect(delta.puntos).toHaveLength(1);
      expect(delta.puntos[0]?.ts).toBe(tsFixes[1].toISOString());
      // `totalPuntos` es de la ventana completa, no del delta: es el denominador del
      // auto-heal del cliente.
      expect(delta.totalPuntos).toBe(2);

      const truncado = await service.obtenerTraza(
        adminQuivo,
        sesionConPuntosId,
        { limite: 1 },
        AHORA,
      );
      expect(truncado.puntos).toHaveLength(1);
      expect(truncado.hayMas).toBe(true);
      expect(truncado.cursor).toBe(tsFixes[0].toISOString());
    });

    it('clampea un `desde` anterior al piso de la sesión (el cursor solo puede recortar)', async () => {
      const traza = await service.obtenerTraza(
        adminQuivo,
        sesionConPuntosId,
        {
          desde: new Date('2020-01-01T00:00:00.000Z'),
          limite: 100,
        },
        AHORA,
      );
      // Si el clamp no existiera, la query barrería particiones fuera de la sesión; con
      // el clamp devuelve exactamente lo mismo que sin `desde`.
      expect(traza.puntos).toHaveLength(2);
      expect(traza.totalPuntos).toBe(2);
    });

    it('clampea un `desde` posterior al techo sin devolver basura', async () => {
      const traza = await service.obtenerTraza(
        adminQuivo,
        sesionConPuntosId,
        {
          desde: new Date('2099-01-01T00:00:00.000Z'),
          limite: 100,
        },
        AHORA,
      );
      expect(traza.puntos).toEqual([]);
      expect(traza.cursor).toBeNull();
      // Los agregados siguen siendo los de la ventana completa.
      expect(traza.totalPuntos).toBe(2);
    });

    it('la ventana está anclada a `sesion.inicio`, no al día calendario', async () => {
      // Un fix 10 min ANTES del inicio de la sesión queda fuera del piso
      // (`inicio - 60 s`) aunque sea del mismo día.
      const tsPrevio = new Date(inicioSesion.getTime() - 10 * MINUTO);
      const eventIdPrevio = randomUUID();
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
          VALUES (${eventIdPrevio}::uuid, ${sesionConPuntosId}::uuid, 'device-en-vivo-1', ${tsPrevio}::timestamptz, -34.61, -58.41, 5, 0, ${tsPrevio}::timestamptz, ${sindicatoAId})
        `;
      });

      try {
        const traza = await service.obtenerTraza(
          adminQuivo,
          sesionConPuntosId,
          { limite: 100 },
          AHORA,
        );
        expect(traza.puntos).toHaveLength(2);
        expect(traza.totalPuntos).toBe(2);
        expect(traza.puntos.some((p) => p.ts === tsPrevio.toISOString())).toBe(false);
      } finally {
        await withTenantContext(
          { rol: 'admin_quivo', sindicatoId: null },
          (tx) => tx.$executeRaw`DELETE FROM gps_points WHERE event_id = ${eventIdPrevio}::uuid`,
        );
      }
    });

    it('admin_sindicato de otro tenant recibe 404 (RLS, no 403)', async () => {
      await expect(
        service.obtenerTraza(adminSindicatoB, sesionConPuntosId, { limite: 100 }, AHORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una sesión inexistente devuelve 404', async () => {
      await expect(
        service.obtenerTraza(adminQuivo, randomUUID(), { limite: 100 }, AHORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
