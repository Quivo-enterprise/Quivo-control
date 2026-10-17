import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { EnVivoService, derivarFrescura } from './en-vivo.service.js';

/**
 * Este archivo sigue insertando `gps_points` con `$executeRaw` (no vía `insertarGpsPoints`,
 * ingesta-worker.service.ts) porque varias aserciones necesitan `received_at` DISTINTO de
 * `ts` y controlado a mano (`insertarGpsPoints` fija `received_at = now()`, no parametrizable
 * — ver ese SQL) para que `ultimoIngresoTs` sea determinista. Desde
 * docs/plan-en-vivo-resumen-sesion.md, `listarHoy`/`obtenerPosiciones` ya NO leen
 * `gps_points`: leen `gps_sesion_resumen`, que en producción solo lo escribe
 * `insertarGpsPoints`. Este helper recalcula esa tabla a mano, DESDE `gps_points`, para las
 * sesiones que le pasan — un recompute completo (no incremental) equivalente al backfill de
 * la migración `20260922100000_gps_sesion_resumen`, correcto acá porque cada sesión de este
 * archivo se siembra una sola vez (nunca dos rondas de inserts sobre la misma sesión que
 * necesiten la lógica incremental de `ON CONFLICT DO UPDATE` de `insertarGpsPoints`).
 */
