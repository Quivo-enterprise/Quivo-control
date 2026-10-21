import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { FilaService } from './fila.service.js';
import { ADMIN, LAT, LON, borrarMundo, crearMundo, type MundoSalidas } from './salidas.fixtures.js';

const DENTRO = { lat: LAT, lng: LON, accuracy: 10, tsFix: new Date().toISOString() };

/** Fila por sesión (re-login conserva el lugar) y fila que cruza la medianoche. */
describe('fila de salida: sesión y día', () => {
  let m: MundoSalidas;
  const fila = new FilaService();
  const filasDe = (i: number) =>
    withTenantContext(ADMIN, (tx) => tx.filaSalida.findMany({ where: { vehiculoId: m.a[i]!.vehiculoId }, orderBy: { createdAt: 'asc' } }));

  /** Cierra la sesión del vehículo i y abre otra (re-login / reinstalación). */
  async function reLogin(i: number): Promise<SesionMovilAutenticada> {
    const vieja = m.a[i]!.sesion;
    return withTenantContext(ADMIN, async (tx) => {
      const ses = await tx.sesionOperativa.update({
        where: { id: vieja.sesionId },
        data: { estado: 'cerrada', fin: new Date(), revokedAt: new Date() },
      });
      const nueva = await tx.sesionOperativa.create({
        data: {
          sindicatoId: ses.sindicatoId, asignacionId: ses.asignacionId, conductorId: ses.conductorId, vehiculoId: ses.vehiculoId,
          deviceId: `${ses.deviceId}-b`, accessTokenHash: randomUUID(), refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      return { ...vieja, sesionId: nueva.id, deviceId: nueva.deviceId };
    });
  }

  beforeAll(async () => {
    m = await crearMundo(3);
  });
  afterAll(async () => {
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  it('re-login mientras espera conserva el lugar (misma fila, sesión nueva, mismo llegadaTs)', async () => {
    await fila.registrarLlegada(m.a[0]!.sesion, DENTRO);
    await fila.registrarLlegada(m.a[1]!.sesion, DENTRO);
    const [antes] = await filasDe(0);
    const nueva = await reLogin(0);
    const r = await fila.registrarLlegada(nueva, DENTRO);
    expect(r.fila).toMatchObject({ posicion: 1, total: 2 });
    const despues = await filasDe(0);
    expect(despues).toHaveLength(1);
    expect(despues[0]).toMatchObject({ id: antes!.id, estado: 'en_fila', sesionId: nueva.sesionId });
    expect(despues[0]!.llegadaTs).toEqual(antes!.llegadaTs);
    m.a[0]!.sesion = nueva;
  });

  it('una sesión nueva sin llegada no ve ni puede salir con la fila de la sesión vieja', async () => {
    const nueva = await reLogin(1);
    expect(await fila.estadoMovil(nueva)).toBeNull();
    expect(await fila.registrarSalida(nueva, { origen: 'boton' })).toEqual({ fila: null, anticipada: null });
    expect(await filasDe(1)).toMatchObject([{ estado: 'en_fila' }]);
    m.a[1]!.sesion = nueva;
  });

  it('una fila de ayer sigue visible y se despacha hoy (no vence a medianoche)', async () => {
    const ayer = fechaActualBolivia(new Date(Date.now() - 86_400_000));
    const llegada = new Date(Date.now() - 10 * 60_000);
    const creada = await withTenantContext(ADMIN, (tx) =>
      tx.filaSalida.create({
        data: {
          sindicatoId: m.sindicatoA, puntoControlId: m.pcTerminalA, fecha: ayer,
          sesionId: m.a[2]!.sesion.sesionId, vehiculoId: m.a[2]!.vehiculoId, llegadaTs: llegada, ordenTs: llegada,
        },
      }),
    );
    expect(await fila.estadoMovil(m.a[2]!.sesion)).toMatchObject({ habilitado: true });
    const r = await fila.registrarSalida(m.a[2]!.sesion, { origen: 'boton' });
    expect(r.anticipada).toBe(false);
    const despues = await withTenantContext(ADMIN, (tx) => tx.filaSalida.findUnique({ where: { id: creada.id } }));
    expect(despues).toMatchObject({ estado: 'salio', salidaOrigen: 'boton' });
  });
});
