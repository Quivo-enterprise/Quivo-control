import { randomUUID } from 'node:crypto';
import { withTenantContext, type Prisma } from '@quivo/db';
import { fechaActualBolivia } from '@quivo/shared';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

/** Datos de prueba compartidos por los tests de integración de la fila de salida. */
export const ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;
export const LON = -63.18;
export const LAT = -17.78;
const GEOM = { type: 'LineString', coordinates: [[LON, LAT], [-63.17, LAT]] };
const punto = (lon: number, lat: number) => JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

export interface MundoSalidas {
  sindicatoA: string;
  sindicatoB: string;
  pcTerminalA: string;
  pcRetornoA: string;
  pcTerminalB: string;
  rutaA: string;
  /** Vehículos del sindicato A, cada uno con su sesión activa. */
  a: { vehiculoId: string; placa: string; sesion: SesionMovilAutenticada }[];
  vehiculoB: string;
}

/** Dos sindicatos; A con ruta + terminal (radio 150 m) + retorno, y `nVehiculos` con sesión activa. */
export async function crearMundo(nVehiculos: number): Promise<MundoSalidas> {
  const sindicatoA = randomUUID();
  const sindicatoB = randomUUID();
  const mundo = { sindicatoA, sindicatoB, a: [] } as unknown as MundoSalidas;
  await withTenantContext(ADMIN, async (tx) => {
    await tx.sindicato.create({ data: { id: sindicatoA, nombre: 'Fila A', estado: 'activo' } });
    await tx.sindicato.create({ data: { id: sindicatoB, nombre: 'Fila B', estado: 'activo' } });
    const crearRuta = async (sindicatoId: string) => {
      const linea = await tx.linea.create({ data: { sindicatoId, codigo: `FS${randomUUID().slice(0, 4)}`, nombre: 'Línea fila' } });
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${id}, ${linea.id}, 'circuito', ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(GEOM)}), 4326)::geography, 'activo', now(), now())`;
      return id;
    };
    const crearPc = async (ruta: string, orden: number, lon: number, rol: string, radio: number) => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, rol, "createdAt", "updatedAt")
        VALUES (${id}, ${ruta}, ${orden}, ST_SetSRID(ST_GeomFromGeoJSON(${punto(lon, LAT)}), 4326)::geography, ${radio}, false, ${rol}, now(), now())`;
      return id;
    };
    mundo.rutaA = await crearRuta(sindicatoA);
    const rutaB = await crearRuta(sindicatoB);
    mundo.pcTerminalA = await crearPc(mundo.rutaA, 0, LON, 'terminal', 150);
    mundo.pcRetornoA = await crearPc(mundo.rutaA, 1, -63.175, 'retorno', 100);
    mundo.pcTerminalB = await crearPc(rutaB, 0, LON, 'terminal', 150);

    const conductor = await tx.conductor.create({
      data: { sindicatoId: sindicatoA, nombre: 'Conductor Fila', documentoIdentidad: `FS-${randomUUID()}`, licenciaConducir: 'L1' },
    });
    const rotacion = await tx.rotacion.create({ data: { sindicatoId: sindicatoA, periodo: '2026-10', estado: 'publicada' } });
    const nuevoVehiculo = (sindicatoId: string) =>
      tx.vehiculo.create({
        data: { sindicatoId, placa: `FS${randomUUID().slice(0, 5).toUpperCase()}`, tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
      });
    for (let i = 0; i < nVehiculos; i += 1) {
      const v = await nuevoVehiculo(sindicatoA);
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id, vehiculoId: v.id, conductorId: conductor.id, rutaId: mundo.rutaA,
          fecha: fechaActualBolivia(new Date()), horario: 'manana', orden: i + 1,
          venceAt: new Date(Date.now() + 3_600_000), estado: 'vigente',
        },
      });
      const sesion = await tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoA, asignacionId: asignacion.id, conductorId: conductor.id, vehiculoId: v.id,
          deviceId: `dev-fila-${i}`, accessTokenHash: randomUUID(), refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      mundo.a.push({
        vehiculoId: v.id,
        placa: v.placa,
        sesion: {
          sesionId: sesion.id, sindicatoId: sindicatoA, asignacionId: asignacion.id,
          vehiculoId: v.id, conductorId: conductor.id, deviceId: `dev-fila-${i}`,
        },
      });
    }
    mundo.vehiculoB = (await nuevoVehiculo(sindicatoB)).id;
  });
  return mundo;
}

export async function borrarMundo(m: MundoSalidas): Promise<void> {
  await withTenantContext(ADMIN, async (tx) => {
    const ids = { in: [m.sindicatoA, m.sindicatoB] };
    const pcs = [m.pcTerminalA, m.pcRetornoA, m.pcTerminalB];
    await tx.filaSalida.deleteMany({ where: { sindicatoId: ids } });
    await tx.frecuenciaRegla.deleteMany({ where: { sindicatoId: ids } });
    await tx.grupoVehiculoMiembro.deleteMany({ where: { sindicatoId: ids } });
    await tx.grupoVehiculo.deleteMany({ where: { sindicatoId: ids } });
    await tx.auditLog.deleteMany({ where: { sindicatoId: ids } });
    await tx.sesionOperativa.deleteMany({ where: { sindicatoId: ids } });
    await tx.asignacion.deleteMany({ where: { vehiculo: { sindicatoId: ids } } });
    await tx.rotacion.deleteMany({ where: { sindicatoId: ids } });
    await tx.vehiculo.deleteMany({ where: { sindicatoId: ids } });
    await tx.conductor.deleteMany({ where: { sindicatoId: ids } });
    await tx.$executeRaw`DELETE FROM puntos_control WHERE id = ANY(${pcs})`;
    await tx.$executeRaw`DELETE FROM rutas WHERE "lineaId" IN (SELECT id FROM lineas WHERE "sindicatoId" IN (${m.sindicatoA}, ${m.sindicatoB}))`;
    await tx.linea.deleteMany({ where: { sindicatoId: ids } });
    await tx.sindicato.deleteMany({ where: { id: ids } });
  });
}

/** Fila de `gps_sesion_resumen` (actividad GPS de una sesión en una jornada 'YYYY-MM-DD') para tests de vigencia. */
export async function insertarActividadResumen(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  a: { sesionId: string; sindicatoId: string; jornada: string; ultimoFixTs: Date; ultimoIngresoTs?: Date },
): Promise<void> {
  const ingreso = a.ultimoIngresoTs ?? a.ultimoFixTs;
  await tx.$executeRaw`
    INSERT INTO gps_sesion_resumen (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
    VALUES (${a.sesionId}::uuid, ${a.jornada}::date, ${a.sindicatoId}, 1, ${a.ultimoFixTs}, ${ingreso}, ${LAT}, ${LON}, 5, 0, now())`;
}
