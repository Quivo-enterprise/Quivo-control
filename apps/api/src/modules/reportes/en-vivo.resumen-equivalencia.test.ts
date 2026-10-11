import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import type { EventoSync } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertarGpsPoints } from '../ingesta-worker/ingesta-worker.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { fechaActualBolivia, inicioDeJornadaBolivia } from '../../common/tiempo/jornada.js';
import { EnVivoService } from './en-vivo.service.js';

/**
 * docs/plan-en-vivo-resumen-sesion.md §4.1 — "test de equivalencia (integración, Postgres
 * real del CI): sembrar sesiones con duplicados reenviados, puntos tardíos, sesión que
 * cruza la medianoche boliviana (03:59/04:00 UTC), sesión abierta de ayer; comparar salida
 * vieja vs nueva de ambos endpoints campo por campo".
 *
 * "Sesión abierta de ayer" y el cruce de medianoche boliviana YA tienen cobertura de
 * integración completa en `en-vivo.service.test.ts` (describe "obtenerPosiciones — cruce de
 * medianoche boliviana" y los tests "sesión colgada de un día anterior" de `listarHoy`/
 * `obtenerPosiciones") — ahí se corre el servicio NUEVO contra datos reales y se verifica
 * cada campo. Este archivo se enfoca en los otros dos escenarios (duplicados reenviados,
 * puntos tardíos) y agrega la comparación explícita "vieja vs nueva": la query VIEJA de
 * abajo es una copia literal del `LEFT JOIN LATERAL` sobre `gps_points` que tenían
 * `listarHoy`/`obtenerPosiciones` ANTES de esta rama (ver el diff de
 * apps/api/src/modules/reportes/en-vivo.service.ts) — se ejecuta contra los MISMOS datos que
 * el servicio nuevo (insertados con `insertarGpsPoints`, el camino real de producción, no
 * SQL crudo) para demostrar que ambas coinciden donde el plan garantiza equivalencia, y que
 * divergen exactamente donde el plan documenta el cambio de semántica (§3).
 */

const MINUTO = 60_000;

/**
 * Reloj determinista anclado al **mediodía UTC de hoy** (08:00 Bolivia), no a `new Date()`.
 * La jornada boliviana arranca a las 04:00 UTC: con `new Date()` un test corrido entre 04:00 y
 * 04:10 UTC ponía puntos "de hace 10 min" en la jornada ANTERIOR y `totalPuntos` salía 1 en
 * vez de 2 (flaky de CI del 2026-10-11 04:09 UTC). A las 12:00 UTC todos los `ts` (hasta
 * mediodía - 10 min) quedan en la misma jornada y en la partición UTC de hoy que ya asegura
 * el `beforeAll`. Mismo criterio que `AHORA` en `en-vivo.service.test.ts`.
 */
const AHORA = (() => {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 12));
})();

function evento(overrides: Partial<EventoSync> & { payload: EventoSync['payload'] }): EventoSync {
  return {
    eventId: randomUUID(),
    deviceId: 'device-equivalencia',
    ts: new Date(AHORA.getTime() - 5 * MINUTO).toISOString(),
    tipo: 'gps_point',
    ...overrides,
  };
}

/** Copia literal de la query vieja de `listarHoy` (pre-`gps_sesion_resumen`), acotada a UNA
 * sesión por simplicidad de la comparación. */
async function listarHoyViejo(
  tx: PrismaTypes.TransactionClient,
  sesionId: string,
  trazaDesde: Date,
  trazaHasta: Date,
): Promise<
  { totalPuntos: number | null; ultimoFixTs: Date | null; ultimoIngresoTs: Date | null }[]
