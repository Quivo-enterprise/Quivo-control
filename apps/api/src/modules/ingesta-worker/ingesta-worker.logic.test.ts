import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia, type EventoSync } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agruparPorTipo,
  insertarEventoOperativoEnTx,
  IngestaWorkerService,
  insertarGpsPoints,
  procesarCumplimientoEnTx,
} from './ingesta-worker.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-63.18, -17.78],
    [-63.17, -17.78],
  ],
});
// Punto de control en (-63.18, -17.78), radio 30m.
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-63.18, -17.78] });

function evento(overrides: Partial<EventoSync> = {}): EventoSync {
  return {
    eventId: '018e6e6a-0000-7000-8000-000000000000',
    deviceId: 'device-test',
    ts: new Date().toISOString(),
    tipo: 'gps_point',
    payload: {},
    ...overrides,
  };
}

describe('IngestaWorkerService — lógica de procesamiento por tipo', () => {
  const sindicatoId = randomUUID();
  const sindicatoOtroId = randomUUID();
  let rutaId: string;
  let puntoControlId: string;
  let rutaOtroId: string;
  let puntoControlOtroId: string;
  let sesionId: string;

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoId, nombre: 'Ingesta Worker Test', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoOtroId, nombre: 'Ingesta Worker Test — Otro', estado: 'activo' },
      });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'IW1', nombre: 'Línea Ingesta' },
      });
      const lineaOtro = await tx.linea.create({
        data: { sindicatoId: sindicatoOtroId, codigo: 'IW1', nombre: 'Línea Otro' },
      });
      rutaId = randomUUID();
      rutaOtroId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaOtroId}, ${lineaOtro.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      puntoControlId = randomUUID();
      puntoControlOtroId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${puntoControlOtroId}, ${rutaOtroId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${puntoControlId}, ${rutaId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;

      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa: 'IWT001',
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
          sindicatoId,
          nombre: 'Conductor Test',
          documentoIdentidad: `IWT-${randomUUID()}`,
          licenciaConducir: 'LIC-1',
        },
      });
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: '2026-08', estado: 'publicada' },
      });
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          // Día de Bolivia (no `new Date()`): coincide con el chequeo de inicio_jornada.
          fecha: fechaActualBolivia(new Date()),
          horario: 'manana',
          orden: 1,
          venceAt: new Date(Date.now() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });
      const sesion = await tx.sesionOperativa.create({
        data: {
          sindicatoId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-test',
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      sesionId = sesion.id;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.syncError.deleteMany({ where: { sindicatoId: { in: [sindicatoId, sindicatoOtroId] } } });
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId } });
      // `gps_sesion_resumen` (docs/plan-en-vivo-resumen-sesion.md) NO tiene FK propia a
      // `sesiones_operativas`/`gps_points`, pero SÍ a `sindicatos` (`ON DELETE RESTRICT`) —
      // sin borrar esto primero, el `sindicato.delete` de abajo falla con violación de FK,
      // porque `insertarGpsPoints` (probado más abajo en este archivo) ahora escribe acá.
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id = ${sesionId}::uuid`;
      // PR A (docs/plan-en-vivo-alertas.md): `procesarLote` ahora también escribe
      // `sesion_desvio_estado` (FK a `sindicatos`) y puede abrir `infracciones` — mismo motivo.
      await tx.$executeRaw`DELETE FROM sesion_desvio_estado WHERE sesion_id = ${sesionId}`;
      await tx.infraccion.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id = ${sesionId}::uuid`;
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" IN (${rutaId}, ${rutaOtroId})`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${rutaOtroId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: { in: [sindicatoId, sindicatoOtroId] } } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoOtroId } });
    });
    await prisma.$disconnect();
  });

  it('agruparPorTipo separa los eventos por su tipo de outbox', () => {
    const eventos = [
      evento({ eventId: randomUUID(), tipo: 'gps_point' }),
      evento({ eventId: randomUUID(), tipo: 'cumplimiento_punto_control' }),
      evento({ eventId: randomUUID(), tipo: 'observacion' }),
    ];
    const grupos = agruparPorTipo(eventos);
    expect(grupos.gps_point).toHaveLength(1);
    expect(grupos.cumplimiento_punto_control).toHaveLength(1);
    expect(grupos.observacion).toHaveLength(1);
    expect(grupos.inicio_recorrido).toHaveLength(0);
  });

  it('inserta puntos GPS de forma idempotente por event_id+ts', async () => {
    const eventId = randomUUID();
    const ts = new Date().toISOString();
    const eventoGps = evento({
      eventId,
      ts,
      tipo: 'gps_point',
      payload: { sesionId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [eventoGps]),
    );
    // Reenviar el mismo evento (mismo event_id+ts) no debe duplicar la fila.
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [eventoGps]),
    );

    const filas = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId },
      (tx) =>
        tx.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) as total FROM gps_points WHERE event_id = ${eventId}::uuid
      `,
    );
    expect(Number(filas[0]!.total)).toBe(1);
  });

  it('persiste el punto con el timestamp del FIX GPS, no con el de encolado (evidencia RF-67..73)', async () => {
    const eventId = randomUUID();
    // Caso headless: el SDK entrega la ubicación bufferada 20 min después del fix real, así
    // que el `ts` del sobre (encolado) llega muy corrido respecto del recorrido real.
    const tsFix = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const eventoGps = evento({
      eventId,
      ts: new Date().toISOString(),
      tipo: 'gps_point',
      payload: { sesionId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10, tsFix },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [eventoGps]),
    );

    const filas = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId },
      (tx) =>
        tx.$queryRaw<{ ts: Date }[]>`
        SELECT ts FROM gps_points WHERE event_id = ${eventId}::uuid
      `,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.ts.toISOString()).toBe(tsFix);
  });

  it('cae al ts de encolado cuando el evento no trae tsFix — retrocompatibilidad', async () => {
    const eventId = randomUUID();
    const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    // Payload exactamente como lo produce una versión anterior de la app móvil: sin `tsFix`.
    const eventoGps = evento({
      eventId,
      ts,
      tipo: 'gps_point',
      payload: { sesionId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [eventoGps]),
    );

    const filas = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId },
      (tx) =>
        tx.$queryRaw<{ ts: Date }[]>`
        SELECT ts FROM gps_points WHERE event_id = ${eventId}::uuid
      `,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.ts.toISOString()).toBe(ts);
  });

  it('reporta cuántos tsFix llegaron inusables, para que el fallback no sea silencioso', async () => {
    const tsEncolado = new Date().toISOString();
    const descartados = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarGpsPoints(tx, sindicatoId, [
        // Sin tsFix: comportamiento esperado de una app anterior, NO cuenta como degradación.
        evento({
          eventId: randomUUID(),
          ts: tsEncolado,
          payload: { sesionId, lat: -17.78, lng: -63.18 },
        }),
        // tsFix ilegible: se ingesta con el ts de encolado, pero hay que enterarse.
        evento({
          eventId: randomUUID(),
          ts: tsEncolado,
          payload: { sesionId, lat: -17.78, lng: -63.18, tsFix: 'ayer' },
        }),
        // tsFix usable: no cuenta.
        evento({
          eventId: randomUUID(),
          ts: tsEncolado,
          payload: {
            sesionId,
            lat: -17.78,
            lng: -63.18,
            tsFix: new Date(Date.now() - 60_000).toISOString(),
          },
        }),
      ]),
    );
    expect(descartados).toBe(1);
  });

  /**
   * code-review MEDIUM (docs/plan-en-vivo-resumen-sesion.md): la jornada boliviana de
   * `gps_sesion_resumen` tiene que salir bit a bit igual que `fechaActualBolivia`
   * (aritmética pura en UTC), sin importar el TimeZone de la CONEXIÓN de Postgres que
   * ejecuta el upsert. Antes del fix, `(ts - interval '4 hours')::date` casteaba un
   * `timestamptz` a `date` — esa conversión SÍ pasa por el TimeZone de la sesión — así que
   * una conexión reusada del pool con `TimeZone` distinto de `UTC` podía calcular una
   * jornada distinta de la real, silenciosamente. `SET LOCAL` (no `SET` a secas): queda
   * acotado a esta transacción — no se pega a la conexión física para el resto de la suite
   * cuando `withTenantContext` la devuelve al pool de Prisma.
   */
  it('la jornada del punto no cambia con el TimeZone de la conexión (code-review MEDIUM)', async () => {
    const sesionTzId = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE)`;
        const base = await tx.sesionOperativa.findUniqueOrThrow({ where: { id: sesionId } });
        const sesion = await tx.sesionOperativa.create({
          data: {
            sindicatoId,
            asignacionId: base.asignacionId,
            vehiculoId: base.vehiculoId,
            conductorId: base.conductorId,
            deviceId: 'device-test-tz',
            accessTokenHash: randomUUID(),
            refreshTokenHash: randomUUID(),
            accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
            refreshExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        return sesion.id;
      },
    );

    // Ancla al día UTC de HOY para que ambos `ts` caigan en la partición ya asegurada arriba.
    const hoyStr = new Date().toISOString().slice(0, 10);
    const ayerStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // 05:00 UTC - 4h = 01:00 UTC del MISMO día ⇒ jornada = HOY.
    const tsHoy = `${hoyStr}T05:00:00.000Z`;
    // 03:59 UTC - 4h = 23:59 UTC del día ANTERIOR ⇒ jornada = AYER.
    const tsAyer = `${hoyStr}T03:59:00.000Z`;

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, async (tx) => {
      await tx.$executeRaw`SET LOCAL TimeZone = 'America/La_Paz'`;
      await insertarGpsPoints(tx, sindicatoId, [
        evento({
          eventId: randomUUID(),
          ts: tsHoy,
          payload: { sesionId: sesionTzId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 },
        }),
        evento({
          eventId: randomUUID(),
          ts: tsAyer,
          payload: { sesionId: sesionTzId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 },
        }),
      ]);
    });

    try {
      const filas = await withTenantContext(
        { rol: 'admin_quivo', sindicatoId },
        (tx) =>
          tx.$queryRaw<{ jornada: Date; total_puntos: number }[]>`
          SELECT jornada, total_puntos FROM gps_sesion_resumen
          WHERE sesion_id = ${sesionTzId}::uuid ORDER BY jornada ASC
        `,
      );

      expect(filas).toHaveLength(2);
      expect(filas[0]?.jornada.toISOString().slice(0, 10)).toBe(ayerStr);
      expect(filas[0]?.total_puntos).toBe(1);
      expect(filas[1]?.jornada.toISOString().slice(0, 10)).toBe(hoyStr);
      expect(filas[1]?.total_puntos).toBe(1);
    } finally {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id = ${sesionTzId}::uuid`;
        await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id = ${sesionTzId}::uuid`;
        await tx.sesionOperativa.delete({ where: { id: sesionTzId } });
      });
    }
  });

  it('valida server-side un cumplimiento dentro del radio de tolerancia', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registro = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findFirst({ where: { sesionId, puntoControlId } }),
    );
    expect(registro?.cumplido).toBe(true);
    expect(registro?.validadoPor).toBe('worker');
    expect(registro?.distanciaM).toBeLessThan(5);
  });

  it('persiste el cumplimiento con el timestamp del FIX GPS, no con el de encolado (evidencia RF-64..66)', async () => {
    const eventId = randomUUID();
    // Caso headless: el SDK entrega la ubicación bufferada 20 min después del fix real que
    // disparó la detección del geofence, así que el `ts` del sobre (encolado) llega corrido.
    const tsFix = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const eventoCumplimiento = evento({
      eventId,
      ts: new Date().toISOString(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18, tsFix },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registro = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findFirst({ where: { eventId } }),
    );
    expect(registro?.ts.toISOString()).toBe(tsFix);
  });

  it('cae al ts de encolado cuando el cumplimiento no trae tsFix — retrocompatibilidad', async () => {
    const eventId = randomUUID();
    const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    // Payload exactamente como lo produce una versión anterior de la app móvil: sin `tsFix`.
    const eventoCumplimiento = evento({
      eventId,
      ts,
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registro = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findFirst({ where: { eventId } }),
    );
    expect(registro?.ts.toISOString()).toBe(ts);
  });

  it('reporta cuándo el tsFix del cumplimiento llegó inusable, para que el fallback no sea silencioso', async () => {
    const eventId = randomUUID();
    const tsEncolado = new Date().toISOString();
    const eventoCumplimiento = evento({
      eventId,
      ts: tsEncolado,
      tipo: 'cumplimiento_punto_control',
      // tsFix ilegible: se ingesta con el ts de encolado, pero hay que enterarse.
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18, tsFix: 'ayer' },
    });

    const { tsFixDescartado } = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );
    expect(tsFixDescartado).toBe(true);
  });

  it('marca no cumplido un punto de control fuera del radio, aunque el app haya reportado que sí', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      // ~1km de distancia real, aunque el payload venga marcado como si el app lo hubiera
      // detectado — el worker es la fuente de verdad, no confía en el reporte del cliente.
      payload: { sesionId, puntoControlId, lat: -17.79, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registros = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findMany({ where: { sesionId, puntoControlId } }),
    );
    const ultimo = registros[registros.length - 1];
    expect(ultimo?.cumplido).toBe(false);
    expect(ultimo?.distanciaM).toBeGreaterThan(30);
  });

  it('rechaza un cumplimiento contra un punto de control inexistente', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId: randomUUID(), lat: -17.78, lng: -63.18 },
    });

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
      ),
    ).rejects.toThrow('no encontrado');
  });

  it('rechaza un cumplimiento contra un punto de control de OTRO sindicato (puntos_control no tiene RLS propia)', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      // `puntoControlOtroId` existe de verdad, pero pertenece a `sindicatoOtroId` — sin el
      // join de tenant en `procesarCumplimientoEnTx`, esto pasaría igual (la tabla es
      // legible por cualquier actor, RLS no aplica acá).
      payload: { sesionId, puntoControlId: puntoControlOtroId, lat: -17.78, lng: -63.18 },
    });

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
      ),
    ).rejects.toThrow('no encontrado');
  });

  it('reenviar el mismo cumplimiento (mismo event_id) no duplica la fila — idempotencia RF-72', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );
    // Reenvío del mismo lote (comportamiento esperado del cliente ante un timeout, QUI-240).
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registros = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findMany({ where: { eventId: eventoCumplimiento.eventId } }),
    );
    expect(registros).toHaveLength(1);
  });

  it('inserta un evento operativo genérico (inicio_recorrido/fin_recorrido/observacion)', async () => {
    const eventoObservacion = evento({
      eventId: randomUUID(),
      tipo: 'observacion',
      payload: { sesionId, texto: 'Desvío por corte de calle' },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarEventoOperativoEnTx(tx, sindicatoId, eventoObservacion),
    );

    const registro = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.eventoOperativo.findFirst({ where: { eventId: eventoObservacion.eventId } }),
    );
    expect(registro).not.toBeNull();
    expect((registro?.payload as { texto: string }).texto).toBe('Desvío por corte de calle');
  });

  it('reenviar el mismo evento operativo (mismo event_id) no duplica la fila — idempotencia RF-72', async () => {
    const eventoObservacion = evento({
      eventId: randomUUID(),
      tipo: 'observacion',
      payload: { sesionId, texto: 'Reenvío de prueba' },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarEventoOperativoEnTx(tx, sindicatoId, eventoObservacion),
    );
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarEventoOperativoEnTx(tx, sindicatoId, eventoObservacion),
    );

    const registros = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.eventoOperativo.findMany({ where: { eventId: eventoObservacion.eventId } }),
    );
    expect(registros).toHaveLength(1);
  });

  it('rechaza un evento operativo sin sesionId en el payload', async () => {
    const eventoInvalido = evento({ eventId: randomUUID(), tipo: 'observacion', payload: {} });

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(tx, sindicatoId, eventoInvalido),
      ),
    ).rejects.toThrow('sin sesionId');
  });

  /**
   * Fase A (docs/plan-ubicacion-fluida.md) — `insertarEventoOperativoEnTx` mantiene
   * `SesionOperativa.recorridoEstado`/`recorridoEstadoTs`, en la MISMA transacción que
   * inserta el `EventoOperativo`, cuando el tipo es `inicio_recorrido`/`fin_recorrido`.
   */
  describe('Fase A — recorridoEstado derivado (inicio_recorrido/fin_recorrido)', () => {
    async function recorridoEstadoDe(id: string) {
      const sesion = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        tx.sesionOperativa.findUniqueOrThrow({ where: { id } }),
      );
      return { estado: sesion.recorridoEstado, ts: sesion.recorridoEstadoTs };
    }

    it('fin_recorrido deja recorridoEstado="finalizado" con el ts del evento', async () => {
      const ts = new Date().toISOString();
      const eventoFin = evento({ eventId: randomUUID(), ts, tipo: 'fin_recorrido', payload: { sesionId } });

      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(tx, sindicatoId, eventoFin),
      );

      const { estado, ts: guardado } = await recorridoEstadoDe(sesionId);
      expect(estado).toBe('finalizado');
      expect(guardado?.toISOString()).toBe(ts);
    });

    it('inicio_recorrido POSTERIOR vuelve el estado a "en_curso"', async () => {
      const tsInicio = new Date().toISOString();
      const eventoInicio = evento({
        eventId: randomUUID(),
        ts: tsInicio,
        tipo: 'inicio_recorrido',
        payload: { sesionId },
      });

      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(tx, sindicatoId, eventoInicio),
      );

      const { estado } = await recorridoEstadoDe(sesionId);
      expect(estado).toBe('en_curso');
    });

    it('guard por ts: un evento fuera de orden (ts más viejo que el ya aplicado) no pisa el estado', async () => {
      const tsNuevo = new Date().toISOString();
      const tsViejo = new Date(Date.now() - 60_000).toISOString();

      // Aplica primero el más nuevo (fin_recorrido)...
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({ eventId: randomUUID(), ts: tsNuevo, tipo: 'fin_recorrido', payload: { sesionId } }),
        ),
      );
      // ...y después un inicio_recorrido que llegó tarde (outbox, reconexión) con un ts VIEJO.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({ eventId: randomUUID(), ts: tsViejo, tipo: 'inicio_recorrido', payload: { sesionId } }),
        ),
      );

      // El estado sigue siendo el del evento más NUEVO — el fuera de orden no lo pisó.
      const { estado, ts: guardado } = await recorridoEstadoDe(sesionId);
      expect(estado).toBe('finalizado');
      expect(guardado?.toISOString()).toBe(tsNuevo);
    });

    it('un eventId DUPLICADO (createMany.count === 0) no toca el estado', async () => {
      const eventId = randomUUID();
      const tsOriginal = new Date().toISOString();
      const eventoFin = evento({ eventId, ts: tsOriginal, tipo: 'fin_recorrido', payload: { sesionId } });

      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(tx, sindicatoId, eventoFin),
      );
      const { ts: tsTrasElPrimero } = await recorridoEstadoDe(sesionId);

      // Reenvío del MISMO event_id, pero con un `ts` (del sobre) manipulado/distinto — igual
      // no debe aplicarse: `createMany` con `skipDuplicates` no inserta la fila (count 0),
      // así que el guard `insertado.count === 1` corta ANTES del UPDATE, sin llegar siquiera
      // a evaluar el guard por `ts`.
      const tsManipulado = new Date(Date.now() + 5 * 60_000).toISOString();
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({ eventId, ts: tsManipulado, tipo: 'fin_recorrido', payload: { sesionId } }),
        ),
      );

      const { ts: tsFinal } = await recorridoEstadoDe(sesionId);
      expect(tsFinal?.toISOString()).toBe(tsTrasElPrimero?.toISOString());
    });

    it('un evento con deviceId DISTINTO al de la sesión no toca el estado (device_id del evento es el autenticado, no el del payload)', async () => {
      // `tsAntes` tiene que ser más nuevo que cualquier `recorridoEstadoTs` que hayan dejado
      // los tests anteriores de este mismo describe (comparten `sesionId`, sin cleanup entre
      // tests) — el guard por `ts` de `insertarEventoOperativoEnTx` sino lo descartaría en
      // silencio y esta aserción de "antes" fallaría por una razón ajena a lo que se prueba.
      const tsAntes = new Date().toISOString();
      // Deja la sesión en un estado conocido primero.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({ eventId: randomUUID(), ts: tsAntes, tipo: 'inicio_recorrido', payload: { sesionId } }),
        ),
      );
      const antes = await recorridoEstadoDe(sesionId);
      expect(antes.estado).toBe('en_curso');

      // La sesión real es del device "device-test" (fixture de este describe). Un evento
      // "fin_recorrido" que apunta al MISMO sesionId pero con OTRO deviceId no debe poder
      // cerrar el recorrido de esa sesión — el guard de `deviceId` en el UPDATE lo bloquea.
      const tsDespues = new Date(Date.now() + 1_000).toISOString();
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({
            eventId: randomUUID(),
            ts: tsDespues,
            tipo: 'fin_recorrido',
            deviceId: 'device-otro-telefono',
            payload: { sesionId },
          }),
        ),
      );

      const despues = await recorridoEstadoDe(sesionId);
      expect(despues.estado).toBe('en_curso');
      expect(despues.ts?.toISOString()).toBe(tsAntes);
    });

    it('watermark del futuro: un evento con ts adelantado más allá de DRIFT_ALERTA_MS no toca recorridoEstado, pero sí se guarda como bitácora', async () => {
      // `tsAntes` más nuevo que cualquier `recorridoEstadoTs` dejado por tests previos del
      // mismo describe (comparten `sesionId`) — mismo motivo que el test de deviceId de
      // arriba: si no, el guard por `ts` descartaría este setup en silencio.
      const tsAntes = new Date().toISOString();
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({ eventId: randomUUID(), ts: tsAntes, tipo: 'inicio_recorrido', payload: { sesionId } }),
        ),
      );
      const antes = await recorridoEstadoDe(sesionId);
      expect(antes.estado).toBe('en_curso');

      // 30 min en el futuro — bastante más allá de los 5 min de `DRIFT_ALERTA_MS` (no se
      // importa esa constante acá para no atarse a su valor exacto, solo a que "30 min" es
      // inequívocamente drift).
      const eventIdFuturo = randomUUID();
      const tsFuturo = new Date(Date.now() + 30 * 60_000).toISOString();
      const resultado = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          evento({ eventId: eventIdFuturo, ts: tsFuturo, tipo: 'fin_recorrido', payload: { sesionId } }),
        ),
      );

      expect(resultado.recorridoEstadoOmitidoPorDriftFuturo).toBe(true);
      expect(resultado.driftFuturoMs).toBeGreaterThan(25 * 60_000);

      // El estado NO se movió a "finalizado" — sigue en "en_curso", como antes del evento
      // con ts futuro (la sesión no queda atascada esperando un evento que ya no puede
      // llegar con un ts más nuevo que ese watermark corrido).
      const despues = await recorridoEstadoDe(sesionId);
      expect(despues.estado).toBe('en_curso');
      expect(despues.ts?.toISOString()).toBe(tsAntes);

      // El evento sí quedó guardado en eventos_operativos — el guard solo omite el UPDATE
      // del estado derivado, no la bitácora.
      const registrado = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        tx.eventoOperativo.findUnique({ where: { eventId: eventIdFuturo } }),
      );
      expect(registrado).not.toBeNull();
      expect(registrado?.tipo).toBe('fin_recorrido');
    });
  });

  /**
   * Release 13 — `inicio_jornada` ("hoy trabajo"): se persiste como evento operativo, NO
   * mueve `recorridoEstado`, y valida que `sesionId` sea una sesión de ESTE dispositivo y de
   * ESTE sindicato (a diferencia de los demás tipos, que todavía no lo validan).
   */
  describe('Release 13 — inicio_jornada', () => {
    // `procesarLote` es privado y el constructor real abre Redis + Workers de BullMQ (que
    // consumirían la cola real): se arma una instancia sin pasar por el constructor, con solo
    // lo que `procesarLote` toca (logger y la métrica de cola pendiente).
    function servicioSinCola(): IngestaWorkerService {
      const servicio = Object.create(IngestaWorkerService.prototype) as Record<string, unknown>;
      servicio.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
      servicio.ingestaQueueStats = { getWaitingCount: async () => 0 };
      return servicio as unknown as IngestaWorkerService;
    }

    async function procesarLote(sindicato: string, eventos: EventoSync[]) {
      const servicio = servicioSinCola() as unknown as {
        procesarLote(job: unknown): Promise<{ procesados: number; errores: number }>;
      };
      return servicio.procesarLote({ id: 'job-test', data: { sindicatoId: sindicato, eventos } });
    }

    const buscarEvento = (eventId: string) =>
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        tx.eventoOperativo.findMany({ where: { eventId } }),
      );
    const buscarErrores = (eventId: string) =>
      withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.syncError.findMany({ where: { eventId } }),
      );

    it('un lote mixto gps_point + inicio_jornada se procesa sin errores y queda en eventos_operativos', async () => {
      // La partición de hoy ya la crea el test de `insertarGpsPoints` de más arriba (mismo
      // archivo, corren en orden): no se vuelve a llamar `crear_particion_gps_points` acá, que
      // toma un lock exclusivo y es fuente de deadlocks contra otros archivos en paralelo.
      const eventIdGps = randomUUID();
      const eventIdJornada = randomUUID();
      const resultado = await procesarLote(sindicatoId, [
        evento({
          eventId: eventIdGps,
          tipo: 'gps_point',
          payload: { sesionId, lat: -17.78, lng: -63.18 },
        }),
        evento({ eventId: eventIdJornada, tipo: 'inicio_jornada', payload: { sesionId } }),
      ]);

      expect(resultado).toEqual({ procesados: 2, errores: 0 });
      const registros = await buscarEvento(eventIdJornada);
      expect(registros).toHaveLength(1);
      expect(registros[0]?.tipo).toBe('inicio_jornada');
      expect(registros[0]?.sesionId).toBe(sesionId);
    });

    it('inicio_jornada NO cambia recorridoEstado ni recorridoEstadoTs', async () => {
      const antes = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        tx.sesionOperativa.findUniqueOrThrow({ where: { id: sesionId } }),
      );
      await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(
          tx,
          sindicatoId,
          // `ts` posterior a cualquier estado previo: si el tipo moviera el estado, se vería.
          evento({
            eventId: randomUUID(),
            ts: new Date(Date.now() + 1_000).toISOString(),
            tipo: 'inicio_jornada',
            payload: { sesionId },
          }),
        ),
      );
      const despues = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        tx.sesionOperativa.findUniqueOrThrow({ where: { id: sesionId } }),
      );
      expect(despues.recorridoEstado).toBe(antes.recorridoEstado);
      expect(despues.recorridoEstadoTs?.toISOString()).toBe(antes.recorridoEstadoTs?.toISOString());
    });

    it('un deviceId ajeno a la sesión va a sync_errors y no se inserta', async () => {
      const eventId = randomUUID();
      const resultado = await procesarLote(sindicatoId, [
        evento({
          eventId,
          deviceId: 'device-ajeno',
          tipo: 'inicio_jornada',
          payload: { sesionId },
        }),
      ]);

      expect(resultado).toEqual({ procesados: 0, errores: 1 });
      expect(await buscarEvento(eventId)).toHaveLength(0);
      const errores = await buscarErrores(eventId);
      expect(errores).toHaveLength(1);
      expect(errores[0]?.error).toContain('no pertenece al dispositivo');
    });

    it('un sesionId inexistente va a sync_errors y no se inserta', async () => {
      const eventId = randomUUID();
      const resultado = await procesarLote(sindicatoId, [
        evento({ eventId, tipo: 'inicio_jornada', payload: { sesionId: randomUUID() } }),
      ]);

      expect(resultado.errores).toBe(1);
      expect(await buscarEvento(eventId)).toHaveLength(0);
      expect(await buscarErrores(eventId)).toHaveLength(1);
    });

    it('una sesión de OTRO sindicato (tenant del lote distinto) va a sync_errors', async () => {
      const eventId = randomUUID();
      const resultado = await procesarLote(sindicatoOtroId, [
        evento({ eventId, tipo: 'inicio_jornada', payload: { sesionId } }),
      ]);

      expect(resultado.errores).toBe(1);
      const insertados = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.eventoOperativo.findMany({ where: { eventId } }),
      );
      expect(insertados).toHaveLength(0);
      expect(await buscarErrores(eventId)).toHaveLength(1);
    });

    it('un payload sin sesionId uuid va a sync_errors', async () => {
      const eventId = randomUUID();
      const resultado = await procesarLote(sindicatoId, [
        evento({ eventId, tipo: 'inicio_jornada', payload: { sesionId: 'no-es-uuid' } }),
      ]);
      expect(resultado.errores).toBe(1);
      expect(await buscarEvento(eventId)).toHaveLength(0);
    });

    it('una declaración cuyo día (Bolivia) no coincide con la asignación de la sesión va a sync_errors', async () => {
      const eventId = randomUUID();
      const ayer = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const resultado = await procesarLote(sindicatoId, [
        evento({ eventId, ts: ayer, tipo: 'inicio_jornada', payload: { sesionId } }),
      ]);

      expect(resultado).toEqual({ procesados: 0, errores: 1 });
      expect(await buscarEvento(eventId)).toHaveLength(0);
      const errores = await buscarErrores(eventId);
      expect(errores).toHaveLength(1);
      expect(errores[0]?.error).toContain('no coincide con la fecha de la asignación');
    });

    it('una declaración del mismo día que la asignación se acepta (sin exigir sesión activa: outbox tardío)', async () => {
      const eventId = randomUUID();
      // Mediodía de Bolivia del día de la asignación: estable sea cual sea la hora del test.
      const mediodia = new Date(fechaActualBolivia(new Date()).getTime() + 16 * 60 * 60 * 1000);
      const resultado = await procesarLote(sindicatoId, [
        evento({
          eventId,
          ts: mediodia.toISOString(),
          tipo: 'inicio_jornada',
          payload: { sesionId },
        }),
      ]);

      expect(resultado).toEqual({ procesados: 1, errores: 0 });
      expect(await buscarEvento(eventId)).toHaveLength(1);
    });

    it('reenviar el mismo eventId es idempotente (una sola fila, sin errores)', async () => {
      const eventId = randomUUID();
      const e = evento({ eventId, tipo: 'inicio_jornada', payload: { sesionId } });
      const primero = await procesarLote(sindicatoId, [e]);
      const segundo = await procesarLote(sindicatoId, [e]);

      expect(primero.errores).toBe(0);
      expect(segundo.errores).toBe(0);
      expect(await buscarEvento(eventId)).toHaveLength(1);
    });
  });
});
