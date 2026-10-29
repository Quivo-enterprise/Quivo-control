/**
 * Tests de `piloto-linea-16.ts`. Correr con:
 *   packages/db/node_modules/.bin/tsx --test scripts/lib/piloto-linea-16.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAnular, fusionarCreds, leerMapaPlacas, parsearReales, reescribirCreds, validarNombreReal, validarPlacaReal, hoyLaPaz, planearRotacion, rangoFechas, sesionesBloqueantes, type AsignacionLike } from './piloto-linea-16.js';

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

test('planearRotacion: estado real (8 pilotos publicados, antes de 38) + 30 nuevos = 150 faltantes sin diferencias', () => {
  const dias = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
  const previos = ['2026-10-26', '2026-10-27', '2026-10-28'];
  const ids = Array.from({ length: 38 }, (_, i) => `V${i}`);
  const existentes = ids.slice(0, 8).flatMap((v, i) => [...(i === 0 ? ['2026-10-13'] : []), ...previos, ...dias].map((f) => as(v, f)));
  // Los 8 originales: piloto 1 estricto (fuera = diferencia) con su rango completo; el resto con `nuevo`.
  const entrada = ids.map((v, i) => i === 0
    ? pil(v, ['2026-10-13', ...previos, ...dias], true)
    : pil(v, i < 8 ? [...previos, ...dias] : dias));
  const plan = planearRotacion(existentes, entrada, RUTA, 'manana');
  assert.equal(plan.porPiloto.reduce((n, p) => n + p.faltan.length, 0), 150);
  assert.equal(plan.hayDiferencias, false);
  assert.equal(plan.ajenas, 0);
  assert.equal(plan.hayFaltantes, true);
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

// ---------------- datos reales ----------------

const TSV = [
  '# comentario',
  '',
  '1616PJA\t1234ABC\tPérez Núñez Juan',
  '1616PJB\t567 def\tRojas Muñoz Diego Cesar\r',
  '1616PKD\t-\t-',
].join('\n');

test('parsearReales: comentarios, blancos, \\r, normaliza placa, desactivar', () => {
  const { filas, errores } = parsearReales(TSV);
  assert.deepEqual(errores, []);
  assert.equal(filas.length, 3);
  assert.equal(filas[1]!.placaReal, '567DEF');
  assert.equal(filas[1]!.linea, 4);
  assert.equal(filas[2]!.accion, 'desactivar');
});

test('parsearReales: duplicados, desconocidos, inválidos', () => {
  const { filas, errores } = parsearReales(
    ['1616PJA\t1234ABC\tAna Lopez', '1616PJB\t1234ABC\tBeto Diaz', '1616PJC\tXX\tCarla Soto', '1616PJD\t111AAA\tDaniel 3', '9999ZZZ\t222BBB\tEva Mar', '1616PJE\t333CCC\tAna Lopez', '1616PJF\t1616PJG\tFelix Gil', '1616PJH\t444DDD'].join('\n'),
  );
  const por = (l: number) => errores.filter((e) => e.linea === l).map((e) => e.motivo).join('|');
  assert.match(por(1), /placa_real repetida/);
  assert.match(por(2), /placa_real repetida/);
  assert.match(por(3), /placa_real/);
  assert.match(por(4), /nombre_real/);
  assert.match(por(5), /piloto conocido/);
  assert.match(por(1) + por(6), /nombre_real repetido/);
  assert.match(por(7), /sintética/);
  assert.match(por(8), /3 columnas/);
  assert.equal(filas.length, 0);
});

test('parsearReales: placa_actual repetida', () => {
  const { errores } = parsearReales('1616PJA\t111AAA\tAna Lopez\n1616PJA\t222BBB\tBeto Diaz');
  assert.equal(errores.length, 2);
  assert.match(errores[0]!.motivo, /placa_actual repetida/);
});

test('validarNombreReal / validarPlacaReal', () => {
  assert.equal(validarNombreReal('  Rojas   Muñoz Diego Cesar ').ok, true);
  assert.equal(validarNombreReal("O'Brien-Soto Ana").ok, true);
  assert.equal(validarNombreReal('Romero Vega Carla G').ok, true);
  assert.equal(validarNombreReal('Romero Vega Carla G.').ok, false); // punto final no permitido
  assert.equal(validarNombreReal('Juan 2').ok, false);
  assert.equal(validarNombreReal('Al').ok, false);
  assert.equal(validarPlacaReal('5360NII').ok, true);
  assert.equal(validarPlacaReal('123-abc').ok, true);
  assert.equal(validarPlacaReal('ABC123').ok, false);
  assert.equal(validarPlacaReal('12ABC').ok, false);
  assert.equal(validarPlacaReal('12А3ABC').ok, false); // homóglifo cirílico
});

test('leerMapaPlacas: mapa y desactivados; lanza si inválido', () => {
  const { mapa, desactivados } = leerMapaPlacas(TSV);
  assert.equal(mapa.get('1616PJA'), '1234ABC');
  assert.deepEqual([...desactivados], ['1616PKD']);
  assert.throws(() => leerMapaPlacas('1616PJA\tmala\tx'));
  assert.throws(() => leerMapaPlacas('1616PJA\t111AAA\tx\n1616PJA\t222BBB\tx'));
});

test('reescribirCreds: conserva PIN y líneas ajenas; idempotente; avisa sin línea', () => {
  const previo = [
    '# Piloto línea 16',
    '1616PJA | Piloto Línea Dieciséis Nueve | pin=43218706',
    '1616PJB | Piloto Línea Dieciséis Diez | pin=11112222',
    '1616PKD | Piloto Línea Dieciséis Treinta y ocho | pin=99998888',
    'pin_vehiculo=12345678',
    'actualizado=2026-10-29T00:00:00.000Z',
    '',
  ].join('\n');
  const ren = [
    { placaActual: '1616PJA', placaReal: '1234ABC', nombreReal: 'Pérez Juan' },
    { placaActual: '1616PJZ', placaReal: '999ZZZ', nombreReal: 'Sin Linea' },
  ];
  const r = reescribirCreds(previo, ren, '2026-10-30T00:00:00.000Z');
  assert.deepEqual(r.sinLinea, ['1616PJZ']);
  const ls = r.texto.split('\n');
  assert.equal(ls[1], '1234ABC | Pérez Juan | pin=43218706');
  assert.equal(ls[2], '1616PJB | Piloto Línea Dieciséis Diez | pin=11112222');
  assert.equal(ls[3], '1616PKD | Piloto Línea Dieciséis Treinta y ocho | pin=99998888');
  assert.equal(ls[4], 'pin_vehiculo=12345678');
  assert.equal(ls[5], 'actualizado=2026-10-30T00:00:00.000Z');
  assert.equal(r.texto.endsWith('\n'), true);
  // Re-correr con la línea ya renombrada: mismo resultado.
  assert.equal(reescribirCreds(r.texto, ren.slice(0, 1), '2026-10-30T00:00:00.000Z').texto, r.texto);
});

test('fusionarCreds reconoce placas reales de 3 dígitos', () => {
  const out = fusionarCreds('567DEF | Ana Lopez | pin=12345678\n', [], '2026-10-30T00:00:00.000Z', 'x');
  assert.match(out, /^567DEF \| Ana Lopez \| pin=12345678$/m);
});

test('leerMapaPlacas: mismas reglas que parsearReales (3 columnas, nombre, colisiones)', () => {
  assert.throws(() => leerMapaPlacas('1616PJA\t1234ABC')); // 2 columnas
  assert.throws(() => leerMapaPlacas('1616PJA\t1234ABC\t')); // nombre vacío
  assert.throws(() => leerMapaPlacas('1616PJA\t-\tX')); // desactivar a medias
  assert.throws(() => leerMapaPlacas('1616PJA\t1234ABC\tAna Paz\n1616PJB\t1234ABC\tLuis Gil')); // placa real repetida
});

test('fusionarCreds: conservarNombre mantiene el nombre real de la línea y cambia el PIN', () => {
  const previo = '1234ABC | Pérez Juan | pin=11111111\n';
  const out = fusionarCreds(previo, [{ placa: '1234ABC', nombre: 'Sintético', pin: '22222222', conservarNombre: true }], 'T', 'P');
  assert.match(out, /^1234ABC \| Pérez Juan \| pin=22222222$/m);
  assert.doesNotMatch(out, /Sintético/);
  // sin línea previa, usa el nombre dado
  assert.match(fusionarCreds('', [{ placa: '1234ABC', nombre: 'Sintético', pin: '22222222', conservarNombre: true }], 'T', 'P'), /Sintético/);
});

test('reescribirCreds: nombreAplicado=false cambia la placa y conserva el nombre de la línea', () => {
  const previo = '1616PJA | Piloto Sintético | pin=43218706\n';
  const r = reescribirCreds(previo, [{ placaActual: '1616PJA', placaReal: '1234ABC', nombreReal: 'Pérez Juan', nombreAplicado: false }], 'T');
  assert.match(r.texto, /^1234ABC \| Piloto Sintético \| pin=43218706$/m);
});
