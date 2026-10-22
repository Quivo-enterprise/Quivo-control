import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { insertarActividadResumen } from '../salidas/salidas.fixtures.js';
import { DRIFT_ALERTA_MS } from '../ingesta-worker/ingesta-drift.js';
import { JornadasService, derivarEstadoJornada } from './jornadas.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-63.18, -17.78],
    [-63.17, -17.78],
  ],
});

// Fecha fija lejana para no cruzarse con datos de otros tests. La jornada boliviana de
// 2031-03-15 va de 2031-03-15T04:00Z a 2031-03-16T04:00Z.
const FECHA = '2031-03-15';
const DIA = new Date(`${FECHA}T00:00:00.000Z`);
const HORA = 60 * 60_000;
const DENTRO_DEL_DIA = new Date(DIA.getTime() + 12 * HORA);
const DIA_1 = new Date('2031-03-20T00:00:00.000Z');
const DIA_2 = new Date('2031-03-21T00:00:00.000Z');
const DIA_ANTERIOR_TARDE = new Date(DIA.getTime() + 2 * HORA); // 22:00 Bolivia del 14

describe('derivarEstadoJornada', () => {
  const desde = new Date('2031-03-15T04:00:00.000Z');
  const dentro = new Date('2031-03-15T16:00:00.000Z');
  const antes = new Date('2031-03-15T03:30:00.000Z'); // 23:30 Bolivia del día anterior
  const ts = new Date();
  it('el último evento de recorrido manda sobre la declaración', () => {
    expect(derivarEstadoJornada('inicio_recorrido', dentro, desde, ts)).toBe('en_recorrido');
    expect(derivarEstadoJornada('fin_recorrido', dentro, desde, ts)).toBe('finalizado');
    expect(derivarEstadoJornada('inicio_recorrido', dentro, desde, null)).toBe('en_recorrido');
  });
  it('sin recorrido: declaración → dia_iniciado, nada → sin_iniciar', () => {
    expect(derivarEstadoJornada(null, null, desde, ts)).toBe('dia_iniciado');
    expect(derivarEstadoJornada(null, null, desde, null)).toBe('sin_iniciar');
  });
  it('turno nocturno: inicio_recorrido anterior a desde sigue en_recorrido', () => {
    expect(derivarEstadoJornada('inicio_recorrido', antes, desde, null)).toBe('en_recorrido');
  });
  it('fin_recorrido anterior a desde es de la jornada previa y se ignora', () => {
    expect(derivarEstadoJornada('fin_recorrido', antes, desde, null)).toBe('sin_iniciar');
    expect(derivarEstadoJornada('fin_recorrido', antes, desde, ts)).toBe('dia_iniciado');
  });
});

