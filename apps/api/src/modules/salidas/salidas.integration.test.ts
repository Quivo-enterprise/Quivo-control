import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerModule } from '@nestjs/throttler';
import { auth, prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AUDIT_ACCION_KEY, AUDIT_ENTIDAD_KEY } from '../../common/audit/audit.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ZodExceptionFilter } from '../../common/validation/zod-exception.filter.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { VueltasMovilController } from '../vueltas/vueltas-movil.controller.js';
import { VueltasService } from '../vueltas/vueltas.service.js';
import { FilaService } from './fila.service.js';
import { FrecuenciasService } from './frecuencias.service.js';
import { GruposService } from './grupos.service.js';
import { GruposVehiculoController } from './grupos-vehiculo.controller.js';
import { SalidasPanelController } from './salidas-panel.controller.js';
import { ADMIN, LAT, LON, borrarMundo, crearMundo, type MundoSalidas } from './salidas.fixtures.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }])],
  controllers: [SalidasPanelController, GruposVehiculoController],
  providers: [
    FilaService,
    FrecuenciasService,
    GruposService,
    RolesGuard,
    JwtAuthGuard,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
class SalidasTestModule {}

const DENTRO = { lat: LAT, lng: LON, accuracy: 10, tsFix: new Date().toISOString() };
const FUERA = { ...DENTRO, lat: LAT + 0.01 };

describe('fila de salida (API contra Postgres real)', () => {
  let app: NestFastifyApplication;
  let m: MundoSalidas;
  const fila = new FilaService();
  const [uno, dos, tres] = [0, 1, 2];

  const tokenDe = (rol: string, sindicatoId: string | null) => ({
    authorization: `Bearer ${JSON.stringify({ sub: `user-${rol}`, rol, sindicatoId })}`,
  });
  const http = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, rol: string, sind: string | null, payload?: object) =>
    app.inject({ method, url, headers: tokenDe(rol, sind), payload });
  const operadorA = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    http(method, url, 'operador', m.sindicatoA, payload);
  const adminA = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    http(method, url, 'admin_sindicato', m.sindicatoA, payload);
  const adminB = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    http(method, url, 'admin_sindicato', m.sindicatoB, payload);
  const panel = async () => (await operadorA('GET', `/salidas/${m.pcTerminalA}/fila`)).json();
  const itemDe = (p: { items: { id: string; vehiculoId: string }[] }, i: number) => p.items.find((x) => x.vehiculoId === m.a[i]!.vehiculoId);

  beforeAll(async () => {
    m = await crearMundo(4);
    vi.spyOn(auth.api, 'verifyJWT').mockImplementation((async ({ body }: { body: { token: string } }) => ({
      payload: JSON.parse(body.token),
    })) as never);
    app = await NestFactory.create(SalidasTestModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  describe('llegada', () => {
    it('fuera de zona es 422 y con precisión mala también; sin terminal activa es 409', async () => {
      await expect(fila.registrarLlegada(m.a[uno]!.sesion, FUERA)).rejects.toMatchObject({ status: 422 });
      await expect(fila.registrarLlegada(m.a[uno]!.sesion, { ...DENTRO, accuracy: 150 })).rejects.toMatchObject({ status: 422 });
      await withTenantContext(ADMIN, (tx) => tx.$executeRaw`UPDATE puntos_control SET estado = 'inactivo' WHERE id = ${m.pcTerminalA}`);
      await expect(fila.registrarLlegada(m.a[uno]!.sesion, DENTRO)).rejects.toMatchObject({ status: 409 });
      await withTenantContext(ADMIN, (tx) => tx.$executeRaw`UPDATE puntos_control SET estado = 'activo' WHERE id = ${m.pcTerminalA}`);
      const filas = await withTenantContext(ADMIN, (tx) => tx.filaSalida.count({ where: { sindicatoId: m.sindicatoA } }));
      expect(filas).toBe(0);
    });

    it('dentro de la zona entra a la fila (1.º, habilitado); la llegada doble es idempotente', async () => {
      const r1 = await fila.registrarLlegada(m.a[uno]!.sesion, DENTRO);
      expect(r1.fila).toMatchObject({ posicion: 1, total: 1, delantePlaca: null, habilitado: true, demorado: false });
      const antes = await withTenantContext(ADMIN, (tx) => tx.filaSalida.findMany({ where: { vehiculoId: m.a[uno]!.vehiculoId } }));
      const r2 = await fila.registrarLlegada(m.a[uno]!.sesion, DENTRO);
      expect(r2.fila).toMatchObject({ posicion: 1, total: 1 });
      const despues = await withTenantContext(ADMIN, (tx) => tx.filaSalida.findMany({ where: { vehiculoId: m.a[uno]!.vehiculoId } }));
      expect(despues).toHaveLength(1);
      expect(despues[0]!.llegadaTs).toEqual(antes[0]!.llegadaTs);
      expect(despues[0]).toMatchObject({ sindicatoId: m.sindicatoA, puntoControlId: m.pcTerminalA, sesionId: m.a[uno]!.sesion.sesionId });
    });

    it('dos llegadas casi simultáneas quedan ordenadas por la hora del servidor', async () => {
      await Promise.all([fila.registrarLlegada(m.a[dos]!.sesion, DENTRO), fila.registrarLlegada(m.a[tres]!.sesion, DENTRO)]);
      const p = await panel();
      expect(p.items.map((x: { posicion: number }) => x.posicion)).toEqual([1, 2, 3]);
      const orden = [...p.items].sort((a: { llegadaTs: string }, b: { llegadaTs: string }) => a.llegadaTs.localeCompare(b.llegadaTs));
      expect(orden.map((x: { id: string }) => x.id)).toEqual(p.items.map((x: { id: string }) => x.id));
      expect(p.items[0].vehiculoId).toBe(m.a[uno]!.vehiculoId);
      // Quién gana la carrera lo decide el servidor: los tests siguientes llaman "dos" al que quedó 2.º.
      if (p.items[1].vehiculoId === m.a[tres]!.vehiculoId) [m.a[dos], m.a[tres]] = [m.a[tres]!, m.a[dos]!];
    });
  });

  describe('salida y panel', () => {
    it('base 5 min (operador): GET reglas la devuelve y un chofer en turno sale sin marca de anticipada', async () => {
      expect((await operadorA('PUT', `/salidas/${m.pcTerminalA}/base`, { frecuenciaSalidaMin: 5 })).statusCode).toBe(200);
      const reglas = (await operadorA('GET', `/salidas/${m.pcTerminalA}/reglas`)).json();
      expect(reglas).toMatchObject({ puntoControlId: m.pcTerminalA, baseMin: 5, reglas: [] });
      const s = await fila.registrarSalida(m.a[uno]!.sesion, { origen: 'boton' });
      expect(s).toEqual({ fila: null, anticipada: false });
      // Idempotente: sin fila abierta es 200 con `fila: null`.
      expect(await fila.registrarSalida(m.a[uno]!.sesion, { origen: 'boton' })).toEqual({ fila: null, anticipada: null });
    });

    it('vuelta-actual trae `fila` coherente: el 2.º ahora es 1.º pero espera la frecuencia', async () => {
      const vueltas = new VueltasMovilController(new VueltasService(), fila);
      const dosEstado = await vueltas.obtener(m.a[dos]!.sesion);
      expect(dosEstado.fila).toMatchObject({ posicion: 1, total: 2, delantePlaca: null, habilitado: false, demorado: false });
      expect(dosEstado.fila!.esperaMs).toBeGreaterThan(4 * 60_000);
      expect(dosEstado.fila!.esperaMs).toBeLessThanOrEqual(5 * 60_000);
      expect(Date.parse(dosEstado.fila!.servidorTs)).toBeGreaterThan(Date.now() - 5_000);
      const tresEstado = await vueltas.obtener(m.a[tres]!.sesion);
      expect(tresEstado.fila).toMatchObject({ posicion: 2, total: 2, delantePlaca: m.a[dos]!.placa });
      // Fuera de la fila: campo `fila` en null.
      expect((await vueltas.obtener(m.a[uno]!.sesion)).fila).toBeNull();
    });

    it('salir antes de su hora queda como anticipada', async () => {
      const s = await fila.registrarSalida(m.a[dos]!.sesion, { origen: 'geocerca' });
      expect(s.anticipada).toBe(true);
      const filaDb = await withTenantContext(ADMIN, (tx) => tx.filaSalida.findFirst({ where: { vehiculoId: m.a[dos]!.vehiculoId } }));
      expect(filaDb).toMatchObject({ estado: 'salio', salidaOrigen: 'geocerca', anticipada: true });
    });

    it('panel: despachar (anticipada calculada), mover al final y retirar; repetir da 409 y un id ajeno 404', async () => {
      await fila.registrarLlegada(m.a[uno]!.sesion, DENTRO); // vuelve a la fila detrás del 3.º
      let p = await panel();
      expect(p.items.map((x: { vehiculoId: string }) => x.vehiculoId)).toEqual([m.a[tres]!.vehiculoId, m.a[uno]!.vehiculoId]);
      expect(p.salidasRecientes).toHaveLength(2);
      const tresItem = itemDe(p, tres)!;
      const base = `/salidas/${m.pcTerminalA}/fila`;

      expect((await operadorA('POST', `${base}/${tresItem.id}/mover-al-final`)).statusCode).toBe(200);
      p = await panel();
      expect(p.items.map((x: { vehiculoId: string }) => x.vehiculoId)).toEqual([m.a[uno]!.vehiculoId, m.a[tres]!.vehiculoId]);

      const despacho = await operadorA('POST', `${base}/${itemDe(p, uno)!.id}/despachar`);
      expect(despacho.statusCode).toBe(200);
      const despachada = await withTenantContext(ADMIN, (tx) => tx.filaSalida.findUnique({ where: { id: itemDe(p, uno)!.id } }));
      // El 1.º aún no cumplía la frecuencia tras la última salida: despachar antes de tiempo es anticipada.
      expect(despachada).toMatchObject({ estado: 'salio', salidaOrigen: 'panel', anticipada: true });
      expect((await operadorA('POST', `${base}/${itemDe(p, uno)!.id}/despachar`)).statusCode).toBe(409);

      expect((await operadorA('POST', `${base}/${tresItem.id}/retirar`)).statusCode).toBe(200);
      expect((await panel()).items).toHaveLength(0);
      expect((await operadorA('POST', `${base}/${randomUUID()}/retirar`)).statusCode).toBe(404);
    });
  });

  describe('reglas y grupos', () => {
    it('regla con franja que contiene la hora: acorta la espera; anular la deja sin efecto', async () => {
      await fila.registrarLlegada(m.a[dos]!.sesion, DENTRO); // nueva fila; el último en salir fue el panel hace instantes
      const esperaDe = async () => (await new VueltasMovilController(new VueltasService(), fila).obtener(m.a[dos]!.sesion)).fila!.esperaMs;
      expect(await esperaDe()).toBeGreaterThan(4 * 60_000);
      const crear = await operadorA('POST', `/salidas/${m.pcTerminalA}/reglas`, { alcance: 'todos', minutos: 1, desdeMin: 0, hastaMin: 1440 });
      expect(crear.statusCode).toBe(201);
      const regla = crear.json();
      expect(regla).toMatchObject({ alcance: 'todos', minutos: 1, creadaPor: 'user-operador', sindicatoId: m.sindicatoA });
      expect(await esperaDe()).toBeLessThanOrEqual(60_000);
      expect((await operadorA('GET', `/salidas/${m.pcTerminalA}/reglas`)).json().reglas).toHaveLength(1);

      expect((await operadorA('DELETE', `/salidas/${m.pcTerminalA}/reglas/${regla.id}`)).statusCode).toBe(200);
      expect(await esperaDe()).toBeGreaterThan(4 * 60_000);
      expect((await operadorA('GET', `/salidas/${m.pcTerminalA}/reglas`)).json().reglas).toHaveLength(0);
      const anulada = await withTenantContext(ADMIN, (tx) => tx.frecuenciaRegla.findUnique({ where: { id: regla.id } }));
      expect(anulada).toMatchObject({ anuladaPor: 'user-operador' });
      expect(anulada!.anuladaEn).not.toBeNull();
    });

    it('validación del body de la regla (400) y fecha/creadaEn/sindicato los pone el servidor', async () => {
      expect((await operadorA('POST', `/salidas/${m.pcTerminalA}/reglas`, { alcance: 'grupo', minutos: 3 })).statusCode).toBe(400);
      expect((await operadorA('POST', `/salidas/${m.pcTerminalA}/reglas`, { alcance: 'todos', minutos: 500 })).statusCode).toBe(400);
      const r = await operadorA('POST', `/salidas/${m.pcTerminalA}/reglas`, {
        alcance: 'todos', minutos: 3, sindicatoId: m.sindicatoB, fecha: '2020-01-01', creadaEn: '2020-01-01T00:00:00Z',
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ sindicatoId: m.sindicatoA });
      expect(r.json().fecha).not.toBe('2020-01-01');
      await operadorA('DELETE', `/salidas/${m.pcTerminalA}/reglas/${r.json().id}`);
    });

    it('roles: el operador maneja fila y reglas pero NO los grupos (403); el admin del sindicato sí', async () => {
      expect((await operadorA('GET', '/grupos-vehiculo')).statusCode).toBe(403);
      expect((await operadorA('POST', '/grupos-vehiculo', { nombre: 'X' })).statusCode).toBe(403);
      expect((await operadorA('PATCH', `/grupos-vehiculo/${randomUUID()}`, { nombre: 'X' })).statusCode).toBe(403);
      const g = await adminA('POST', '/grupos-vehiculo', { nombre: 'Rápidos', vehiculoIds: [m.a[tres]!.vehiculoId] });
      expect(g.statusCode).toBe(201);
      expect(g.json()).toMatchObject({ nombre: 'Rápidos', estado: 'activo', vehiculoIds: [m.a[tres]!.vehiculoId] });
      expect((await adminA('GET', '/grupos-vehiculo')).json()).toHaveLength(1);
      expect((await adminB('GET', '/grupos-vehiculo')).json()).toHaveLength(0);
    });

    it('un trufi en un solo grupo (409), miembros ajenos y grupos ajenos dan el mismo 404', async () => {
      const grupos = (await adminA('GET', '/grupos-vehiculo')).json();
      const g1 = grupos[0].id;
      // Ya está en g1 desde la creación.
      const g2 = (await adminA('POST', '/grupos-vehiculo', { nombre: 'Otro' })).json();
      expect((await adminA('POST', `/grupos-vehiculo/${g2.id}/miembros`, { vehiculoId: m.a[tres]!.vehiculoId })).statusCode).toBe(409);
      expect((await adminA('POST', '/grupos-vehiculo', { nombre: 'Dup', vehiculoIds: [m.a[tres]!.vehiculoId] })).statusCode).toBe(409);
      // Agregar al mismo grupo es idempotente.
      expect((await adminA('POST', `/grupos-vehiculo/${g1}/miembros`, { vehiculoId: m.a[tres]!.vehiculoId })).statusCode).toBe(201);
      // Carrera: el mismo trufi a dos grupos a la vez ⇒ uno entra y el otro recibe 409 (nunca dos 201).
      const g3 = (await adminA('POST', '/grupos-vehiculo', { nombre: 'Carrera' })).json();
      const carrera = await Promise.all(
        [g2.id, g3.id].map((g) => adminA('POST', `/grupos-vehiculo/${g}/miembros`, { vehiculoId: m.a[uno]!.vehiculoId })),
      );
      expect(carrera.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      // Vehículo de B: igual que uno inexistente.
      const ajeno = await adminA('POST', `/grupos-vehiculo/${g2.id}/miembros`, { vehiculoId: m.vehiculoB });
      const inexistente = await adminA('POST', `/grupos-vehiculo/${g2.id}/miembros`, { vehiculoId: randomUUID() });
      expect([ajeno.statusCode, inexistente.statusCode]).toEqual([404, 404]);
      expect(ajeno.json().message).toBe(inexistente.json().message);
      expect((await adminA('POST', '/grupos-vehiculo', { nombre: 'Ajeno', vehiculoIds: [m.vehiculoB] })).statusCode).toBe(404);
      // Grupo de A visto desde B.
      expect((await adminB('PATCH', `/grupos-vehiculo/${g1}`, { nombre: 'Hack' })).statusCode).toBe(404);
      expect((await adminB('POST', `/grupos-vehiculo/${g1}/miembros`, { vehiculoId: m.vehiculoB })).statusCode).toBe(404);
      // Reglas: vehículo/grupo de otro sindicato.
      const gB = (await adminB('POST', '/grupos-vehiculo', { nombre: 'De B' })).json();
      const reglasUrl = `/salidas/${m.pcTerminalA}/reglas`;
      expect((await adminA('POST', reglasUrl, { alcance: 'vehiculo', vehiculoId: m.vehiculoB, minutos: 2 })).statusCode).toBe(404);
      expect((await adminA('POST', reglasUrl, { alcance: 'vehiculo', vehiculoId: randomUUID(), minutos: 2 })).statusCode).toBe(404);
      expect((await adminA('POST', reglasUrl, { alcance: 'grupo', grupoId: gB.id, minutos: 2 })).statusCode).toBe(404);
      // admin_quivo ve todo bajo RLS, pero la regla igual exige mismo sindicato que la terminal.
      expect((await http('POST', reglasUrl, 'admin_quivo', null, { alcance: 'grupo', grupoId: gB.id, minutos: 2 })).statusCode).toBe(404);
      expect((await http('POST', reglasUrl, 'admin_quivo', null, { alcance: 'todos', minutos: 2 })).json().sindicatoId).toBe(m.sindicatoA);
    });

    it('regla por grupo cuenta mientras el grupo está activo y se ignora si pasa a inactivo', async () => {
      const g1 = (await adminA('GET', '/grupos-vehiculo')).json().find((g: { nombre: string }) => g.nombre === 'Rápidos').id;
      // Vacía la fila y deja solo al 3.º (miembro de g1); las reglas "todos" previas se anulan.
      for (const r of (await operadorA('GET', `/salidas/${m.pcTerminalA}/reglas`)).json().reglas) {
        await operadorA('DELETE', `/salidas/${m.pcTerminalA}/reglas/${r.id}`);
      }
      for (const i of (await panel()).items) await operadorA('POST', `/salidas/${m.pcTerminalA}/fila/${i.id}/retirar`);
      await fila.registrarLlegada(m.a[tres]!.sesion, DENTRO);
      const esperaTres = async () => (await fila.estadoMovil(m.a[tres]!.sesion))!.esperaMs;
      expect(await esperaTres()).toBeGreaterThan(4 * 60_000);
      const regla = await adminA('POST', `/salidas/${m.pcTerminalA}/reglas`, { alcance: 'grupo', grupoId: g1, minutos: 1 });
      expect(regla.statusCode).toBe(201);
      expect(await esperaTres()).toBeLessThanOrEqual(60_000);
      expect((await adminA('PATCH', `/grupos-vehiculo/${g1}`, { estado: 'inactivo' })).statusCode).toBe(200);
      expect(await esperaTres()).toBeGreaterThan(4 * 60_000);
      // Una regla nueva sobre un grupo inactivo se rechaza.
      expect((await adminA('POST', `/salidas/${m.pcTerminalA}/reglas`, { alcance: 'grupo', grupoId: g1, minutos: 2 })).statusCode).toBe(422);
      // Quitar al miembro es idempotente.
      expect((await adminA('DELETE', `/grupos-vehiculo/${g1}/miembros/${m.a[tres]!.vehiculoId}`)).json().vehiculoIds).toEqual([]);
      expect((await adminA('DELETE', `/grupos-vehiculo/${g1}/miembros/${m.a[tres]!.vehiculoId}`)).statusCode).toBe(200);
    });
  });

  describe('aislamiento entre sindicatos y terminales', () => {
    it('el admin de otro sindicato no ve ni toca la terminal ajena (404); admin_quivo sí la ve', async () => {
      const ids = (await panel()).items;
      const filaId = ids[0]?.id ?? randomUUID();
      const url = `/salidas/${m.pcTerminalA}`;
      expect((await adminB('GET', `${url}/fila`)).statusCode).toBe(404);
      expect((await adminB('GET', `${url}/reglas`)).statusCode).toBe(404);
      expect((await adminB('POST', `${url}/fila/${filaId}/despachar`)).statusCode).toBe(404);
      expect((await adminB('POST', `${url}/reglas`, { alcance: 'todos', minutos: 2 })).statusCode).toBe(404);
      expect((await adminB('PUT', `${url}/base`, { frecuenciaSalidaMin: 99 })).statusCode).toBe(404);
      expect((await http('GET', `${url}/fila`, 'admin_quivo', null)).statusCode).toBe(200);
      const base = await withTenantContext(ADMIN, (tx) => tx.puntoControl.findUnique({ where: { id: m.pcTerminalA }, select: { frecuenciaSalidaMin: true } }));
      expect(base?.frecuenciaSalidaMin).toBe(5);
    });

    it('un PC que no es terminal es 422 y el id desconocido 404; la base valida el rango', async () => {
      expect((await operadorA('GET', `/salidas/${m.pcRetornoA}/fila`)).statusCode).toBe(422);
      expect((await operadorA('GET', `/salidas/${randomUUID()}/fila`)).statusCode).toBe(404);
      // Id mal formado: 400 de la validación de ruta, no un 500 por el cast a uuid.
      expect((await operadorA('GET', '/salidas/no-es-uuid/fila')).statusCode).toBe(400);
      expect((await operadorA('POST', `/salidas/${m.pcTerminalA}/fila/xyz/despachar`)).statusCode).toBe(400);
      expect((await adminA('PATCH', '/grupos-vehiculo/xyz', { nombre: 'X' })).statusCode).toBe(400);
      expect((await operadorA('PUT', `/salidas/${m.pcTerminalA}/base`, { frecuenciaSalidaMin: 0 })).statusCode).toBe(400);
      expect((await operadorA('PUT', `/salidas/${m.pcTerminalA}/base`, { frecuenciaSalidaMin: null })).statusCode).toBe(200);
      expect((await operadorA('GET', `/salidas/${m.pcTerminalA}/reglas`)).json().baseMin).toBeNull();
    });

    it('las mutaciones llevan @Auditable', () => {
      const p = SalidasPanelController.prototype;
      expect(Reflect.getMetadata(AUDIT_ENTIDAD_KEY, p.despachar)).toBe('fila_salida');
      expect(Reflect.getMetadata(AUDIT_ACCION_KEY, p.despachar)).toBe('despachar');
      expect(Reflect.getMetadata(AUDIT_ENTIDAD_KEY, p.crearRegla)).toBe('frecuencia_regla');
      expect(Reflect.getMetadata(AUDIT_ENTIDAD_KEY, GruposVehiculoController.prototype.crear)).toBe('grupo_vehiculo');
    });
  });
});