> {
  return tx.$queryRaw<
    { totalPuntos: number | null; ultimoFixTs: Date | null; ultimoIngresoTs: Date | null }[]
  >`
    SELECT fix."ultimoFixTs", fix."ultimoIngresoTs", fix."totalPuntos"
    FROM sesiones_operativas so
    LEFT JOIN LATERAL (
      SELECT max(gp.ts) AS "ultimoFixTs",
             max(gp.received_at) AS "ultimoIngresoTs",
             count(*)::int AS "totalPuntos"
      FROM gps_points gp
      WHERE gp.sesion_id = so.id::uuid
        AND gp.ts >= ${trazaDesde} AND gp.ts < ${trazaHasta}
    ) fix ON true
    WHERE so.id = ${sesionId}
  `;
}

describe('gps_sesion_resumen — equivalencia vieja vs nueva (duplicados y puntos tardíos)', () => {
  const service = new EnVivoService();
  const sindicatoId = randomUUID();
  let rutaId: string;
  let vehiculoId: string;
  let conductorId: string;
  let asignacionId: string;
  let sesionDuplicadosId: string;
  let sesionTardiosId: string;

  const adminQuivo: AuthenticatedUser = {
    userId: 'test-admin',
    rol: 'admin_quivo',
    sindicatoId: null,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoId, nombre: 'Equivalencia Resumen Test', estado: 'activo' },
      });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'EQ1', nombre: 'Línea Equivalencia' },
      });
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_MakeLine(ST_MakePoint(-63.18, -17.78), ST_MakePoint(-63.17, -17.78)), 4326)::geography, 'activo', now(), now())
      `;
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa: 'EQT001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      vehiculoId = vehiculo.id;
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId,
          nombre: 'Conductor Equivalencia',
          documentoIdentidad: `EQT-${randomUUID()}`,
          licenciaConducir: 'LIC-EQ',
        },
      });
      conductorId = conductor.id;
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: '2026-09', estado: 'publicada' },
      });
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId,
          conductorId,
          rutaId,
          fecha: new Date(),
          horario: 'manana',
          orden: 1,
          venceAt: new Date(Date.now() + 60 * MINUTO),
          estado: 'vigente',
        },
      });
      asignacionId = asignacion.id;

      const credenciales = () => ({
        accessTokenHash: randomUUID(),
        refreshTokenHash: randomUUID(),
        accessExpiresAt: new Date(Date.now() + 60 * MINUTO),
        refreshExpiresAt: new Date(Date.now() + 60 * MINUTO),
      });
      const sesionDuplicados = await tx.sesionOperativa.create({
        data: {
          sindicatoId,
          asignacionId,
          vehiculoId,
          conductorId,
          deviceId: 'device-equivalencia-duplicados',
          estado: 'activa',
          ...credenciales(),
        },
      });
      sesionDuplicadosId = sesionDuplicados.id;
      const sesionTardios = await tx.sesionOperativa.create({
        data: {
          sindicatoId,
          asignacionId,
          vehiculoId,
          conductorId,
          deviceId: 'device-equivalencia-tardios',
          estado: 'activa',
          ...credenciales(),
        },
      });
      sesionTardiosId = sesionTardios.id;

      // `crear_particion_gps_points` es idempotente (`20260817130000_particion_gps_points_idempotente`):
      // el bootstrap de la migración de `gps_points` crea CURRENT_DATE..+6 relativo a CUANDO
      // corrió esa migración, no a cuándo corre este test — sin esto, `insertarGpsPoints` de
      // abajo puede fallar con "no partition of relation found for row" en una base migrada
      // hace varios días (mismo motivo por el que `en-vivo.service.test.ts` la llama también).
      await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE)`;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id IN (${sesionDuplicadosId}::uuid, ${sesionTardiosId}::uuid)`;
      await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id IN (${sesionDuplicadosId}::uuid, ${sesionTardiosId}::uuid)`;
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('reenviar el mismo lote (duplicados idempotentes RF-72) no infla `totalPuntos` — vieja y nueva coinciden', async () => {
    const ahora = AHORA;
    const jornada = fechaActualBolivia(ahora);
    const trazaDesde = inicioDeJornadaBolivia(jornada);
    const trazaHasta = new Date(trazaDesde.getTime() + 24 * 60 * MINUTO);

    const lote: EventoSync[] = [
      evento({
        payload: { sesionId: sesionDuplicadosId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 },
      }),
      evento({
        payload: {
          sesionId: sesionDuplicadosId,
          lat: -17.781,
          lng: -63.181,
          accuracy: 5,
          speed: 11,
        },
      }),
    ];

    // Primera ingesta: 2 puntos nuevos.
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, lote),
    );
    // Reenvío EXACTO del mismo lote (mismo event_id+ts) — RF-72: el cliente reintenta tras un
    // timeout, `gps_points` no duplica por `ON CONFLICT (event_id, ts) DO NOTHING`, y por eso
    // `gps_sesion_resumen.total_puntos` tampoco debe subir de 2 a 4.
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, lote),
    );

    const [viejo] = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      listarHoyViejo(tx, sesionDuplicadosId, trazaDesde, trazaHasta),
    );
    const nuevas = await service.listarHoy(adminQuivo, ahora);
    const nueva = nuevas.find((f) => f.id === sesionDuplicadosId);

    expect(viejo?.totalPuntos).toBe(2);
    expect(nueva?.totalPuntos).toBe(2);
    // Equivalencia campo por campo del bloque de frescura (no cambia con esta rama).
    expect(nueva?.ultimoFixTs).toBe(viejo?.ultimoFixTs?.toISOString());
    expect(nueva?.ultimoIngresoTs).toBe(viejo?.ultimoIngresoTs?.toISOString());
  });

  it('un punto tardío (ts viejo, llegado después) no pisa la última posición — vieja y nueva coinciden en lat/lng/ultimoFixTs', async () => {
    const ahora = AHORA;
    const jornada = fechaActualBolivia(ahora);
    const trazaDesde = inicioDeJornadaBolivia(jornada);
    const trazaHasta = new Date(trazaDesde.getTime() + 24 * 60 * MINUTO);

    // Primero llega (se INGESTA primero) el fix "actual" (ts = ahora - 1 min).
    const tsReciente = new Date(ahora.getTime() - MINUTO).toISOString();
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [
        evento({
          ts: tsReciente,
          payload: { sesionId: sesionTardiosId, lat: -17.79, lng: -63.19, accuracy: 5, speed: 12 },
        }),
      ]),
    );
    // Después llega un punto TARDÍO del outbox: `ts` de hace 10 min (más viejo que el fix ya
    // guardado), simulando un dispositivo que estuvo offline y recién ahora sincroniza.
    const tsTardio = new Date(ahora.getTime() - 10 * MINUTO).toISOString();
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [
        evento({
          ts: tsTardio,
          payload: { sesionId: sesionTardiosId, lat: -17.8, lng: -63.2, accuracy: 5, speed: 0 },
        }),
      ]),
    );

    const [viejo] = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      listarHoyViejo(tx, sesionTardiosId, trazaDesde, trazaHasta),
    );
    const nuevas = await service.listarHoy(adminQuivo, ahora);
    const nueva = nuevas.find((f) => f.id === sesionTardiosId);

    // La vieja query agregaba con `max(ts)` sobre TODOS los puntos de la jornada: el máximo
    // siempre es el fix reciente, sin importar el orden de llegada — el tardío no lo mueve.
    expect(viejo?.ultimoFixTs?.toISOString()).toBe(tsReciente);
    expect(viejo?.totalPuntos).toBe(2);
    // La nueva (resumen incremental con el guard `EXCLUDED.ultimo_fix_ts > ...`) tiene que
    // llegar EXACTAMENTE al mismo resultado, aunque lo calcule de forma incremental en vez de
    // re-agregando toda la jornada en cada lectura.
    expect(nueva?.ultimoFixTs).toBe(tsReciente);
    expect(nueva?.totalPuntos).toBe(2);

    // `obtenerPosiciones` expone lat/lng — el punto tardío (-17.80,-63.20) NUNCA debe
    // aparecer como última posición: el fix reciente (-17.79,-63.19) sigue mandando.
    const posiciones = await service.obtenerPosiciones(adminQuivo, ahora);
    const posicion = posiciones.find((f) => f.id === sesionTardiosId);
    expect(posicion?.lat).toBe(-17.79);
    expect(posicion?.lng).toBe(-63.19);
  });

  /** docs/plan-en-vivo-resumen-sesion.md §4.2 — RLS directa sobre `gps_sesion_resumen`
   * (no a través del join con `sesiones_operativas`, que ya prueban las suites de
   * `en-vivo.service.test.ts`): un sindicato NO ve filas de resumen de otro; `admin_quivo` sí. */
  describe('RLS de gps_sesion_resumen', () => {
    it('admin_sindicato de OTRO tenant no ve la fila de resumen (FORCE ROW LEVEL SECURITY)', async () => {
      const sindicatoOtroId = randomUUID();
      const filas = await withTenantContext(
        { rol: 'admin_sindicato', sindicatoId: sindicatoOtroId },
        (tx) =>
          tx.$queryRaw<{ sesion_id: string }[]>`
            SELECT sesion_id FROM gps_sesion_resumen WHERE sesion_id = ${sesionDuplicadosId}::uuid
          `,
      );
      expect(filas).toHaveLength(0);
    });

    it('admin_sindicato del sindicato dueño sí ve su propia fila de resumen', async () => {
      const filas = await withTenantContext(
        { rol: 'admin_sindicato', sindicatoId },
        (tx) =>
          tx.$queryRaw<{ sesion_id: string }[]>`
            SELECT sesion_id FROM gps_sesion_resumen WHERE sesion_id = ${sesionDuplicadosId}::uuid
          `,
      );
      expect(filas).toHaveLength(1);
    });

    it('admin_quivo (bypass explícito de la policy) ve la fila sin importar el tenant', async () => {
      const filas = await withTenantContext(
        { rol: 'admin_quivo', sindicatoId: null },
        (tx) =>
          tx.$queryRaw<{ sesion_id: string }[]>`
          SELECT sesion_id FROM gps_sesion_resumen WHERE sesion_id = ${sesionDuplicadosId}::uuid
        `,
      );
      expect(filas).toHaveLength(1);
    });
  });

  /**
   * code-review MEDIUM (docs/plan-en-vivo-resumen-sesion.md) — cross-tenant poisoning:
   * `payload.sesionId` lo controla el cliente y `insertarGpsPoints` corre como `admin_quivo`
   * (bypass de RLS), sin validar que el `sesionId` recibido pertenezca al sindicato del
   * dispositivo que lo mandó. Antes del fix, la PK de `gps_sesion_resumen` era
   * `(sesion_id, jornada)` — un dispositivo de OTRO tenant que mandara el `sesionId` real de
   * una sesión ajena pisaría/mezclaría la MISMA fila de resumen que el dueño real, y el
   * `ON CONFLICT DO UPDATE` no toca `"sindicatoId"`: la fila quedaba pegada al primero que
   * escribiera, escondiendo el resumen real del otro tenant (su propia RLS ya no la vería).
   * Con la PK de 3 columnas `(sesion_id, jornada, sindicatoId)` cada tenant escribe su
   * PROPIA fila para el mismo `sesion_id` — no hay colisión posible — y las lecturas de
   * `EnVivoService` además cierran el join con `so."sindicatoId"` como defensa en
   * profundidad.
   */
  describe('gps_sesion_resumen — cross-tenant poisoning (code-review MEDIUM)', () => {
    const service = new EnVivoService();
    const sindicatoDefensorId = randomUUID();
    const sindicatoAtacanteId = randomUUID();
    let rutaPId: string;
    let sesionDefensorId: string;

    const adminDefensor: AuthenticatedUser = {
      userId: 'test-defensor',
      rol: 'admin_sindicato',
      sindicatoId: sindicatoDefensorId,
    };

    beforeAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.sindicato.create({
          data: { id: sindicatoDefensorId, nombre: 'Poisoning Defensor', estado: 'activo' },
        });
        await tx.sindicato.create({
          data: { id: sindicatoAtacanteId, nombre: 'Poisoning Atacante', estado: 'activo' },
        });
        const linea = await tx.linea.create({
          data: { sindicatoId: sindicatoDefensorId, codigo: 'PZ1', nombre: 'Línea Poisoning' },
        });
        rutaPId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaPId}, ${linea.id}, 'ida', ST_SetSRID(ST_MakeLine(ST_MakePoint(-63.18, -17.78), ST_MakePoint(-63.17, -17.78)), 4326)::geography, 'activo', now(), now())
        `;
        const vehiculo = await tx.vehiculo.create({
          data: {
            sindicatoId: sindicatoDefensorId,
            placa: 'PZT001',
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
            sindicatoId: sindicatoDefensorId,
            nombre: 'Conductor Poisoning',
            documentoIdentidad: `PZT-${randomUUID()}`,
            licenciaConducir: 'LIC-PZ',
          },
        });
        const rotacion = await tx.rotacion.create({
          data: { sindicatoId: sindicatoDefensorId, periodo: '2026-09-pz', estado: 'publicada' },
        });
        const asignacion = await tx.asignacion.create({
          data: {
            rotacionId: rotacion.id,
            vehiculoId: vehiculo.id,
            conductorId: conductor.id,
            rutaId: rutaPId,
            fecha: new Date(),
            horario: 'manana',
            orden: 1,
            venceAt: new Date(Date.now() + 60 * MINUTO),
            estado: 'vigente',
          },
        });

        const sesionDefensor = await tx.sesionOperativa.create({
          data: {
            sindicatoId: sindicatoDefensorId,
            asignacionId: asignacion.id,
            vehiculoId: vehiculo.id,
            conductorId: conductor.id,
            deviceId: 'device-poisoning-defensor',
            estado: 'activa',
            accessTokenHash: randomUUID(),
            refreshTokenHash: randomUUID(),
            accessExpiresAt: new Date(Date.now() + 60 * MINUTO),
            refreshExpiresAt: new Date(Date.now() + 60 * MINUTO),
          },
        });
        sesionDefensorId = sesionDefensor.id;

        await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE)`;
      });
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id = ${sesionDefensorId}::uuid`;
        await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id = ${sesionDefensorId}::uuid`;
        await tx.sesionOperativa.deleteMany({ where: { id: sesionDefensorId } });
        await tx.asignacion.deleteMany({ where: { rutaId: rutaPId } });
        await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoDefensorId } });
        await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoDefensorId } });
        await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoDefensorId } });
        await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaPId}`;
        await tx.linea.deleteMany({ where: { sindicatoId: sindicatoDefensorId } });
        await tx.sindicato.delete({ where: { id: sindicatoDefensorId } });
        await tx.sindicato.delete({ where: { id: sindicatoAtacanteId } });
      });
    });

    it('un tenant atacante mandando el sesionId real de otro tenant no pisa ni esconde el resumen del dueño, y el dueño sigue actualizando su propia fila', async () => {
      const ahora = AHORA;

      // 1) El dispositivo DUEÑO manda su primer punto real.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: sindicatoDefensorId }, (tx) =>
        insertarGpsPoints(tx, sindicatoDefensorId, [
          evento({
            deviceId: 'device-poisoning-defensor',
            payload: {
              sesionId: sesionDefensorId,
              lat: -17.78,
              lng: -63.18,
              accuracy: 5,
              speed: 10,
            },
          }),
        ]),
      );

      const antesDelAtaque = await service.listarHoy(adminDefensor, ahora);
      const filaAntes = antesDelAtaque.find((f) => f.id === sesionDefensorId);
      expect(filaAntes?.totalPuntos).toBe(1);
      expect(filaAntes?.ultimoFixTs).toBeTruthy();

      // 2) El ATACANTE (otro tenant — `insertarGpsPoints` corre con SU sindicatoId de job,
      // tomado del contexto de la cola, no del payload) manda un lote con el `sesionId` REAL
      // del defensor en el payload. `gps_points.sesion_id` no tiene FK propia (ver comentario
      // de la migración de creación), así que esta escritura no falla por integridad
      // referencial: es exactamente el escenario que señaló el code-review.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: sindicatoAtacanteId }, (tx) =>
        insertarGpsPoints(tx, sindicatoAtacanteId, [
          evento({
            deviceId: 'device-poisoning-atacante',
            payload: { sesionId: sesionDefensorId, lat: -99, lng: -99, accuracy: 1, speed: 99 },
          }),
        ]),
      );

      // 3) La lectura del DUEÑO no cambia ni un campo: totalPuntos, lat/lng, ultimoFixTs.
      const despuesDelAtaque = await service.listarHoy(adminDefensor, ahora);
      const filaDespues = despuesDelAtaque.find((f) => f.id === sesionDefensorId);
      expect(filaDespues?.totalPuntos).toBe(filaAntes?.totalPuntos);
      expect(filaDespues?.ultimoFixTs).toBe(filaAntes?.ultimoFixTs);
      expect(filaDespues?.ultimoIngresoTs).toBe(filaAntes?.ultimoIngresoTs);

      const posicionesDespues = await service.obtenerPosiciones(adminDefensor, ahora);
      const posicionDespues = posicionesDespues.find((f) => f.id === sesionDefensorId);
      expect(posicionDespues?.lat).toBe(-17.78);
      expect(posicionDespues?.lng).toBe(-63.18);
      expect(posicionDespues?.totalPuntos).toBe(1);

      // Las 2 filas de resumen coexisten sin colisionar — una por tenant, PK de 3 columnas —
      // verificado directo contra la tabla como `admin_quivo` (ve ambas).
      const filasCrudas = await withTenantContext(
        { rol: 'admin_quivo', sindicatoId: null },
        (tx) =>
          tx.$queryRaw<{ sindicatoId: string; total_puntos: number }[]>`
          SELECT "sindicatoId", total_puntos FROM gps_sesion_resumen
          WHERE sesion_id = ${sesionDefensorId}::uuid ORDER BY "sindicatoId" ASC
        `,
      );
      expect(filasCrudas).toHaveLength(2);
      expect(filasCrudas.every((f) => f.total_puntos === 1)).toBe(true);

      // 4) El dueño sigue reportando después del ataque: su PROPIA fila se actualiza normal
      // (incrementa a 2, nueva posición), sin verse afectada por la fila envenenada.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: sindicatoDefensorId }, (tx) =>
        insertarGpsPoints(tx, sindicatoDefensorId, [
          evento({
            deviceId: 'device-poisoning-defensor',
            ts: new Date(AHORA.getTime() - MINUTO).toISOString(),
            payload: {
              sesionId: sesionDefensorId,
              lat: -17.781,
              lng: -63.181,
              accuracy: 5,
              speed: 12,
            },
          }),
        ]),
      );

      const final = await service.listarHoy(adminDefensor, ahora);
      const filaFinal = final.find((f) => f.id === sesionDefensorId);
      expect(filaFinal?.totalPuntos).toBe(2);

      const posicionesFinal = await service.obtenerPosiciones(adminDefensor, ahora);
      const posicionFinal = posicionesFinal.find((f) => f.id === sesionDefensorId);
      expect(posicionFinal?.lat).toBe(-17.781);
      expect(posicionFinal?.lng).toBe(-63.181);
    });
  });
});