describe('JornadasService (Postgres real + RLS)', () => {
  const service = new JornadasService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rutaAId: string;
  let rutaBId: string;
  const vehiculos: Record<string, string> = {};

  const adminQuivo: AuthenticatedUser = {
    userId: 'test-admin-quivo',
    rol: 'admin_quivo',
    sindicatoId: null,
  };
  const adminA: AuthenticatedUser = {
    userId: 'test-admin-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };
  const adminB: AuthenticatedUser = {
    userId: 'test-admin-b',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoBId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'Jornadas A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Jornadas B', estado: 'activo' },
      });

      async function sembrarSindicato(sindicatoId: string, prefijo: string, rutaId: string) {
        const linea = await tx.linea.create({
          data: { sindicatoId, codigo: `${prefijo}1`, nombre: `Línea ${prefijo}` },
        });
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        const conductor = await tx.conductor.create({
          data: {
            sindicatoId,
            nombre: `Conductor ${prefijo}`,
            documentoIdentidad: `JOR-${randomUUID()}`,
            licenciaConducir: 'LIC-J',
          },
        });
        const rotacion = await tx.rotacion.create({
          data: { sindicatoId, periodo: '2031-03', estado: 'publicada' },
        });
        return { conductor, rotacion };
      }

      rutaAId = randomUUID();
      rutaBId = randomUUID();
      const a = await sembrarSindicato(sindicatoAId, 'JA', rutaAId);
      const b = await sembrarSindicato(sindicatoBId, 'JB', rutaBId);

      /**
       * Crea vehículo + asignación(es) por día + UNA sesión con los eventos pedidos
       * (`inicio_jornada`/`inicio_recorrido`/`fin_recorrido`). `recorridoEstado` de la
       * sesión no se toca a propósito: el servicio no debe depender de él.
       */
      async function vehiculo(
        clave: string,
        sindicatoId: string,
        ctx: typeof a,
        rutaId: string,
        opciones: {
          horas?: Array<number | null>;
          dias?: Date[];
          eventos?: Array<{ tipo: string; ts: Date; deviceId?: string; receivedAt?: Date }>;
          /** Actividad GPS de la sesión en esa jornada (un `inicio_recorrido` previo al día solo cuenta con ella). */
          actividadEn?: { jornada: string; ts: Date };
        } = {},
      ) {
        const v = await tx.vehiculo.create({
          data: {
            sindicatoId,
            placa: `J${clave}${randomUUID().slice(0, 4).toUpperCase()}`,
            tipo: 'bus',
            marca: 'x',
            modelo: 'x',
            color: 'x',
            numeroInterno: `N-${clave}`,
            capacidad: 10,
            estado: 'activo',
          },
        });
        vehiculos[clave] = v.id;
        const horarios = ['manana', 'tarde', 'noche'];
        const horas = opciones.horas ?? [null];
        let primera: { id: string } | null = null;
        for (const dia of opciones.dias ?? [DIA]) {
          for (const [i, h] of horas.entries()) {
            const asig = await tx.asignacion.create({
              data: {
                rotacionId: ctx.rotacion.id,
                vehiculoId: v.id,
                conductorId: ctx.conductor.id,
                rutaId,
                fecha: dia,
                horario: horarios[i]!,
                horaSalida: h === null ? null : new Date(dia.getTime() + h * HORA),
                orden: i + 1,
                venceAt: new Date(dia.getTime() + 28 * HORA),
                estado: 'vigente',
              },
            });
            primera ??= asig;
          }
        }
        if (opciones.eventos?.length) {
          const sesion = await tx.sesionOperativa.create({
            data: {
              sindicatoId,
              asignacionId: primera!.id,
              vehiculoId: v.id,
              conductorId: ctx.conductor.id,
              deviceId: `device-${clave}`,
              accessTokenHash: randomUUID(),
              refreshTokenHash: randomUUID(),
              accessExpiresAt: new Date(DIA.getTime() + 28 * HORA),
              refreshExpiresAt: new Date(DIA.getTime() + 28 * HORA),
            },
          });
          for (const e of opciones.eventos) {
            await tx.eventoOperativo.create({
              data: {
                eventId: randomUUID(),
                sindicatoId,
                sesionId: sesion.id,
                deviceId: e.deviceId ?? `device-${clave}`,
                tipo: e.tipo,
                ts: e.ts,
                // Por defecto llega "a tiempo" (receivedAt = ts): las fechas del test son
                // sintéticas y el default now() dejaría todo como evento del futuro.
                receivedAt: e.receivedAt ?? e.ts,
                payload: { sesionId: sesion.id },
              },
            });
          }
          if (opciones.actividadEn) {
            await insertarActividadResumen(tx, { sesionId: sesion.id, sindicatoId, jornada: opciones.actividadEn.jornada, ultimoFixTs: opciones.actividadEn.ts });
          }
        }
      }

      const jornada = (ts: Date) => ({ tipo: 'inicio_jornada', ts });
      await vehiculo('sin', sindicatoAId, a, rutaAId);
      await vehiculo('dia', sindicatoAId, a, rutaAId, { eventos: [jornada(DENTRO_DEL_DIA)] });
      await vehiculo('rec', sindicatoAId, a, rutaAId, {
        eventos: [jornada(DENTRO_DEL_DIA), { tipo: 'inicio_recorrido', ts: DENTRO_DEL_DIA }],
      });
      await vehiculo('fin', sindicatoAId, a, rutaAId, {
        eventos: [
          { tipo: 'inicio_recorrido', ts: DENTRO_DEL_DIA },
          { tipo: 'fin_recorrido', ts: new Date(DENTRO_DEL_DIA.getTime() + HORA) },
        ],
      });
      // Declaración de la jornada ANTERIOR: no cuenta para esta fecha.
      await vehiculo('vieja', sindicatoAId, a, rutaAId, {
        eventos: [jornada(DIA_ANTERIOR_TARDE)],
      });
      // Tres turnos el mismo día: debe colapsar a UNA fila con la salida más temprana (null al final).
      await vehiculo('multi', sindicatoAId, a, rutaAId, { horas: [null, 18, 9] });
      await vehiculo('ajeno', sindicatoBId, b, rutaBId, { eventos: [jornada(DENTRO_DEL_DIA)] });
      // Rotación en borrador: sus asignaciones no son trabajo esperado.
      const borrador = await tx.rotacion.create({
        data: { sindicatoId: sindicatoAId, periodo: '2031-03', estado: 'borrador' },
      });
      await vehiculo('borrador', sindicatoAId, { ...a, rotacion: borrador }, rutaAId);

      // Eventos NO elegibles: se persisten pero no deben contar (misma regla que la ingesta).
      // deviceId distinto del de la sesión (payload apuntando a la sesión de otro teléfono).
      await vehiculo('foraneo', sindicatoAId, a, rutaAId, {
        eventos: [
          { tipo: 'inicio_recorrido', ts: DENTRO_DEL_DIA, deviceId: 'device-otro-telefono' },
          { tipo: 'inicio_jornada', ts: DENTRO_DEL_DIA, deviceId: 'device-otro-telefono' },
        ],
      });
      // ts adelantado más allá de la tolerancia de drift respecto de receivedAt.
      await vehiculo('futuro', sindicatoAId, a, rutaAId, {
        eventos: [
          {
            tipo: 'fin_recorrido',
            ts: DENTRO_DEL_DIA,
            receivedAt: new Date(DENTRO_DEL_DIA.getTime() - DRIFT_ALERTA_MS - 60_000),
          },
          {
            tipo: 'inicio_jornada',
            ts: DENTRO_DEL_DIA,
            receivedAt: new Date(DENTRO_DEL_DIA.getTime() - DRIFT_ALERTA_MS - 60_000),
          },
        ],
      });
      // Turno nocturno: inicio_recorrido a las 23:30 Bolivia del día anterior, sin fin → hoy
      // sigue en_recorrido.
      await vehiculo('noche_inicio', sindicatoAId, a, rutaAId, {
        eventos: [{ tipo: 'inicio_recorrido', ts: new Date(DIA.getTime() + 3.5 * HORA) }],
        // En un día pasado, el turno de anoche cuenta solo si la sesión tuvo GPS ese día.
        actividadEn: { jornada: FECHA, ts: new Date(DIA.getTime() + 6 * HORA) },
      });
      // fin_recorrido a las 23:50 Bolivia del día anterior: es de la jornada previa, hoy no
      // cuenta como finalizado.
      await vehiculo('noche_fin', sindicatoAId, a, rutaAId, {
        eventos: [{ tipo: 'fin_recorrido', ts: new Date(DIA.getTime() + (3 + 50 / 60) * HORA) }],
      });
      // Empate de ts: gana el de receivedAt más nuevo (aquí el inicio, recibido después).
      await vehiculo('empate_rx', sindicatoAId, a, rutaAId, {
        eventos: [
          { tipo: 'fin_recorrido', ts: DENTRO_DEL_DIA, receivedAt: DENTRO_DEL_DIA },
          {
            tipo: 'inicio_recorrido',
            ts: DENTRO_DEL_DIA,
            receivedAt: new Date(DENTRO_DEL_DIA.getTime() + 5_000),
          },
        ],
      });
      // Empate total (ts y receivedAt): el desempate por id es estable entre consultas.
      await vehiculo('empate_id', sindicatoAId, a, rutaAId, {
        eventos: [
          { tipo: 'inicio_recorrido', ts: DENTRO_DEL_DIA },
          { tipo: 'fin_recorrido', ts: DENTRO_DEL_DIA },
        ],
      });
      // Dentro de la tolerancia (ts apenas adelantado) SÍ cuenta.
      await vehiculo('tolerado', sindicatoAId, a, rutaAId, {
        eventos: [
          {
            tipo: 'inicio_recorrido',
            ts: DENTRO_DEL_DIA,
            receivedAt: new Date(DENTRO_DEL_DIA.getTime() - DRIFT_ALERTA_MS + 60_000),
          },
        ],
      });

      // Sesión que cruza días: inicio_recorrido el día 1, fin_recorrido el día 2.
      const mediodia = (d: Date) => new Date(d.getTime() + 12 * HORA);
      await vehiculo('cruza', sindicatoAId, a, rutaAId, {
        dias: [DIA_1, DIA_2],
        eventos: [
          { tipo: 'inicio_recorrido', ts: mediodia(DIA_1) },
          { tipo: 'fin_recorrido', ts: mediodia(DIA_2) },
        ],
      });
      // Sesión reutilizada: completa el día 1 y arranca de nuevo el día 2.
      await vehiculo('reusada', sindicatoAId, a, rutaAId, {
        dias: [DIA_1, DIA_2],
        eventos: [
          { tipo: 'inicio_recorrido', ts: mediodia(DIA_1) },
          { tipo: 'fin_recorrido', ts: new Date(mediodia(DIA_1).getTime() + HORA) },
          { tipo: 'inicio_recorrido', ts: mediodia(DIA_2) },
        ],
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const ids = [sindicatoAId, sindicatoBId];
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" IN (${sindicatoAId}, ${sindicatoBId})`;
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: { in: ids } } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: { in: ids } } });
      await tx.asignacion.deleteMany({ where: { rutaId: { in: [rutaAId, rutaBId] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: { in: ids } } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: { in: ids } } });
      await tx.conductor.deleteMany({ where: { sindicatoId: { in: ids } } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaAId}, ${rutaBId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: { in: ids } } });
      await tx.sindicato.deleteMany({ where: { id: { in: ids } } });
    });
    await prisma.$disconnect();
  });

  const estadoDe = (r: Awaited<ReturnType<JornadasService['listar']>>, clave: string) =>
    r.vehiculos.find((v) => v.vehiculoId === vehiculos[clave]);

  it('deriva cada estado: sin_iniciar, dia_iniciado, en_recorrido y finalizado', async () => {
    const r = await service.listar(adminA, FECHA);
    expect(r.fecha).toBe(FECHA);
    expect(estadoDe(r, 'sin')?.estado).toBe('sin_iniciar');
    expect(estadoDe(r, 'sin')?.inicioJornadaTs).toBeNull();
    expect(estadoDe(r, 'dia')?.estado).toBe('dia_iniciado');
    expect(estadoDe(r, 'dia')?.inicioJornadaTs).toBe(DENTRO_DEL_DIA.toISOString());
    expect(estadoDe(r, 'rec')?.estado).toBe('en_recorrido');
    expect(estadoDe(r, 'fin')?.estado).toBe('finalizado');
  });

  it('un evento con deviceId ajeno a la sesión se ignora (recorrido y jornada)', async () => {
    const r = await service.listar(adminA, FECHA);
    const f = estadoDe(r, 'foraneo');
    expect(f?.estado).toBe('sin_iniciar');
    expect(f?.inicioJornadaTs).toBeNull();
  });

  it('un evento con ts más allá de la tolerancia de drift se ignora; dentro de ella cuenta', async () => {
    const r = await service.listar(adminA, FECHA);
    const f = estadoDe(r, 'futuro');
    expect(f?.estado).toBe('sin_iniciar');
    expect(f?.inicioJornadaTs).toBeNull();
    expect(estadoDe(r, 'tolerado')?.estado).toBe('en_recorrido');
  });

  it('una rotación en borrador no aparece como trabajo esperado', async () => {
    const r = await service.listar(adminA, FECHA);
    expect(estadoDe(r, 'borrador')).toBeUndefined();
  });

  it('sesión que cruza días: el día 1 es en_recorrido y el día 2 finalizado', async () => {
    const d1 = await service.listar(adminA, '2031-03-20');
    const d2 = await service.listar(adminA, '2031-03-21');
    expect(estadoDe(d1, 'cruza')?.estado).toBe('en_recorrido');
    expect(estadoDe(d2, 'cruza')?.estado).toBe('finalizado');
  });

  it('sesión reutilizada en dos días: cada día informa su propio estado', async () => {
    const d1 = await service.listar(adminA, '2031-03-20');
    const d2 = await service.listar(adminA, '2031-03-21');
    expect(estadoDe(d1, 'reusada')?.estado).toBe('finalizado');
    expect(estadoDe(d2, 'reusada')?.estado).toBe('en_recorrido');
  });

  it('una declaración de la jornada anterior no cuenta para esta fecha', async () => {
    const r = await service.listar(adminA, FECHA);
    expect(estadoDe(r, 'vieja')?.estado).toBe('sin_iniciar');
  });

  it('admin_sindicato solo ve su sindicato; el otro ve el suyo', async () => {
    const a = await service.listar(adminA, FECHA);
    expect(a.vehiculos).toHaveLength(13);
    expect(estadoDe(a, 'ajeno')).toBeUndefined();

    const b = await service.listar(adminB, FECHA);
    expect(b.vehiculos.map((v) => v.vehiculoId)).toEqual([vehiculos['ajeno']]);
    expect(b.vehiculos[0]?.estado).toBe('dia_iniciado');
  });

  it('admin_quivo ve ambos sindicatos, con sindicatoId/Nombre, ordenados por sindicato y placa', async () => {
    const r = await service.listar(adminQuivo, FECHA);
    expect(estadoDe(r, 'ajeno')).toBeDefined();
    expect(estadoDe(r, 'sin')).toBeDefined();
    expect(estadoDe(r, 'sin')?.sindicatoId).toBe(sindicatoAId);
    expect(estadoDe(r, 'sin')?.sindicatoNombre).toBe('Jornadas A');
    expect(estadoDe(r, 'ajeno')?.sindicatoId).toBe(sindicatoBId);
    expect(estadoDe(r, 'ajeno')?.sindicatoNombre).toBe('Jornadas B');
    const propios = r.vehiculos.filter(
      (v) => v.sindicatoId === sindicatoAId || v.sindicatoId === sindicatoBId,
    );
    const clave = (v: (typeof propios)[number]) => `${v.sindicatoNombre}\u0000${v.placa}`;
    expect(propios.map(clave)).toEqual([...propios.map(clave)].sort());
    // Todos los de A van antes que el de B.
    expect(propios.at(-1)?.sindicatoId).toBe(sindicatoBId);
  });

  it('turno nocturno: inicio_recorrido de 23:30 del día anterior sigue en_recorrido hoy', async () => {
    const r = await service.listar(adminA, FECHA);
    expect(estadoDe(r, 'noche_inicio')?.estado).toBe('en_recorrido');
  });

  it('fin_recorrido de 23:50 del día anterior no deja finalizado el día de hoy', async () => {
    const r = await service.listar(adminA, FECHA);
    expect(estadoDe(r, 'noche_fin')?.estado).toBe('sin_iniciar');
  });

  it('empate de ts: gana el receivedAt más nuevo y el resultado es estable', async () => {
    const r1 = await service.listar(adminA, FECHA);
    const r2 = await service.listar(adminA, FECHA);
    expect(estadoDe(r1, 'empate_rx')?.estado).toBe('en_recorrido');
    expect(estadoDe(r1, 'empate_id')?.estado).toBe(estadoDe(r2, 'empate_id')?.estado);
    expect(['en_recorrido', 'finalizado']).toContain(estadoDe(r1, 'empate_id')?.estado);
  });

  it('varios turnos del mismo vehículo colapsan a una fila con la salida más temprana', async () => {
    const r = await service.listar(adminA, FECHA);
    const filas = r.vehiculos.filter((v) => v.vehiculoId === vehiculos['multi']);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.horaSalida).toBe(new Date(DIA.getTime() + 9 * HORA).toISOString());
  });

  it('devuelve los datos de línea, ruta y conductor, y horaSalida null cuando no hay', async () => {
    const r = await service.listar(adminA, FECHA);
    const f = estadoDe(r, 'sin');
    expect(f?.lineaNombre).toBe('Línea JA');
    expect(f?.rutaSentido).toBe('ida');
    expect(f?.conductorNombre).toBe('Conductor JA');
    expect(f?.numeroInterno).toBe('N-sin');
    expect(f?.horaSalida).toBeNull();
  });

  it('sin fecha usa el día actual de Bolivia (inyectado vía `ahora`)', async () => {
    // 2031-03-16T02:00Z = 22:00 del 15 en Bolivia (UTC-4) → sigue siendo el día 15.
    const r = await service.listar(adminA, undefined, new Date('2031-03-16T02:00:00.000Z'));
    expect(r.fecha).toBe(FECHA);
    expect(r.vehiculos).toHaveLength(13);
    // 2031-03-16T05:00Z = 01:00 del 16 en Bolivia → otro día, sin asignaciones.
    const otro = await service.listar(adminA, undefined, new Date('2031-03-16T05:00:00.000Z'));
    expect(otro.fecha).toBe('2031-03-16');
    expect(otro.vehiculos).toHaveLength(0);
  });

  it('rechaza una fecha con forma válida pero inexistente', async () => {
    await expect(service.listar(adminA, '2031-02-31')).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Jornada de HOY: un `inicio_recorrido` de antes de las 00:00 solo cuenta si la sesión está vigente
 * (`sesionesVisiblesSql`); un recorrido abandonado de ayer (sin `fin_recorrido`) no queda `en_recorrido`.
 * En un día pasado cuenta solo si la sesión tuvo actividad GPS ese día. `ahora` es fijo: independiente del reloj.
 */
describe('JornadasService: recorridos abandonados (jornada de hoy)', () => {
  const service = new JornadasService();
  const sindicatoId = randomUUID();
  const rutaId = randomUUID();
  const admin: AuthenticatedUser = { userId: 'test-admin-v', rol: 'admin_sindicato', sindicatoId };
  const ahora = new Date('2032-05-10T16:00:00.000Z'); // 12:00 Bolivia del 2032-05-10
  const hoy = '2032-05-10';
  const hoyDate = new Date(`${hoy}T00:00:00.000Z`);
  const ayerTarde = new Date('2032-05-09T19:24:00.000Z'); // 15:24 Bolivia de ayer
  const diaPasado = '2032-05-09';
  const diaPasadoDate = new Date(`${diaPasado}T00:00:00.000Z`);
  const anteayerTarde = new Date('2032-05-08T19:24:00.000Z'); // 15:24 Bolivia de anteayer
  const v: Record<string, string> = {};

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Jornadas Vigencia', estado: 'activo' } });
      const linea = await tx.linea.create({ data: { sindicatoId, codigo: 'JV1', nombre: 'Línea JV' } });
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())`;
      const conductor = await tx.conductor.create({
        data: { sindicatoId, nombre: 'Conductor JV', documentoIdentidad: `JV-${randomUUID()}`, licenciaConducir: 'L' },
      });
      const rotacion = await tx.rotacion.create({ data: { sindicatoId, periodo: '2032-05', estado: 'publicada' } });
      const caso = async (
        clave: string, inicioSesion: Date, inicioRecorrido: Date, actividad: Date | null,
        fecha = hoyDate, jornadaActividad = hoy,
      ) => {
        const vh = await tx.vehiculo.create({
          data: { sindicatoId, placa: `JV${clave}${randomUUID().slice(0, 3).toUpperCase()}`, tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
        });
        v[clave] = vh.id;
        const asig = await tx.asignacion.create({
          data: {
            rotacionId: rotacion.id, vehiculoId: vh.id, conductorId: conductor.id, rutaId, fecha,
            horario: 'manana', orden: 1, venceAt: new Date(hoyDate.getTime() + 28 * HORA), estado: 'vigente',
          },
        });
        const ses = await tx.sesionOperativa.create({
          data: {
            sindicatoId, asignacionId: asig.id, vehiculoId: vh.id, conductorId: conductor.id,
            deviceId: `dev-${clave}`, inicio: inicioSesion, accessTokenHash: randomUUID(), refreshTokenHash: randomUUID(),
            accessExpiresAt: new Date(hoyDate.getTime() + 28 * HORA), refreshExpiresAt: new Date(hoyDate.getTime() + 28 * HORA),
          },
        });
        await tx.eventoOperativo.create({
          data: {
            eventId: randomUUID(), sindicatoId, sesionId: ses.id, deviceId: `dev-${clave}`, tipo: 'inicio_recorrido',
            ts: inicioRecorrido, receivedAt: inicioRecorrido, payload: { sesionId: ses.id },
          },
        });
        if (actividad) {
          await insertarActividadResumen(tx, { sesionId: ses.id, sindicatoId, jornada: jornadaActividad, ultimoFixTs: actividad });
        }
      };
      // Zombi: inicio_recorrido de ayer 15:24, último GPS de ayer (fuera de la gracia de 2 h).
      await caso('zombi', ayerTarde, ayerTarde, null);
      // Turno de anoche vivo: mismo inicio de ayer, pero con GPS hace 30 min.
      await caso('noche', ayerTarde, ayerTarde, new Date(ahora.getTime() - 30 * 60_000));
      // Flujo normal de hoy: inicio_recorrido de las 10:00 Bolivia.
      await caso('hoy', new Date('2032-05-10T14:00:00.000Z'), new Date('2032-05-10T14:00:00.000Z'), null);
      // Día pasado (09/05): inicio_recorrido de anteayer; sin actividad el 09 vs con actividad el 09.
      await caso('pasadoSin', anteayerTarde, anteayerTarde, null, diaPasadoDate);
      await caso('pasadoCon', anteayerTarde, anteayerTarde, new Date('2032-05-09T15:00:00.000Z'), diaPasadoDate, diaPasado);
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" = ${sindicatoId}`;
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoId } });
    });
  });

  it('inicio_recorrido de ayer sin actividad hoy → sin_iniciar; con actividad reciente → en_recorrido; el de hoy no cambia', async () => {
    const r = await service.listar(admin, undefined, ahora);
    const estado = (k: string) => r.vehiculos.find((x) => x.vehiculoId === v[k])?.estado;
    expect(r.fecha).toBe(hoy);
    expect(estado('zombi')).toBe('sin_iniciar');
    expect(estado('noche')).toBe('en_recorrido');
    expect(estado('hoy')).toBe('en_recorrido');
  });

  it('día pasado: inicio_recorrido de la víspera sin actividad ese día → sin_iniciar; con actividad ese día → en_recorrido', async () => {
    const r = await service.listar(admin, diaPasado, ahora);
    const estado = (k: string) => r.vehiculos.find((x) => x.vehiculoId === v[k])?.estado;
    expect(r.fecha).toBe(diaPasado);
    expect(estado('pasadoSin')).toBe('sin_iniciar');
    expect(estado('pasadoCon')).toBe('en_recorrido');
  });
});
