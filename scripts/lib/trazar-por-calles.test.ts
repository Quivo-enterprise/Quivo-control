/**
 * Tests de las funciones puras de `trazar-por-calles.ts`. Runner: `node:test` vía tsx (sin
 * dependencias nuevas; los scripts no son un paquete del monorepo). Correr con:
 *   packages/db/node_modules/.bin/tsx --test scripts/lib/trazar-por-calles.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarBodyRoutes,
  cortarPolilinea,
  detectarVueltasU,
  podarEspolones,
  decodificarPolyline,
  desvioMaximo,
  detectarRulos,
  empalmarZona,
  abscisasSobreBoceto,
  difAngulo,
  localizarProblemas,
  waypointsCulpables,
  geometriaDeHueco,
  paresDeZona,
  type HuecoSinCalle,
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

// --- detectarRulos --------------------------------------------------------------------------
// Plano local alrededor de ORIGEN: dx metros al este, dy metros al norte.
const KX = 111_320 * Math.cos((-17.39 * Math.PI) / 180);
const en = (dx: number, dy: number): Coord => [ORIGEN[0] + dx / KX, ORIGEN[1] + dy / 111_320];

test('detectarRulos: avenida recta de 600 m; el trazado rodea una manzana (80 m de fondo) y vuelve', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const trazado: Coord[] = [en(0, 0), en(200, 0), en(200, -80), en(300, -80), en(300, 0), en(600, 0)];
  const rulos = detectarRulos(trazado, boceto);
  assert.equal(rulos.length, 1);
  const r = rulos[0]!;
  assert.equal(r.criterio, 'vuelve-al-boceto');
  assert.ok(Math.abs(r.desvioMaxM - 80) < 2, `desvío ${r.desvioMaxM}`);
  assert.ok(distanciaM(r.salida, en(200, 0)) < 15, 'salida');
  assert.ok(distanciaM(r.reingreso, en(300, 0)) < 15, 'reingreso');
  assert.ok(r.largoM > 2.5 * r.rectaM);
});

test('detectarRulos: rulo que vuelve exactamente al punto de salida (espolón de manzana) se detecta', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const trazado: Coord[] = [en(0, 0), en(200, 0), en(200, -90), en(260, -90), en(260, 0), en(200, 0), en(600, 0)];
  assert.ok(detectarRulos(trazado, boceto).length >= 1);
});

test('detectarRulos: calle paralela de sentido único a 80 m (corrida larga, sin vuelta en U) NO es rulo', () => {
  const boceto: Coord[] = [en(0, 0), en(900, 0)];
  const trazado: Coord[] = [en(0, 0), en(100, 0), en(100, -80), en(700, -80), en(700, 0), en(900, 0)];
  assert.deepEqual(detectarRulos(trazado, boceto), []);
});

test('detectarRulos: trazado idéntico al boceto, o dentro de 35 m, no tiene rulos', () => {
  const boceto: Coord[] = [en(0, 0), en(500, 0), en(500, 300)];
  assert.deepEqual(detectarRulos(boceto, boceto), []);
  assert.deepEqual(detectarRulos([en(0, 20), en(500, 20), en(520, 300)], boceto), []);
});

test('detectarRulos: lazo que se cruza a sí mismo (criterio 2) con salida y reingreso separados', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  // El trazado sale hacia el sur, hace un lazo, se cruza en (200,-60) y sigue.
  const trazado: Coord[] = [en(0, 0), en(150, 0), en(200, -60), en(300, -100), en(300, -200), en(200, -200), en(200, -60), en(400, -40), en(450, 0), en(600, 0)];
  const rulos = detectarRulos(trazado, boceto);
  assert.ok(rulos.length >= 1);
});

test('detectarRulos: rulo alrededor de una manzana en un trazado paralelo al boceto (a 20 m, nunca "pegado") se detecta por exceso local', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const trazado: Coord[] = [en(0, -20), en(200, -20), en(200, -100), en(300, -100), en(300, -20), en(600, -20)];
  const rulos = detectarRulos(trazado, boceto);
  assert.equal(rulos.length, 1);
  const r = rulos[0]!;
  assert.equal(r.criterio, 'exceso-local');
  assert.ok(Math.abs(r.excesoM! - 160) < 5, `exceso ${r.excesoM}`);
  assert.ok(r.desvioMaxM > 95);
});

test('detectarRulos: una vuelta que el propio boceto dibuja (manzana o ida y vuelta) no se marca', () => {
  const manzana: Coord[] = [en(0, 0), en(200, 0), en(200, -100), en(300, -100), en(300, 0), en(600, 0)];
  assert.deepEqual(detectarRulos(manzana, manzana), []);
  const desplazado: Coord[] = [en(0, -15), en(200, -15), en(215, -100), en(300, -100), en(315, -15), en(600, -15)];
  assert.deepEqual(detectarRulos(desplazado, manzana), []);
  const uBoceto: Coord[] = [en(0, 0), en(400, 0), en(400, -15), en(100, -15), en(100, 0), en(700, 0)];
  assert.deepEqual(detectarRulos(uBoceto, uBoceto), []);
});

test('detectarRulos regla 2: un par rechazado no salta el tramo; se sigue desde i+1 y se halla el lazo posterior', () => {
  // El boceto va y vuelve por y=0 (x 0→300→100); el trazado lo copia a y=-20 (par rechazado: no se aleja
  // del boceto) y luego hace un lazo hacia el norte que vuelve a pasar por el trayecto de ida.
  const boceto: Coord[] = [en(0, 0), en(300, 0), en(100, 0)];
  const trazado: Coord[] = [en(0, -20), en(300, -20), en(100, -20), en(100, 100), en(250, 100), en(250, -20)];
  const rulos = detectarRulos(trazado, boceto, { excesoLocalM: Infinity });
  assert.ok(rulos.some((r) => r.criterio === 'se-cruza' && r.desvioMaxM > 90), JSON.stringify(rulos.map((r) => r.criterio)));
});

test('cortarPolilinea: recorta entre abscisas con puntos interpolados', () => {
  const l: Coord[] = [en(0, 0), en(100, 0), en(100, 100)];
  const c = cortarPolilinea(l, 50, 150);
  assert.equal(c.length, 3);
  assert.ok(distanciaM(c[0]!, en(50, 0)) < 1 && distanciaM(c[1]!, en(100, 0)) < 1 && distanciaM(c[2]!, en(100, 50)) < 1);
});

test('detectarVueltasU: inversión de rumbo en <= 40 m que el boceto no tiene se marca; si el boceto la dibuja, no', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const trazado: Coord[] = [en(0, -10), en(300, -10), en(300, -25), en(100, -25)];
  const us = detectarVueltasU(trazado, boceto);
  assert.equal(us.length, 1);
  assert.ok(us[0]!.giroGrados > 150);
  assert.ok(distanciaM(us[0]!.coord, en(300, -17)) < 20);
  const conU: Coord[] = [en(0, 0), en(300, 0), en(300, -15), en(100, -15)];
  assert.deepEqual(detectarVueltasU(conU, conU), []);
  assert.deepEqual(detectarVueltasU([en(0, -10), en(300, -10), en(300, 190)], boceto), []); // una esquina de 90° no es U
});

test('podarEspolones: quita el ir y volver por los mismos vértices que el boceto no dibuja; no toca una U dibujada', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const espolon: Coord[] = [en(0, -10), en(200, -10), en(220, -10), en(200, -10), en(600, -10)];
  const r = podarEspolones(espolon, boceto);
  assert.equal(r.podados.length, 1);
  assert.deepEqual(r.coords, [en(0, -10), en(200, -10), en(600, -10)]);
  assert.equal(detectarVueltasU(r.coords, boceto).length, 0);
  const conU: Coord[] = [en(0, 0), en(300, 0), en(300, -15), en(100, -15)];
  assert.deepEqual(podarEspolones(conU, conU).coords, conU);
});

// --- Zonas ruteadas tramo a tramo con huecos sin calle ---

const BOC: Coord[] = [0, 1, 2, 3, 4, 5].map((i) => [-66.2 + i * 0.001, -17.3] as Coord);
const HUECO: HuecoSinCalle = { desde: 2, hasta: 3, calle: 'Calle X', motivo: 'sin calle en Google', geometria: [[-66.1975, -17.3003]] };

test('paresDeZona: pares consecutivos en el sentido de marcha y marca de hueco', () => {
  const ida = paresDeZona(BOC, 1, 4, false, [HUECO]);
  assert.deepEqual(ida.map((p) => [p.indiceA, p.indiceB, p.hueco !== undefined]), [[1, 2, false], [2, 3, true], [3, 4, false]]);
  const vuelta = paresDeZona(BOC, 1, 4, true, [HUECO]);
  assert.deepEqual(vuelta.map((p) => [p.indiceA, p.indiceB, p.hueco !== undefined]), [[4, 3, false], [3, 2, true], [2, 1, false]]);
  assert.deepEqual(vuelta[0]!.a, BOC[4]);
});

test('paresDeZona: rechaza rango inválido o hueco fuera de la zona / no consecutivo', () => {
  assert.throws(() => paresDeZona(BOC, 4, 1, false, []));
  assert.throws(() => paresDeZona(BOC, 0, 9, false, []));
  assert.throws(() => paresDeZona(BOC, 3, 5, false, [HUECO]));
  assert.throws(() => paresDeZona(BOC, 0, 5, false, [{ ...HUECO, hasta: 4 }]));
});

test('geometriaDeHueco: extremos + calle en el sentido del par; recta si no hay vértices', () => {
  const [, par] = paresDeZona(BOC, 1, 4, false, [HUECO]);
  assert.deepEqual(geometriaDeHueco(par!), [BOC[2], [-66.1975, -17.3003], BOC[3]]);
  const [, parInv] = paresDeZona(BOC, 1, 4, true, [{ ...HUECO, geometria: [[-66.1985, -17.3002], [-66.1975, -17.3003]] }]);
  assert.deepEqual(geometriaDeHueco(parInv!), [BOC[3], [-66.1975, -17.3003], [-66.1985, -17.3002], BOC[2]]);
  const [, recta] = paresDeZona(BOC, 1, 4, false, [{ ...HUECO, geometria: undefined }]);
  assert.deepEqual(geometriaDeHueco(recta!), [BOC[2], BOC[3]]);
  assert.throws(() => geometriaDeHueco(paresDeZona(BOC, 1, 4, false, [])[0]!));
});

test('unirTrozos: no duplica el punto de unión entre pares de una zona', () => {
  const r = unirTrozos([[BOC[1]!, BOC[2]!], [BOC[2]!, [-66.1975, -17.3003], BOC[3]!], [BOC[3]!, BOC[4]!]]);
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], BOC[1]);
  assert.deepEqual(r[4], BOC[4]);
});

test('empalmarZona: reemplaza entre inicio y fin; lo de afuera queda idéntico', () => {
  const tramo: Coord[] = [[-66.2, -17.3], [-66.199, -17.3], [-66.198, -17.3001], [-66.197, -17.3001], [-66.196, -17.3], [-66.195, -17.3]];
  const zona: Coord[] = [[-66.19901, -17.30001], [-66.1975, -17.3003], [-66.19601, -17.30001]];
  const r = empalmarZona(tramo, zona, tramo[1]!, tramo[4]!);
  assert.deepEqual(r.coords, [tramo[0], ...zona, tramo[5]]);
  assert.equal(r.indiceInicio, 1);
  assert.equal(r.indiceFin, 4);
});

test('empalmarZona: falla si la zona no empalma (> tolerancia) o si no encuentra fin después del inicio', () => {
  const tramo: Coord[] = [[-66.2, -17.3], [-66.199, -17.3], [-66.198, -17.3], [-66.197, -17.3]];
  assert.throws(() => empalmarZona(tramo, [[-66.199, -17.3003], [-66.198, -17.3]], tramo[1]!, tramo[2]!), /inicio de la zona/);
  assert.throws(() => empalmarZona(tramo, [[-66.199, -17.3], [-66.198, -17.3003]], tramo[1]!, tramo[2]!), /fin de la zona/);
  assert.throws(() => empalmarZona([tramo[0]!], [tramo[0]!, tramo[0]!], tramo[0]!, tramo[0]!), /no se encontró/);
});

// --- Fixes post-review ---------------------------------------------------------------------

test('difAngulo: diferencia absoluta 0–180 con cruce por 0/360', () => {
  assert.equal(difAngulo(10, 350), 20);
  assert.equal(difAngulo(0, 180), 180);
  assert.equal(difAngulo(90, 90), 0);
});

test('detectarVueltasU: U cerca del inicio o del fin del boceto (ventana de rumbo colapsada) también se detecta', () => {
  const boceto: Coord[] = [en(0, 0), en(0, -1000)]; // recto al sur
  const conU = (yU: number): Coord[] => [en(5, yU + 40), en(5, yU), en(25, yU), en(25, yU + 40)]; // baja, gira y sube (U de 20 m)
  for (const y of [-20, -40, -60, -500, -910, -950]) {
    const us = detectarVueltasU([en(5, y + 80), ...conU(y).slice(0)], boceto);
    assert.equal(us.length, 1, `U en y=${y}: ${us.length}`);
  }
});

test('detectarVueltasU: una U que el boceto sí dibuja cerca del extremo no se marca', () => {
  const boceto: Coord[] = [en(0, 0), en(300, 0), en(300, -15), en(0, -15)];
  assert.deepEqual(detectarVueltasU(boceto, boceto), []);
});

test('podarEspolones: una rotonda (lazo cerrado que NO rehace el camino) no se poda; un espolón real sí', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  // Rotonda de ~12 m de radio recorrida por un solo lado: entra y sale por el mismo punto, vértices distintos.
  const R = 12;
  const circulo: Coord[] = Array.from({ length: 9 }, (_, k) => en(200 + R * Math.sin((k / 8) * 2 * Math.PI), -10 - R + R * Math.cos((k / 8) * 2 * Math.PI)));
  const conRotonda: Coord[] = [en(0, -10), en(190, -10), ...circulo, en(210, -10), en(600, -10)];
  const r = podarEspolones(conRotonda, boceto);
  assert.equal(r.coords.length, conRotonda.length);
  assert.equal(r.podados.length, 0);
  // Espolón real: ida y vuelta por los mismos puntos.
  const espolon: Coord[] = [en(0, -10), en(200, -10), en(210, -10), en(220, -10), en(210, -10), en(200, -10), en(600, -10)];
  const e = podarEspolones(espolon, boceto);
  assert.equal(e.podados.length, 1);
  assert.equal(e.coords.length, espolon.length - 4);
});

test('abscisasSobreBoceto: un trazado que se aleja de su rama y queda más cerca de una rama ANTERIOR no retrocede; sInicio resuelve el cruce', () => {
  // Boceto en U: ida por y=0 (x 0→1000), sube, vuelve por y=300 (x 1000→0).
  const boceto: Coord[] = [en(0, 0), en(1000, 0), en(1000, 260), en(0, 260)];
  const traz: Coord[] = [en(1000, 260), en(700, 260), en(400, 110), en(300, 110), en(0, 260)]; // se asoma a 110 m de la ida (150 m de la vuelta)
  const dens: Coord[] = [];
  for (let i = 1; i < traz.length; i++) {
    const n = Math.max(1, Math.ceil(distanciaM(traz[i - 1]!, traz[i]!) / 10));
    for (let k = 0; k < n; k++) dens.push([traz[i - 1]![0] + ((traz[i]![0] - traz[i - 1]![0]) * k) / n, traz[i - 1]![1] + ((traz[i]![1] - traz[i - 1]![1]) * k) / n]);
  }
  const s = abscisasSobreBoceto(dens, boceto, 1260);
  for (let k = 1; k < s.length; k++) assert.ok(s[k]! - s[k - 1]! > -50, `retroceso en ${k}: ${s[k - 1]} → ${s[k]}`);
  assert.deepEqual(detectarRulos(traz, boceto, { sInicio: 1260 }), []);
  // Boceto que se cruza: sin sInicio gana la primera pasada; con sInicio, la segunda.
  const cruz: Coord[] = [en(0, 0), en(600, 0), en(600, 200), en(300, 200), en(300, -100)];
  assert.ok(abscisasSobreBoceto([en(300, 0), en(300, -50)], cruz)[0]! < 400);
  assert.ok(Math.abs(abscisasSobreBoceto([en(300, 0), en(300, -50)], cruz, 1300)[0]! - 1300) < 20);
});

test('waypointsCulpables: mide la distancia a cada problema por separado (no a una polilínea inventada entre ellos)', () => {
  const wp = (x: number): Muestra => ({ coord: en(x, 0), rumbo: 90 });
  const intermedios = [wp(100), wp(1000), wp(2000), wp(3000), wp(4000)];
  const problemas = [
    { tipo: 'u' as const, ancla: [en(100, 0)], fin: en(100, 0), orden: 5, desde: 5 },
    { tipo: 'u' as const, ancla: [en(3900, 0)], fin: en(3900, 0), orden: 90, desde: 90 },
  ];
  const c = waypointsCulpables(intermedios, problemas);
  // El waypoint de 2000 m (a 1,9 km de ambos) NO es culpable; con una polilínea 100→3900 daría distancia 0.
  assert.ok(!c.some((x) => x.k === 2));
  assert.deepEqual(c.map((x) => x.k).sort(), [0, 4]);
  // kFin = el waypoint más cercano al ÚLTIMO problema en sentido de marcha (orden 90), aunque se agregó primero: pesa la mitad.
  assert.ok(c.find((x) => x.k === 4)!.d < 110);
});

test('localizarProblemas: evalúa contra el boceto entero con la misma proyección que la validación', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const trazado: Coord[] = [en(0, 0), en(200, 0), en(200, -80), en(300, -80), en(300, 0), en(600, 0)];
  const p = localizarProblemas(trazado, boceto, 0);
  assert.equal(p.length, 1);
  assert.equal(p[0]!.tipo, 'rulo');
});

test('localizarProblemas: un rulo dentro de una zona excluida (que después se re-rutea) no cuenta; fuera de ella sí', () => {
  const boceto: Coord[] = [en(0, 0), en(600, 0)];
  const trazado: Coord[] = [en(0, 0), en(200, 0), en(200, -80), en(300, -80), en(300, 0), en(600, 0)];
  assert.equal(localizarProblemas(trazado, boceto, 0, [{ desde: 150, hasta: 350 }]).length, 0);
  assert.equal(localizarProblemas(trazado, boceto, 0, [{ desde: 400, hasta: 600 }]).length, 1);
});