async function recalcularResumen(
  tx: PrismaTypes.TransactionClient,
  sesionIds: string[],
): Promise<void> {
  // `((ts AT TIME ZONE 'UTC') - interval '4 hours')::date` y el `GROUP BY`/`DISTINCT ON`/
  // join por `"sindicatoId"` (en vez de solo `sesion_id, jornada`) replican bit a bit el
  // fix de code-review del worker/migración (docs/plan-en-vivo-resumen-sesion.md): la PK de
  // `gps_sesion_resumen` pasó a `(sesion_id, jornada, sindicatoId)`, así que el `ON
  // CONFLICT` de abajo tiene que apuntar a esas 3 columnas para no fallar con "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification".
  await tx.$executeRaw`
    WITH agregados AS (
      SELECT sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
             "sindicatoId",
             count(*)::int AS total_puntos, max(ts) AS ultimo_fix_ts, max(received_at) AS ultimo_ingreso_ts
      FROM gps_points
      WHERE sesion_id = ANY(${sesionIds}::uuid[])
      GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
    ),
    ultimo AS (
      SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
        sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
        "sindicatoId", lat, lng, accuracy, speed
      FROM gps_points
      WHERE sesion_id = ANY(${sesionIds}::uuid[])
      ORDER BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId", ts DESC
    )
    INSERT INTO gps_sesion_resumen
      (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
    SELECT a.sesion_id, a.jornada, a."sindicatoId", a.total_puntos, a.ultimo_fix_ts, a.ultimo_ingreso_ts,
           u.lat, u.lng, u.accuracy, u.speed, now()
    FROM agregados a
    JOIN ultimo u ON u.sesion_id = a.sesion_id AND u.jornada = a.jornada AND u."sindicatoId" = a."sindicatoId"
    ON CONFLICT (sesion_id, jornada, "sindicatoId") DO UPDATE SET
      total_puntos = EXCLUDED.total_puntos,
      ultimo_fix_ts = EXCLUDED.ultimo_fix_ts,
      ultimo_ingreso_ts = EXCLUDED.ultimo_ingreso_ts,
      lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy = EXCLUDED.accuracy, speed = EXCLUDED.speed,
      updated_at = now()
  `;
}

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
  let varianteTramoId: string;
  /** Sesión activa con 2 fixes. */
  let sesionConPuntosId: string;
  /** Sesión activa sin ningún fix — el caso "esperando el primer punto GPS". */
  let sesionSinPuntosId: string;
  /** `inicio` de `sesionConPuntosId`, ancla de la ventana de traza. */
  let inicioSesion: Date;
  /** `ts` de los 2 fixes cargados, en orden. */
  let tsFixes: [Date, Date];
  // ENTREGA 10 — segunda línea/ruta (sentido distinto) con su propia sesión, para
  // probar `obtenerPosiciones` con vehículos de 2 líneas distintas en una sola query.
  let linea1Id: string;
  let linea2Id: string;
  let ruta2Id: string;
  let sesionLinea2Id: string;
  let tsFixLinea2: Date;

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
      linea1Id = linea.id;
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      // Variantes: solo la activa CON geometría debe llegar al detalle (tramo para pegar la traza).
      varianteTramoId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO variantes (id, "rutaId", nombre, estado, geometria, "publicStatus", "createdAt", "updatedAt")
        VALUES (${varianteTramoId}, ${rutaId}, 'Tramo activo', 'activo', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'borrador', now(), now()),
               (${randomUUID()}, ${rutaId}, 'Sin geometría', 'activo', NULL, 'borrador', now(), now()),
               (${randomUUID()}, ${rutaId}, 'Inactiva', 'inactivo', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'borrador', now(), now())
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

      // ENTREGA 10 — segunda línea, con `sentido` distinto ('vuelta' vs 'ida'), su
      // propio vehículo/conductor y una sesión con 1 fix. Prueba que `obtenerPosiciones`
      // trae `lineaId`/`rutaSentido` correctos por fila cuando hay 2 líneas en la misma
      // query, no solo 1 como en el resto de este archivo.
      const linea2 = await tx.linea.create({
        data: {
          sindicatoId: sindicatoAId,
          codigo: 'EV2',
          nombre: 'Línea En Vivo 2',
          color: '#2E7D32',
        },
      });
      linea2Id = linea2.id;
      ruta2Id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${ruta2Id}, ${linea2Id}, 'vuelta', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      const vehiculo2 = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'EVD002',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      const conductor2 = await tx.conductor.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Conductor En Vivo 2',
          documentoIdentidad: `EVD2-${randomUUID()}`,
          licenciaConducir: 'LIC-EV2',
        },
      });
      const rotacion2 = await tx.rotacion.create({
        data: { sindicatoId: sindicatoAId, periodo: '2026-08', estado: 'publicada' },
      });
      const asignacion2 = await tx.asignacion.create({
        data: {
          rotacionId: rotacion2.id,
          vehiculoId: vehiculo2.id,
          conductorId: conductor2.id,
          rutaId: ruta2Id,
          fecha: ahora,
          horario: 'manana',
          orden: 1,
          venceAt: new Date(ahora.getTime() + 60 * MINUTO),
          estado: 'vigente',
        },
      });
      const sesionLinea2 = await tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoAId,
          asignacionId: asignacion2.id,
          vehiculoId: vehiculo2.id,
          conductorId: conductor2.id,
          deviceId: 'device-en-vivo-3',
          inicio: new Date(ahora.getTime() - 15 * MINUTO),
          estado: 'activa',
          ...credenciales(),
        },
      });
      sesionLinea2Id = sesionLinea2.id;
      tsFixLinea2 = new Date(ahora.getTime() - 2 * MINUTO);
      await tx.$executeRaw`
        INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
        VALUES (${randomUUID()}::uuid, ${sesionLinea2Id}::uuid, 'device-en-vivo-3', ${tsFixLinea2}::timestamptz, -34.601, -58.401, 4, 6.5, ${tsFixLinea2}::timestamptz, ${sindicatoAId})
      `;

      // `listarHoy`/`obtenerPosiciones` ya no leen `gps_points`: leen `gps_sesion_resumen`
      // (ver comentario de `recalcularResumen` arriba). Sin este paso, todas sus aserciones
      // de abajo verían `totalPuntos: 0`/`lat: null` para estas 2 sesiones.
      await recalcularResumen(tx, [sesionConPuntosId, sesionLinea2Id]);
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      // Antes de `gps_points` (o del `sindicato.deleteMany` de más abajo, que fallaría por
      // la FK `gps_sesion_resumen_sindicatoid_fkey` si esto quedara pendiente).
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id IN (${sesionConPuntosId}::uuid, ${sesionLinea2Id}::uuid)`;
      await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id IN (${sesionConPuntosId}::uuid, ${sesionLinea2Id}::uuid)`;
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.asignacion.deleteMany({ where: { rutaId: { in: [rutaId, ruta2Id] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" = ${rutaId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${ruta2Id})`;
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

  /**
   * Fase A (docs/plan-ubicacion-fluida.md) — `recorridoEstado`/`recorridoEstadoTs` pesan MÁS
   * que la heurística de fix/ingesta de arriba. `ahora`/`inicio` son los mismos del describe
   * de arriba (mediodía y mediodía-6h del 2026-08-18 UTC).
   */
  describe('derivarFrescura — Fase A: estado "finalizado" derivado del recorrido', () => {
    const ahora = new Date('2026-08-18T18:00:00.000Z');
    const inicio = new Date('2026-08-18T12:00:00.000Z');

    it('recorrido finalizado sin fix posterior ⇒ "finalizado", con recorridoFinTs', () => {
      const finTs = new Date(ahora.getTime() - 10 * MINUTO);
      const f = derivarFrescura(ahora, inicio, null, null, 'finalizado', finTs);
      expect(f.estadoFrescura).toBe('finalizado');
      expect(f.recorridoFinTs).toBe(finTs.toISOString());
    });

    it('recorrido finalizado con el último fix ANTES del fin (dentro de la tolerancia) ⇒ "finalizado"', () => {
      const finTs = new Date(ahora.getTime() - 10 * MINUTO);
      // El último fix llegó unos segundos antes del toque de "Finalizar" — normal.
      const ultimoFixTs = new Date(finTs.getTime() - 2_000);
      const f = derivarFrescura(ahora, inicio, ultimoFixTs, ultimoFixTs, 'finalizado', finTs);
      expect(f.estadoFrescura).toBe('finalizado');
    });

    it('re-inicio (recorridoEstado "en_curso") ⇒ vuelve a la clasificación normal', () => {
      // `inicio_recorrido` posterior — el worker ya dejó `recorridoEstado: 'en_curso'` (guard
      // por ts), así que acá ni siquiera importa cuán vieja sea `recorridoEstadoTs`.
      const inicioRecorridoTs = new Date(ahora.getTime() - 5 * MINUTO);
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() - 20_000),
        new Date(ahora.getTime() - 3_000),
        'en_curso',
        inicioRecorridoTs,
      );
      expect(f.estadoFrescura).toBe('reportando');
      expect(f.recorridoFinTs).toBeNull();
    });

    it('fix POSTERIOR al fin, más allá de la tolerancia ⇒ defensivo, clasificación normal (no "finalizado")', () => {
      const finTs = new Date(ahora.getTime() - 10 * MINUTO);
      // Algo sigue grabando después del "Finalizar" — 30 s después del fin, muy por encima
      // de la tolerancia de 5 s.
      const ultimoFixTs = new Date(finTs.getTime() + 30_000);
      const f = derivarFrescura(ahora, inicio, ultimoFixTs, ultimoFixTs, 'finalizado', finTs);
      expect(f.estadoFrescura).not.toBe('finalizado');
      expect(f.recorridoFinTs).toBeNull();
    });

    it('sesión sin inicio_recorrido/fin_recorrido (recorridoEstado null) ⇒ clasificación normal', () => {
      const f = derivarFrescura(
        ahora,
        inicio,
        new Date(ahora.getTime() - 20_000),
        new Date(ahora.getTime() - 3_000),
        null,
        null,
      );
      expect(f.estadoFrescura).toBe('reportando');
      expect(f.recorridoFinTs).toBeNull();
    });

    it('tolerancia de 5 s: un fix exactamente en el borde sigue siendo "finalizado"', () => {
      const finTs = new Date(ahora.getTime() - 10 * MINUTO);
      const fixEnElBorde = new Date(finTs.getTime() + 5_000);
      const f = derivarFrescura(ahora, inicio, fixEnElBorde, fixEnElBorde, 'finalizado', finTs);
      expect(f.estadoFrescura).toBe('finalizado');
    });

    it('tolerancia de 5 s: un fix 1 ms después del borde ya NO es "finalizado"', () => {
      const finTs = new Date(ahora.getTime() - 10 * MINUTO);
      const fixFueraDeBorde = new Date(finTs.getTime() + 5_001);
      const f = derivarFrescura(
        ahora,
        inicio,
        fixFueraDeBorde,
        fixFueraDeBorde,
        'finalizado',
        finTs,
      );
      expect(f.estadoFrescura).not.toBe('finalizado');
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
      expect(ctx.variantes.map((v) => v.id)).toEqual([varianteTramoId]);
      expect(ctx.variantes[0]?.geometria.type).toBe('LineString');
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

  describe('obtenerPosiciones (ENTREGA 10 — una sola query para todos los vehículos)', () => {
    it('devuelve las 3 sesiones de 2 líneas distintas con lineaId, sentido y última posición', async () => {
      const filas = await service.obtenerPosiciones(adminQuivo, AHORA);

      const conPuntos = filas.find((f) => f.id === sesionConPuntosId);
      expect(conPuntos).toBeDefined();
      expect(conPuntos?.lineaId).toBe(linea1Id);
      expect(conPuntos?.lineaNombre).toBe('Línea En Vivo');
      expect(conPuntos?.rutaSentido).toBe('ida');
      // Última posición == el fix MÁS RECIENTE (tsFixes[1]), no un promedio ni el primero.
      expect(conPuntos?.lat).toBe(-34.599);
      expect(conPuntos?.lng).toBe(-58.399);
      expect(conPuntos?.speed).toBe(9.1);
      expect(conPuntos?.ultimoFixTs).toBe(tsFixes[1].toISOString());
      expect(conPuntos?.totalPuntos).toBe(2);
      expect(conPuntos?.estadoFrescura).toBe('reportando');
      expect(conPuntos?.activa).toBe(true);

      const sinPuntos = filas.find((f) => f.id === sesionSinPuntosId);
      expect(sinPuntos).toBeDefined();
      expect(sinPuntos?.lat).toBeNull();
      expect(sinPuntos?.lng).toBeNull();
      expect(sinPuntos?.estadoFrescura).toBe('sin_datos');

      const linea2 = filas.find((f) => f.id === sesionLinea2Id);
      expect(linea2).toBeDefined();
      expect(linea2?.lineaId).toBe(linea2Id);
      expect(linea2?.lineaNombre).toBe('Línea En Vivo 2');
      expect(linea2?.rutaSentido).toBe('vuelta');
      expect(linea2?.vehiculoPlaca).toBe('EVD002');
      expect(linea2?.lat).toBe(-34.601);
      expect(linea2?.lng).toBe(-58.401);
      expect(linea2?.ultimoFixTs).toBe(tsFixLinea2.toISOString());
    });

    it('una sesión colgada de días previos (fin NULL + estado activa) sigue apareciendo', async () => {
      // Reproduce el mismo defecto que cubre `listarHoy`: "Finalizar recorrido" no
      // cierra la sesión, así que una sesión de hace varios días con `fin` NULL debe
      // seguir viéndose (para no esconder un teléfono zombi que el admin necesita cerrar
      // a mano) aunque quede fuera de la ventana rodante de 24 h por `so.inicio`.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.sesionOperativa.update({
          where: { id: sesionSinPuntosId },
          data: { inicio: new Date('2026-07-01T14:00:00.000Z') },
        }),
      );

      try {
        const filas = await service.obtenerPosiciones(adminQuivo, AHORA);
        expect(filas.some((f) => f.id === sesionSinPuntosId)).toBe(true);
      } finally {
        await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
          tx.sesionOperativa.update({
            where: { id: sesionSinPuntosId },
            data: { inicio: new Date(AHORA.getTime() - 10 * MINUTO) },
          }),
        );
      }
    });

    it('admin_sindicato de otro tenant no ve las sesiones de este sindicato (RLS)', async () => {
      const filas = await service.obtenerPosiciones(adminSindicatoB, AHORA);
      expect(filas.some((f) => f.id === sesionConPuntosId)).toBe(false);
      expect(filas.some((f) => f.id === sesionLinea2Id)).toBe(false);
      expect(filas).toHaveLength(0);
    });

    it('admin_sindicato del sindicato dueño sí ve sus propias sesiones', async () => {
      const filas = await service.obtenerPosiciones(adminSindicatoA, AHORA);
      expect(filas.some((f) => f.id === sesionConPuntosId)).toBe(true);
      expect(filas.some((f) => f.id === sesionLinea2Id)).toBe(true);
    });
  });

  /**
   * Hallazgo 2 del code-review (producción, ~00:40 Bolivia): el `LEFT JOIN LATERAL` a
   * `gps_points` de `obtenerPosiciones` estaba acotado a `trazaDesde` (medianoche boliviana
   * de la jornada CALENDARIO), no a `posicionesDesde` (piso rodante, ver el docblock del
   * método). Un vehículo que arrancó a las 22:00 de ayer y sigue reportando, consultado a
   * las 00:30, entraba por el `WHERE` (ventana rodante de 24 h sobre `so.inicio`) pero sus
   * fixes de ANTES de medianoche quedaban fuera del `LATERAL` — si todavía no había un fix
   * posterior a medianoche, la posición salía `lat`/`lng` `NULL` y `estadoFrescura`
   * `sin_datos`: el vehículo desaparecía del mapa. Este describe reproduce exactamente ese
   * escenario contra la base real, con `ahora` inyectado a las 00:30 Bolivia.
   */
  describe('obtenerPosiciones — cruce de medianoche boliviana (hallazgo 2 code-review)', () => {
    const HORA = 60 * MINUTO;

    // `ahora` fijo a las 00:30 Bolivia (04:00 = medianoche Bolivia UTC) de "hoy", anclado a
    // la fecha UTC real del día en que corre el test — mismo criterio que `AHORA` arriba —
    // para que la partición de HOY (creada en el `beforeAll` de arriba) y la de AYER
    // (creada acá) sean las que de verdad existen en la base.
    const AHORA_MEDIANOCHE = (() => {
      const hoy = new Date();
      return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 4, 30));
    })();

    // Sesión que arranca 22:00 Bolivia de AYER (= 02:00 UTC de HOY) con un fix ANTES de
    // medianoche boliviana (23:00 Bolivia ayer = 03:00 UTC hoy) y otro DESPUÉS (00:20
    // Bolivia hoy = 04:20 UTC hoy). Ambos `ts` caen en la partición UTC de HOY (ya
    // asegurada por el `beforeAll` de arriba): no hace falta partición nueva para este caso
    // — el bug es sobre la medianoche BOLIVIANA (04:00 UTC), no sobre el borde de partición
    // (00:00 UTC).
    let sesionCruceId: string;
    const inicioCruce = new Date(AHORA_MEDIANOCHE.getTime() - 150 * MINUTO); // hoy 02:00 UTC
    const fixAntesMedianoche = new Date(AHORA_MEDIANOCHE.getTime() - 90 * MINUTO); // hoy 03:00 UTC
    const fixDespuesMedianoche = new Date(AHORA_MEDIANOCHE.getTime() - 10 * MINUTO); // hoy 04:20 UTC

    // Sesión cuyo ÚNICO fix es de AYER a la noche (19:30 Bolivia = 23:30 UTC ayer): antes
    // de la medianoche boliviana Y antes de la medianoche UTC, así que cae en la partición
    // `gps_points_<AYER>` — esta sí hace falta crearla explícito, es el caso que pide el
    // encargo ("si la tabla de test necesita la partición del día anterior, crearla").
    let sesionSoloAntesId: string;
    const inicioSoloAntes = new Date(AHORA_MEDIANOCHE.getTime() - 330 * MINUTO); // ayer 23:00 UTC
    const fixSoloAntes = new Date(AHORA_MEDIANOCHE.getTime() - 300 * MINUTO); // ayer 23:30 UTC

    /**
     * code-review LOW (docs/plan-en-vivo-resumen-sesion.md) — "un dispositivo activo parece
     * perdido justo después de medianoche": el fix de HOY (`fixHoyIngresoViejo`) se recibió
     * PUNTUAL (received_at = su propio ts) pero hace 20 min — su propia fila de resumen
     * queda con `ultimo_ingreso_ts` viejo (>15 min, el umbral de ingesta viva). El fix de
     * AYER (`fixAyerIngresoTardio`) es un punto VIEJO (antes de medianoche boliviana) que
     * llegó tarde por el outbox: su `ts` cae en la jornada de AYER, pero su `received_at` es
     * de HACE 1 MINUTO — el dispositivo está sincronizando ahora mismo. Antes del fix,
     * `ultimoIngresoTs` salía solo de la fila que gana el `ORDER BY ultimo_fix_ts DESC`
     * (HOY, por tener el fix más nuevo) — nunca veía el ingreso reciente de AYER, y el
     * vehículo se clasificaba `perdido` (antigüedad de ingesta 20 min) estando activo.
     */
    let sesionIngresoTardioId: string;
    const inicioIngresoTardio = new Date(AHORA_MEDIANOCHE.getTime() - 150 * MINUTO); // hoy 02:00 UTC
    const fixHoyIngresoViejo = new Date(AHORA_MEDIANOCHE.getTime() - 20 * MINUTO); // hoy 04:10 UTC — jornada HOY
    const fixAyerIngresoTardio = new Date(AHORA_MEDIANOCHE.getTime() - 100 * MINUTO); // hoy 02:50 UTC — jornada AYER
    const ingresoTardioReciente = new Date(AHORA_MEDIANOCHE.getTime() - 1 * MINUTO); // "recién ahora"

    beforeAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        // Partición de AYER: la de HOY ya la aseguró el `beforeAll` de arriba, pero esa
        // corrida no cubre el día anterior — `crear_particion_gps_points` es idempotente
        // (ver `20260817130000_particion_gps_points_idempotente`), así que es seguro
        // llamarla aunque otro test la haya creado ya.
        await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE - 1)`;

        // Reusa vehículo/conductor/asignación de `sesionConPuntosId` (misma línea/ruta que
        // el resto del archivo): lo único que importa para este caso es la ventana
        // temporal de `gps_points`, no una línea/ruta distinta.
        const base = await tx.sesionOperativa.findUniqueOrThrow({
          where: { id: sesionConPuntosId },
        });

        const credenciales = () => ({
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(AHORA_MEDIANOCHE.getTime() + HORA),
          refreshExpiresAt: new Date(AHORA_MEDIANOCHE.getTime() + HORA),
        });

        const cruce = await tx.sesionOperativa.create({
          data: {
            sindicatoId: sindicatoAId,
            asignacionId: base.asignacionId,
            vehiculoId: base.vehiculoId,
            conductorId: base.conductorId,
            deviceId: 'device-en-vivo-medianoche-cruce',
            inicio: inicioCruce,
            estado: 'activa',
            ...credenciales(),
          },
        });
        sesionCruceId = cruce.id;

        const soloAntes = await tx.sesionOperativa.create({
          data: {
            sindicatoId: sindicatoAId,
            asignacionId: base.asignacionId,
            vehiculoId: base.vehiculoId,
            conductorId: base.conductorId,
            deviceId: 'device-en-vivo-medianoche-solo-antes',
            inicio: inicioSoloAntes,
            estado: 'activa',
            ...credenciales(),
          },
        });
        sesionSoloAntesId = soloAntes.id;

        const ingresoTardio = await tx.sesionOperativa.create({
          data: {
            sindicatoId: sindicatoAId,
            asignacionId: base.asignacionId,
            vehiculoId: base.vehiculoId,
            conductorId: base.conductorId,
            deviceId: 'device-en-vivo-medianoche-ingreso-tardio',
            inicio: inicioIngresoTardio,
            estado: 'activa',
            ...credenciales(),
          },
        });
        sesionIngresoTardioId = ingresoTardio.id;

        await tx.$executeRaw`
          INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
          VALUES
            (${randomUUID()}::uuid, ${sesionCruceId}::uuid, 'device-en-vivo-medianoche-cruce', ${fixAntesMedianoche}::timestamptz, -34.61, -58.41, 5, 7.2, ${fixAntesMedianoche}::timestamptz, ${sindicatoAId}),
            (${randomUUID()}::uuid, ${sesionCruceId}::uuid, 'device-en-vivo-medianoche-cruce', ${fixDespuesMedianoche}::timestamptz, -34.612, -58.412, 5, 7.5, ${fixDespuesMedianoche}::timestamptz, ${sindicatoAId}),
            (${randomUUID()}::uuid, ${sesionSoloAntesId}::uuid, 'device-en-vivo-medianoche-solo-antes', ${fixSoloAntes}::timestamptz, -34.62, -58.42, 5, 0, ${fixSoloAntes}::timestamptz, ${sindicatoAId}),
            (${randomUUID()}::uuid, ${sesionIngresoTardioId}::uuid, 'device-en-vivo-medianoche-ingreso-tardio', ${fixHoyIngresoViejo}::timestamptz, -34.63, -58.43, 5, 0, ${fixHoyIngresoViejo}::timestamptz, ${sindicatoAId}),
            (${randomUUID()}::uuid, ${sesionIngresoTardioId}::uuid, 'device-en-vivo-medianoche-ingreso-tardio', ${fixAyerIngresoTardio}::timestamptz, -34.64, -58.44, 5, 0, ${ingresoTardioReciente}::timestamptz, ${sindicatoAId})
        `;

        // `fixAntesMedianoche` y `fixDespuesMedianoche` caen en jornadas bolivianas
        // DISTINTAS (ver comentarios de arriba) — `recalcularResumen` los agrupa en 2 filas
        // de `gps_sesion_resumen` para `sesionCruceId` (una por jornada), tal cual haría
        // `insertarGpsPoints` en producción con un lote que cruza medianoche. Mismo criterio
        // para `sesionIngresoTardioId`: 2 filas (HOY con `ultimo_ingreso_ts` viejo, AYER con
        // `ultimo_ingreso_ts` recién llegado).
        await recalcularResumen(tx, [sesionCruceId, sesionSoloAntesId, sesionIngresoTardioId]);
      });
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id IN (${sesionCruceId}::uuid, ${sesionSoloAntesId}::uuid, ${sesionIngresoTardioId}::uuid)`;
        await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id IN (${sesionCruceId}::uuid, ${sesionSoloAntesId}::uuid, ${sesionIngresoTardioId}::uuid)`;
        await tx.sesionOperativa.deleteMany({
          where: { id: { in: [sesionCruceId, sesionSoloAntesId, sesionIngresoTardioId] } },
        });
      });
    });

    it('sesión que arranca 22:00 Bolivia de ayer, con fixes a ambos lados de medianoche: devuelve el fix MÁS RECIENTE y "reportando", no "sin_datos"', async () => {
      const filas = await service.obtenerPosiciones(adminQuivo, AHORA_MEDIANOCHE);
      const fila = filas.find((f) => f.id === sesionCruceId);

      expect(fila).toBeDefined();
      expect(fila?.lat).toBe(-34.612);
      expect(fila?.lng).toBe(-58.412);
      expect(fila?.ultimoFixTs).toBe(fixDespuesMedianoche.toISOString());
      // Cambio de semántica documentado (docs/plan-en-vivo-resumen-sesion.md §3):
      // `totalPuntos` ya NO es "puntos en la ventana rodante de 24 h" (sumaría los 2 fixes,
      // uno por jornada) — es "puntos de la jornada boliviana DEL ÚLTIMO FIX", tomados
      // directamente de la fila de `gps_sesion_resumen` que gana el `ORDER BY ultimo_fix_ts
      // DESC LIMIT 1`. El fix más reciente es de HOY, y hoy esta sesión tiene 1 solo punto
      // (el de ANTES de medianoche quedó en la fila de AYER) — por eso 1, no 2. Lo que el
      // fix original (pre-resumen) garantizaba, y sigue garantizando, es que la POSICIÓN
      // (lat/lng/ultimoFixTs, aserciones de arriba) no se pierda por el cruce de medianoche.
      expect(fila?.totalPuntos).toBe(1);
      expect(fila?.estadoFrescura).toBe('reportando');
      expect(fila?.activa).toBe(true);
    });

    it('sesión cuyo único fix es ANTERIOR a medianoche Bolivia (ninguno después): igual devuelve esa posición, no "sin_datos"', async () => {
      const filas = await service.obtenerPosiciones(adminQuivo, AHORA_MEDIANOCHE);
      const fila = filas.find((f) => f.id === sesionSoloAntesId);

      expect(fila).toBeDefined();
      // Reproducción directa del bug: antes del fix, el `LATERAL` acotado a `trazaDesde`
      // (medianoche boliviana de HOY) no veía este fix (de ayer a la noche) y devolvía
      // `lat`/`lng` `NULL` + `estadoFrescura: 'sin_datos'` — el vehículo desaparecía del
      // mapa pese a tener una posición última conocida.
      expect(fila?.lat).toBe(-34.62);
      expect(fila?.lng).toBe(-58.42);
      expect(fila?.ultimoFixTs).toBe(fixSoloAntes.toISOString());
      expect(fila?.totalPuntos).toBe(1);
      // El fix tiene 5 h de antigüedad: la ingesta ya no está viva, así que la clasificación
      // correcta es "perdido" (dato viejo), NO "reportando" — lo que importa acá es que
      // haya DATO (no sea `sin_datos`), no que parezca recién reportado.
      expect(fila?.estadoFrescura).toBe('perdido');
    });

    it('code-review LOW — ultimoIngresoTs es el MAX entre la fila de HOY y la de AYER, no solo la del fix ganador', async () => {
      const filas = await service.obtenerPosiciones(adminQuivo, AHORA_MEDIANOCHE);
      const fila = filas.find((f) => f.id === sesionIngresoTardioId);

      expect(fila).toBeDefined();
      // La POSICIÓN sigue viniendo del fix más reciente (HOY, `fixHoyIngresoViejo`) — eso no
      // cambia con este fix.
      expect(fila?.lat).toBe(-34.63);
      expect(fila?.lng).toBe(-58.43);
      expect(fila?.ultimoFixTs).toBe(fixHoyIngresoViejo.toISOString());
      // `ultimoIngresoTs`, en cambio, tiene que ser el de AYER (`ingresoTardioReciente`, hace
      // 1 min) — el MAX entre las 2 filas candidatas — NO el de la fila de HOY
      // (`fixHoyIngresoViejo`, hace 20 min), que es lo que devolvía el código viejo.
      expect(fila?.ultimoIngresoTs).toBe(ingresoTardioReciente.toISOString());
      expect(fila?.antiguedadIngestaMs).toBe(1 * MINUTO);
      // Antes del fix: `antiguedadIngestaMs` habría salido de `fixHoyIngresoViejo` (20 min,
      // > UMBRAL_INGESTA_VIVA_MS de 15 min) ⇒ ingesta "muerta" ⇒ `perdido`, aunque el
      // dispositivo estuviera sincronizando en ese mismo instante (el punto de AYER). Con el
      // fix, la ingesta está viva (1 min) pero el fix ganador tiene 20 min (> 15 min de
      // movimiento) ⇒ "detenido" (vehículo parado, teléfono vivo) — la clasificación
      // correcta, no "perdido".
      expect(fila?.estadoFrescura).toBe('detenido');
    });
  });
});
