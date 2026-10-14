/**
 * Tests de `piloto-linea-16.ts`. Correr con:
 *   packages/db/node_modules/.bin/tsx --test scripts/lib/piloto-linea-16.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAnular, fusionarCreds, hoyLaPaz, planearRotacion, rangoFechas, sesionesBloqueantes, type AsignacionLike } from './piloto-linea-16.js';

const RUTA = 'ruta-1';
const as = (vehiculoId: string, fecha: string, conductorId: string | null = `c-${vehiculoId}`, extra: Partial<AsignacionLike> = {}): AsignacionLike => ({
  vehiculoId,
  conductorId,
  rutaId: RUTA,
  fecha: `${fecha}T00:00:00.000Z`,
  horario: 'manana',
  ...extra,
});

test('hoyLaPaz: UTC-4', () => {
  assert.equal(hoyLaPaz(new Date('2026-10-15T02:00:00Z')), '2026-10-14');
  assert.equal(hoyLaPaz(new Date('2026-10-14T03:59:59Z')), '2026-10-13');
  assert.equal(hoyLaPaz(new Date('2026-10-14T04:00:00Z')), '2026-10-14');
  assert.equal(hoyLaPaz(new Date('2026-10-14T23:59:00Z')), '2026-10-14');
});

test('rangoFechas', () => {
  assert.deepEqual(rangoFechas('2026-10-30', '2026-11-02', 60), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.throws(() => rangoFechas('2026-10-27', '2026-10-26', 60));
  assert.throws(() => rangoFechas('2026-02-30', '2026-03-01', 60));
  assert.throws(() => rangoFechas('2026-01-01', '2026-12-31', 60));
});

const fechas = ['2026-10-14', '2026-10-15'];
const pil = (vehiculoId: string | undefined, f = fechas, estricto = false) => ({ vehiculoId, conductorId: vehiculoId ? `c-${vehiculoId}` : undefined, fechas: f, fueraEsDiferencia: estricto });

test('planearRotacion: faltantes de los nuevos, piloto 1 completo', () => {
  const existentes = [as('A', '2026-10-14'), as('A', '2026-10-15'), as('B', '2026-10-14')];
  const plan = planearRotacion(existentes, [pil('A', fechas, true), pil('B'), pil(undefined)], RUTA, 'manana');
  assert.deepEqual(plan.porPiloto[0]!.faltan, []);
  assert.deepEqual(plan.porPiloto[1]!.faltan, ['2026-10-15']);
  assert.deepEqual(plan.porPiloto[2]!.faltan, fechas);
  assert.equal(plan.hayFaltantes, true);
  assert.equal(plan.hayDiferencias, false);
  assert.equal(plan.ajenas, 0);
});

test('planearRotacion: diferencias (conductor, ruta, horario, ajenas, fuera estricto)', () => {
  const plan = planearRotacion(
    [as('A', '2026-10-14', 'otro'), as('A', '2026-10-15', 'c-A', { rutaId: 'x' }), as('Z', '2026-10-14')],
    [pil('A')],
    RUTA,
    'manana',
  );
  assert.equal(plan.hayDiferencias, true);
  assert.equal(plan.ajenas, 1);
  assert.equal(plan.porPiloto[0]!.diferencias.length, 2);
  const h = planearRotacion([as('A', '2026-10-14', 'c-A', { horario: 'tarde' }), as('A', '2026-10-15')], [pil('A')], RUTA, 'manana');
  assert.match(h.porPiloto[0]!.diferencias[0]!, /horario/);
  const noEstricto = planearRotacion([as('A', '2026-10-13'), ...fechas.map((f) => as('A', f))], [pil('A')], RUTA, 'manana');
  assert.equal(noEstricto.hayDiferencias, false);
  assert.deepEqual(noEstricto.porPiloto[0]!.fuera, ['2026-10-13']);
  const estricto = planearRotacion([as('A', '2026-10-13'), ...fechas.map((f) => as('A', f))], [pil('A', fechas, true)], RUTA, 'manana');
  assert.equal(estricto.hayDiferencias, true);
});

test('planearRotacion: conductor del piloto aún inexistente con asignación existente = diferencia', () => {
  const plan = planearRotacion([as('A', '2026-10-14')], [{ vehiculoId: 'A', conductorId: undefined, fechas, fueraEsDiferencia: false }], RUTA, 'manana');
  assert.equal(plan.hayDiferencias, true);
});

const base = { hayFaltantes: true, hayDiferencias: false, sesionesActivas: 0, forzar: false };

test('decidirAnular', () => {
  assert.equal(decidirAnular({ ...base, estado: null }).accion, 'crear');
  assert.equal(decidirAnular({ ...base, estado: 'borrador', hayDiferencias: true }).accion, 'completar_borrador');
  assert.equal(decidirAnular({ ...base, estado: 'borrador', hayFaltantes: false }).accion, 'completar_borrador');
  assert.equal(decidirAnular({ ...base, estado: 'publicada' }).accion, 'anular');
  assert.equal(decidirAnular({ ...base, estado: 'publicada', hayFaltantes: false }).accion, 'sin_cambios');
  assert.equal(decidirAnular({ ...base, estado: 'publicada', hayDiferencias: true }).accion, 'abortar_difiere');
  assert.equal(decidirAnular({ ...base, estado: 'publicada', hayDiferencias: true, hayFaltantes: false }).accion, 'abortar_difiere');
  assert.equal(decidirAnular({ ...base, estado: 'publicada', sesionesActivas: 1 }).accion, 'abortar_sesion_activa');
  assert.equal(decidirAnular({ ...base, estado: 'publicada', sesionesActivas: 1, forzar: true }).accion, 'anular');
  // sin faltantes no anula aunque haya sesión activa
  assert.equal(decidirAnular({ ...base, estado: 'publicada', hayFaltantes: false, sesionesActivas: 2 }).accion, 'sin_cambios');
});

test('sesionesBloqueantes', () => {
  const s = (activa: boolean, vehiculoPlaca: string, estadoFrescura: string) => ({ activa, vehiculoPlaca, estadoFrescura });
  const r = sesionesBloqueantes(
    [s(true, '1616PIL', 'reportando'), s(true, '1616pib', 'detenido'), s(true, '1616PIC', 'perdido'), s(true, '1616PIL', 'finalizado'), s(false, '1616PIL', 'reportando'), s(true, '9999ZZZ', 'reportando')],
    ['1616PIL', '1616PIB', '1616PIC'],
  );
  assert.equal(r.length, 2);
});

test('fusionarCreds: archivo vacío, nuevos pilotos ordenados', () => {
  const out = fusionarCreds('', [{ placa: '1616PIC', nombre: 'Charlie', pin: '22222222' }, { placa: '1616PIB', nombre: 'Bravo', pin: '11111111' }], 'T', 'Piloto');
  assert.match(out, /1616PIB \| Bravo \| pin=11111111\n1616PIC \| Charlie \| pin=22222222\nactualizado=T\n$/);
});

test('fusionarCreds: migra el formato legado sin perder el PIN y agrega sin pisar', () => {
  const legado = '# Piloto línea 16 — credenciales móviles\nplaca=1616PIL\npin_conductor=12345678\nactualizado=2026-10-13T00:00:00.000Z\n';
  const out = fusionarCreds(legado, [{ placa: '1616PIB', nombre: 'Bravo', pin: '11111111' }], 'T', 'Piloto Línea Dieciséis');
  assert.match(out, /1616PIL \| Piloto Línea Dieciséis \| pin=12345678/);
  assert.match(out, /1616PIB \| Bravo \| pin=11111111/);
  assert.ok(!out.includes('placa=') && !out.includes('pin_conductor='));
  assert.ok(!out.includes('2026-10-13'));
  // idempotente: re-fusionar sin nuevos conserva todo
  const otra = fusionarCreds(out, [], 'T2', 'Piloto Línea Dieciséis');
  assert.match(otra, /1616PIL \| .* pin=12345678/);
  assert.match(otra, /1616PIB \| .* pin=11111111/);
});

test('fusionarCreds: un PIN nuevo reemplaza solo su placa; extras', () => {
  const previo = fusionarCreds('', [{ placa: '1616PIB', nombre: 'B', pin: '11111111' }, { placa: '1616PIC', nombre: 'C', pin: '22222222' }], 'T', 'P');
  const out = fusionarCreds(previo, [{ placa: '1616PIB', nombre: 'B', pin: '33333333' }], 'T', 'P', { pin_vehiculo: '44444444' });
  assert.match(out, /1616PIB \| B \| pin=33333333/);
  assert.match(out, /1616PIC \| C \| pin=22222222/);
  assert.match(out, /pin_vehiculo=44444444/);
});
