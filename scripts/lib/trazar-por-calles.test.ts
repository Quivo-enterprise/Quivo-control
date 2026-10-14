/**
 * Tests de las funciones puras de `trazar-por-calles.ts`. Runner: `node:test` vía tsx (sin
 * dependencias nuevas; los scripts no son un paquete del monorepo). Correr con:
 *   packages/db/node_modules/.bin/tsx --test scripts/lib/trazar-por-calles.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarBodyRoutes,
  decodificarPolyline,
  desvioMaximo,
  distanciaM,
  longitudM,
  primerEspolon,
  remuestrear,
  rumboInicial,
  trocear,
  unirTrozos,
  type Coord,
  type Muestra,
} from './trazar-por-calles.js';

const ORIGEN: Coord = [-66.16, -17.39];

test('rumboInicial: N/E/S/W', () => {
  assert.equal(rumboInicial(ORIGEN, [-66.16, -17.38]), 0);
  assert.equal(rumboInicial(ORIGEN, [-66.15, -17.39]), 90);
  assert.equal(rumboInicial(ORIGEN, [-66.16, -17.4]), 180);
  assert.equal(rumboInicial(ORIGEN, [-66.17, -17.39]), 270);
});

test('rumboInicial: siempre en 0–359 (noroeste casi al norte no da 360)', () => {
  const r = rumboInicial(ORIGEN, [-66.160001, -17.3]);
  assert.ok(r >= 0 && r <= 359);
  assert.equal(r, 0);
});

// Línea recta de ~2 km hacia el este.
const RECTA: Coord[] = [ORIGEN, [-66.1423, -17.39]];

test('remuestrear: conserva extremos y espacia ~250 m', () => {
  const total = longitudM(RECTA);
  const m = remuestrear(RECTA, 250);
  assert.deepEqual(m[0]!.coord, RECTA[0]);
  assert.deepEqual(m[m.length - 1]!.coord, RECTA[1]);
  for (let i = 1; i < m.length - 1; i++) {
    assert.ok(Math.abs(distanciaM(m[i - 1]!.coord, m[i]!.coord) - 250) < 2, `salto ${i}`);
  }
  assert.ok(distanciaM(m[m.length - 2]!.coord, m[m.length - 1]!.coord) >= 125 - 2);
  assert.equal(m.length, Math.round(total / 250) + 1);
  assert.ok(m.every((x) => x.rumbo === 90));
});

test('remuestrear: rumbo local sigue el sentido del tramo (invertido => 270)', () => {
  const m = remuestrear([...RECTA].reverse(), 250);
  assert.ok(m.every((x) => x.rumbo === 270));
});

test('remuestrear: polilínea corta devuelve solo los dos extremos; esquina cambia el rumbo', () => {
  assert.equal(remuestrear([ORIGEN, [-66.1599, -17.39]], 250).length, 2);
  const L: Coord[] = [ORIGEN, [-66.1423, -17.39], [-66.1423, -17.37]];
  const m = remuestrear(L, 250);
  assert.equal(m[1]!.rumbo, 90);
  assert.equal(m[m.length - 2]!.rumbo, 0);
  assert.equal(m[m.length - 1]!.rumbo, 0);
});

function muestras(n: number): Muestra[] {
  return Array.from({ length: n }, (_, i) => ({ coord: [-66 + i * 0.001, -17] as Coord, rumbo: 90 }));
}

test('trocear: 60 muestras => 3 requests encadenados, ≤25 intermedios', () => {
  const ms = muestras(60);
  const reqs = trocear(ms);
  assert.equal(reqs.length, 3);
  assert.ok(reqs.every((r) => r.intermedios.length <= 25));
  assert.equal(reqs[0]!.origen, ms[0]);
  assert.equal(reqs[2]!.destino, ms[59]);
  for (let i = 1; i < reqs.length; i++) assert.equal(reqs[i]!.origen, reqs[i - 1]!.destino);
  const cubiertas = reqs.reduce((s, r) => s + r.intermedios.length + 1, 1);
  assert.equal(cubiertas, 60);
});

test('trocear: 2 muestras => 1 request sin intermedios; 27 => 1 request; 28 => 2', () => {
  assert.equal(trocear(muestras(2)).length, 1);
  assert.equal(trocear(muestras(2))[0]!.intermedios.length, 0);
  assert.equal(trocear(muestras(27)).length, 1);
  assert.equal(trocear(muestras(28)).length, 2);
  assert.throws(() => trocear(muestras(1)));
});

test('decodificarPolyline: ejemplo oficial de Google', () => {
  const c = decodificarPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(c.length, 3);
  const esperado: Coord[] = [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]];
  c.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - esperado[i]![0]) < 1e-9 && Math.abs(p[1] - esperado[i]![1]) < 1e-9, `punto ${i}: ${p}`);
  });
  assert.throws(() => decodificarPolyline('_p~iF~ps|U_ulL'.slice(0, 7)));
});

test('unirTrozos: no duplica el punto de empalme', () => {
  const a: Coord[] = [[0, 0], [1, 0]];
  const b: Coord[] = [[1, 0], [2, 0]];
  const c: Coord[] = [[2.0000001, 0], [3, 0]];
  assert.deepEqual(unirTrozos([a, b, c]), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  // Sin empalme (distinto punto): se conservan todos.
  assert.equal(unirTrozos([[[0, 0]], [[1, 1]]]).length, 2);
});

test('desvioMaximo: polilíneas idénticas => 0; paralela a ~111 m => ~111 m; ambos sentidos', () => {
  const a: Coord[] = [[-66.16, -17.39], [-66.15, -17.39]];
  assert.equal(Math.round(desvioMaximo(a, a).maxM), 0);
  const b: Coord[] = [[-66.16, -17.389], [-66.15, -17.389]];
  assert.ok(Math.abs(desvioMaximo(a, b).maxM - 111.2) < 1);
  // b→a: un desvío en un vértice del segundo que no se ve desde el primero.
  const c: Coord[] = [[-66.16, -17.39], [-66.155, -17.386], [-66.15, -17.39]];
  const d = desvioMaximo(a, c);
  assert.equal(d.sentido, 'b→a');
  assert.deepEqual(d.coord, c[1]);
  assert.ok(d.maxM > 400 && d.maxM < 460);
});

test('armarBodyRoutes: heading en origen/destino/intermedios, via solo en intermedios', () => {
  const [o, i, d] = muestras(3);
  const body = armarBodyRoutes({ origen: o!, intermedios: [i!], destino: d! }) as Record<string, any>;
  assert.equal(body.travelMode, 'DRIVE');
  assert.equal(body.routingPreference, 'TRAFFIC_UNAWARE');
  assert.equal(body.polylineQuality, 'HIGH_QUALITY');
  assert.equal(body.origin.location.heading, 90);
  assert.equal(body.destination.location.heading, 90);
  assert.equal(body.intermediates[0].via, true);
  assert.equal(body.intermediates[0].location.heading, 90);
  assert.equal(body.origin.via, undefined);
});

test('remuestrear: en un lazo cerrado (giro acumulado alto) omite las muestras interiores; extremos intactos', () => {
  // Cuadrado de ~60 m de lado recorrido dos veces: giro enorme en cualquier ventana de ±100 m.
  const d = 0.00054;
  const sq: Coord[] = [ORIGEN, [ORIGEN[0] + d, ORIGEN[1]], [ORIGEN[0] + d, ORIGEN[1] + d], [ORIGEN[0], ORIGEN[1] + d], ORIGEN];
  const lazo: Coord[] = [...sq, ...sq.slice(1), ...sq.slice(1)];
  const m = remuestrear(lazo, 50);
  assert.deepEqual(m[0]!.coord, lazo[0]);
  assert.deepEqual(m[m.length - 1]!.coord, lazo[lazo.length - 1]);
  assert.equal(m.length, 2);
});

test('remuestrear: muestra con giro brusco local va sin rumbo (null)', () => {
  // Quiebre de 90° justo en la muestra de los 250 m (no hay giro acumulado alto en ±100 m).
  const a: Coord = [-66.16, -17.39];
  const medio: Coord = [-66.16 + 250 / (111320 * Math.cos(17.39 * Math.PI / 180)), -17.39];
  const b: Coord = [medio[0], -17.39 + 0.01];
  const m = remuestrear([a, medio, b], 250);
  assert.equal(m[1]!.rumbo, null);
  assert.equal(m[0]!.rumbo, 90);
});

test('primerEspolon: ida y vuelta por la misma calle se detecta; trazado simple no', () => {
  const recto: Coord[] = Array.from({ length: 40 }, (_, i) => [-66.16 + i * 0.0002, -17.39] as Coord); // ~ 850 m
  assert.equal(primerEspolon(recto), null);
  const conEspolon: Coord[] = [...recto.slice(0, 20), ...recto.slice(10, 20).reverse(), ...recto.slice(10)];
  const e = primerEspolon(conEspolon);
  assert.ok(e !== null);
  assert.ok(e![0] >= recto[10]![0] && e![0] <= recto[19]![0]);
});

test('primerEspolon con boceto: un ir y volver que el boceto dibuja no cuenta; uno fuera del boceto sí', () => {
  const recto: Coord[] = Array.from({ length: 40 }, (_, i) => [-66.16 + i * 0.0002, -17.39] as Coord);
  // El espolón sigue sobre el propio boceto (que llega hasta el final y vuelve).
  const bocetoIdaVuelta: Coord[] = [...recto, ...recto.slice().reverse()];
  const traz: Coord[] = [...recto, ...recto.slice().reverse()];
  assert.equal(primerEspolon(traz, bocetoIdaVuelta), null);
  // Espolón hacia el norte (~220 m, ida y vuelta por la misma calle) que el boceto recto no tiene.
  const puente: Coord[] = [recto[19]!, ...[1, 2].map((k) => [recto[19]![0], recto[19]![1] + k * 0.001] as Coord), ...[2, 1].map((k) => [recto[19]![0], recto[19]![1] + k * 0.001] as Coord), recto[19]!];
  const trazado: Coord[] = [...recto.slice(0, 19), ...puente, ...recto.slice(20)];
  assert.ok(primerEspolon(trazado, recto) !== null);
});
