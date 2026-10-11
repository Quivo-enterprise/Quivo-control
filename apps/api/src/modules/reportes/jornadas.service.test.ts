import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
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
const DIA_ANTERIOR_TARDE = new Date(DIA.getTime() + 2 * HORA); // 22:00 Bolivia del 14

describe('derivarEstadoJornada', () => {
  const ts = new Date();
  it('el recorrido manda sobre la declaración', () => {
    expect(derivarEstadoJornada('en_curso', ts)).toBe('en_recorrido');
    expect(derivarEstadoJornada('finalizado', ts)).toBe('finalizado');
    expect(derivarEstadoJornada('en_curso', null)).toBe('en_recorrido');
  });
  it('sin recorrido: declaración → dia_iniciado, nada → sin_iniciar', () => {
    expect(derivarEstadoJornada(null, ts)).toBe('dia_iniciado');
    expect(derivarEstadoJornada(null, null)).toBe('sin_iniciar');
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

      /** Crea vehículo + asignación(es) del día + sesión con el `recorridoEstado` pedido. */
      async function vehiculo(
        clave: string,
        sindicatoId: string,
        ctx: typeof a,
        rutaId: string,
        opciones: {
          horas?: Array<number | null>;
          recorridoEstado?: 'en_curso' | 'finalizado' | null;
          inicioJornadaTs?: Date | null;
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
        for (const [i, h] of horas.entries()) {
          const asig = await tx.asignacion.create({
            data: {
              rotacionId: ctx.rotacion.id,
              vehiculoId: v.id,
              conductorId: ctx.conductor.id,
              rutaId,
              fecha: DIA,
              horario: horarios[i]!,
              horaSalida: h === null ? null : new Date(DIA.getTime() + h * HORA),
              orden: i + 1,
              venceAt: new Date(DIA.getTime() + 28 * HORA),
              estado: 'vigente',
            },
          });
          primera ??= asig;
        }
        if (opciones.recorridoEstado !== undefined || opciones.inicioJornadaTs) {
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
              recorridoEstado: opciones.recorridoEstado ?? null,
              recorridoEstadoTs: opciones.recorridoEstado ? DENTRO_DEL_DIA : null,
            },
          });
          if (opciones.inicioJornadaTs) {
            await tx.eventoOperativo.create({
              data: {
                eventId: randomUUID(),
                sindicatoId,
                sesionId: sesion.id,
                deviceId: `device-${clave}`,
                tipo: 'inicio_jornada',
                ts: opciones.inicioJornadaTs,
                payload: { sesionId: sesion.id },
              },
            });
          }
        }
      }

      await vehiculo('sin', sindicatoAId, a, rutaAId);
      await vehiculo('dia', sindicatoAId, a, rutaAId, { inicioJornadaTs: DENTRO_DEL_DIA });
      await vehiculo('rec', sindicatoAId, a, rutaAId, {
        recorridoEstado: 'en_curso',
        inicioJornadaTs: DENTRO_DEL_DIA,
      });
      await vehiculo('fin', sindicatoAId, a, rutaAId, { recorridoEstado: 'finalizado' });
      // Declaración de la jornada ANTERIOR: no cuenta para esta fecha.
      await vehiculo('vieja', sindicatoAId, a, rutaAId, { inicioJornadaTs: DIA_ANTERIOR_TARDE });
      // Tres turnos el mismo día: debe colapsar a UNA fila con la salida más temprana (null al final).
      await vehiculo('multi', sindicatoAId, a, rutaAId, { horas: [null, 18, 9] });
      await vehiculo('ajeno', sindicatoBId, b, rutaBId, { inicioJornadaTs: DENTRO_DEL_DIA });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const ids = [sindicatoAId, sindicatoBId];
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

  it('una declaración de la jornada anterior no cuenta para esta fecha', async () => {
    const r = await service.listar(adminA, FECHA);
    expect(estadoDe(r, 'vieja')?.estado).toBe('sin_iniciar');
  });

  it('admin_sindicato solo ve su sindicato; el otro ve el suyo', async () => {
    const a = await service.listar(adminA, FECHA);
    expect(a.vehiculos).toHaveLength(6);
    expect(estadoDe(a, 'ajeno')).toBeUndefined();

    const b = await service.listar(adminB, FECHA);
    expect(b.vehiculos.map((v) => v.vehiculoId)).toEqual([vehiculos['ajeno']]);
    expect(b.vehiculos[0]?.estado).toBe('dia_iniciado');
  });

  it('admin_quivo ve ambos sindicatos', async () => {
    const r = await service.listar(adminQuivo, FECHA);
    expect(estadoDe(r, 'ajeno')).toBeDefined();
    expect(estadoDe(r, 'sin')).toBeDefined();
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
    expect(r.vehiculos).toHaveLength(6);
    // 2031-03-16T05:00Z = 01:00 del 16 en Bolivia → otro día, sin asignaciones.
    const otro = await service.listar(adminA, undefined, new Date('2031-03-16T05:00:00.000Z'));
    expect(otro.fecha).toBe('2031-03-16');
    expect(otro.vehiculos).toHaveLength(0);
  });

  it('rechaza una fecha con forma válida pero inexistente', async () => {
    await expect(service.listar(adminA, '2031-02-31')).rejects.toBeInstanceOf(BadRequestException);
  });
});
