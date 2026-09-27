import { describe, expect, it } from 'vitest';
import { LINEAS_MOCK } from './datos';
import { avancesDeParadas, indiceDeRetornoDe, largoTotalM, posicionEnPolilinea, tramoDesdeAvance, trazoVisibleDe } from './geometria';

describe('posicionEnPolilinea', () => {
  it('con polilínea vacía devuelve un punto fijo sin lanzar', () => {
    expect(posicionEnPolilinea([], 0.5)).toEqual({ lat: 0, lng: 0 });
  });

  it('con un solo punto devuelve siempre ese punto, sin importar el avance', () => {
    const punto: [number, number] = [-17.4, -66.15];
    expect(posicionEnPolilinea([punto], 0)).toEqual({ lat: -17.4, lng: -66.15 });
    expect(posicionEnPolilinea([punto], 0.7)).toEqual({ lat: -17.4, lng: -66.15 });
  });

  it('avance 0 devuelve el primer punto', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.15],
      [-17.4, -66.14],
    ];
    const pos = posicionEnPolilinea(polilinea, 0);
    expect(pos.lat).toBeCloseTo(-17.4, 6);
    expect(pos.lng).toBeCloseTo(-66.15, 6);
  });

  it('en un segmento recto, avance 0.5 cae en el punto medio', () => {
    // Segmento de largo constante (misma latitud): la interpolación por distancia
    // acumulada coincide con la interpolación lineal simple del lng.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.14],
    ];
    const pos = posicionEnPolilinea(polilinea, 0.5);
    expect(pos.lat).toBeCloseTo(-17.4, 4);
    expect(pos.lng).toBeCloseTo(-66.15, 3);
  });

  it('hace loop: avance 1 equivale a avance 0 (vuelve al primer punto)', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.4, -66.14],
    ];
    const enUno = posicionEnPolilinea(polilinea, 1);
    const enCero = posicionEnPolilinea(polilinea, 0);
    expect(enUno.lat).toBeCloseTo(enCero.lat, 6);
    expect(enUno.lng).toBeCloseTo(enCero.lng, 6);
  });

  it('normaliza avances fuera de [0,1) — 1.5 equivale a 0.5, y -0.5 equivale a 0.5', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.14],
    ];
    const base = posicionEnPolilinea(polilinea, 0.5);
    const masDeUno = posicionEnPolilinea(polilinea, 1.5);
    const negativo = posicionEnPolilinea(polilinea, -0.5);
    expect(masDeUno.lat).toBeCloseTo(base.lat, 6);
    expect(masDeUno.lng).toBeCloseTo(base.lng, 6);
    expect(negativo.lat).toBeCloseTo(base.lat, 6);
    expect(negativo.lng).toBeCloseTo(base.lng, 6);
  });

  it('respeta esquinas: con 3 puntos, avance a mitad de camino cae cerca del punto medio real', () => {
    // Dos segmentos de largo similar (mismo delta de lng en la misma latitud aprox): el
    // punto medio del recorrido total debería caer cerca del vértice del medio.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.15],
      [-17.4, -66.14],
    ];
    const pos = posicionEnPolilinea(polilinea, 0.5);
    expect(pos.lng).toBeCloseTo(-66.15, 2);
  });
});

describe('indiceDeRetornoDe', () => {
  it('detecta el vértice de retorno en una polilínea de ida y vuelta simple', () => {
    // Ida: 3 puntos alejándose en línea recta; vuelta: los mismos 3 puntos retrazados.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.38, -66.14], // vértice de retorno — índice 2
      [-17.39, -66.15],
      [-17.4, -66.16],
    ];
    expect(indiceDeRetornoDe(polilinea)).toBe(2);
  });

  it('devuelve null para una polilínea que NO es de ida y vuelta (circuito por calles distintas)', () => {
    // Un cuadrado — nunca retraza el mismo tramo en sentido contrario.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.15],
      [-17.39, -66.15],
      [-17.39, -66.16],
      [-17.4, -66.16],
    ];
    expect(indiceDeRetornoDe(polilinea)).toBeNull();
  });

  it('devuelve null con menos de 3 puntos', () => {
    expect(indiceDeRetornoDe([])).toBeNull();
    expect(
      indiceDeRetornoDe([
        [-17.4, -66.16],
        [-17.39, -66.15],
      ]),
    ).toBeNull();
  });

  it('detecta el vértice de retorno real de la polilínea de la Línea 120', () => {
    const polilinea = LINEAS_MOCK.l120.polilinea;
    const indice = indiceDeRetornoDe(polilinea);
    expect(indice).not.toBeNull();
    // El vértice de retorno tiene que ser el punto más lejano del inicio (La Cancha, la
    // última parada de la 120 — ver `L120_PARADAS` en `datos.ts`), y punto medio exacto del
    // array (167 puntos, ida y vuelta simétrica sobre las mismas calles).
    expect(indice).toBe((polilinea.length - 1) / 2);
  });

  it('NO detecta vértice de retorno en la polilínea real de Z12 (circuito, no ida y vuelta)', () => {
    expect(indiceDeRetornoDe(LINEAS_MOCK.z12.polilinea)).toBeNull();
  });
});

describe('trazoVisibleDe', () => {
  it('recorta a la ida cuando la polilínea es de ida y vuelta', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.38, -66.14],
      [-17.39, -66.15],
      [-17.4, -66.16],
    ];
    expect(trazoVisibleDe(polilinea)).toEqual([
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.38, -66.14],
    ]);
  });

  it('devuelve la polilínea completa sin cambios cuando NO es de ida y vuelta', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.15],
      [-17.39, -66.15],
      [-17.39, -66.16],
      [-17.4, -66.16],
    ];
    expect(trazoVisibleDe(polilinea)).toEqual(polilinea);
  });

  it('el trazo visible de la 120 real es justo la mitad (ida) de la polilínea completa', () => {
    const completa = LINEAS_MOCK.l120.polilinea;
    const visible = trazoVisibleDe(completa);
    expect(visible.length).toBe((completa.length + 1) / 2);
    expect(visible).toEqual(completa.slice(0, visible.length));
  });

  it('`LINEAS_MOCK.l120.trazoRuta` (computado en datos.ts) coincide con `trazoVisibleDe` de su polilínea', () => {
    expect(LINEAS_MOCK.l120.trazoRuta).toEqual(trazoVisibleDe(LINEAS_MOCK.l120.polilinea));
  });

  it('`LINEAS_MOCK.z12.trazoRuta` es la polilínea completa (no es ida y vuelta)', () => {
    expect(LINEAS_MOCK.z12.trazoRuta).toEqual(LINEAS_MOCK.z12.polilinea);
  });
});

// ================================================================================================
// Ítem 4 del guion delegado: `avancesDeParadas` — monótono creciente por `orden`, primera
// parada en 0.
// ================================================================================================

describe('avancesDeParadas', () => {
  it('con polilínea vacía, devuelve 0 para todas las paradas', () => {
    expect(avancesDeParadas([], [{ lat: 0, lng: 0, orden: 0 }])).toEqual([0]);
  });

  it('con lista de paradas vacía, devuelve []', () => {
    expect(avancesDeParadas(LINEAS_MOCK.z12.polilinea, [])).toEqual([]);
  });

  it('la primera parada (menor `orden`) siempre da avance 0, sin importar sus coordenadas', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.38, -66.14],
    ];
    // Coordenadas MUY lejos del inicio real, a propósito — con `avanceDeParada` (búsqueda
    // global) esto daría un avance cercano a 1, no a 0.
    const avances = avancesDeParadas(polilinea, [{ lat: -17.38, lng: -66.14, orden: 0 }]);
    expect(avances).toEqual([0]);
  });

  it('devuelve los avances en el MISMO orden del array de entrada, no en orden de `orden`', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.39, -66.15],
      [-17.38, -66.14],
      [-17.37, -66.13],
    ];
    const paradas = [
      { id: 'b', lat: -17.38, lng: -66.14, orden: 2 },
      { id: 'a', lat: -17.4, lng: -66.16, orden: 0 },
      { id: 'c', lat: -17.37, lng: -66.13, orden: 3 },
    ];
    const avances = avancesDeParadas(polilinea, paradas);
    // paradas[1] (orden 0) es la primera → avance 0; paradas[0] (orden 2) > paradas[1]; paradas[2]
    // (orden 3) es la última → el mayor avance.
    expect(avances[1]).toBe(0);
    expect(avances[0]).toBeGreaterThan(avances[1]!);
    expect(avances[2]).toBeGreaterThan(avances[0]!);
  });

  it('Z12: Villa Armonía (orden 0) da avance 0 y las paradas siguen estrictamente creciente por `orden`', () => {
    const ordenadas = [...LINEAS_MOCK.z12.paradas].sort((a, b) => a.orden - b.orden);
    expect(ordenadas[0]!.id).toBe('villa-armonia');
    expect(ordenadas[0]!.avance).toBe(0);
    for (let i = 1; i < ordenadas.length; i++) {
      expect(ordenadas[i]!.avance).toBeGreaterThan(ordenadas[i - 1]!.avance);
    }
  });

  it('Línea 120: Plaza Colón (orden 0) da avance 0 y las paradas siguen estrictamente creciente por `orden`', () => {
    const ordenadas = [...LINEAS_MOCK.l120.paradas].sort((a, b) => a.orden - b.orden);
    expect(ordenadas[0]!.id).toBe('plaza-colon');
    expect(ordenadas[0]!.avance).toBe(0);
    for (let i = 1; i < ordenadas.length; i++) {
      expect(ordenadas[i]!.avance).toBeGreaterThan(ordenadas[i - 1]!.avance);
    }
  });
});

// ================================================================================================
// Ítem 7 del guion delegado: `tramoDesdeAvance` siempre devuelve al menos 2 puntos (inicio +
// final interpolado), incluso cuando el tramo pedido cabe entero dentro de UN solo segmento.
// ================================================================================================

describe('tramoDesdeAvance', () => {
  it('cuando el próximo vértice está a más de `metros`, igual devuelve 2 puntos (inicio + final interpolado)', () => {
    // Segmento larguísimo (>1 km) — un tramo de 250 m pedido cabe entero adentro.
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.3, -66.06],
    ];
    const tramo = tramoDesdeAvance(polilinea, 0, 250);
    expect(tramo.length).toBeGreaterThanOrEqual(2);
    // El punto final tiene que estar A LA MISMA distancia (~250 m) del inicio, no ser el inicio
    // repetido.
    expect(tramo[0]).not.toEqual(tramo[tramo.length - 1]);
  });

  it('con `metros: 0`, devuelve 2 puntos idénticos (inicio == final)', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.3, -66.06],
    ];
    const tramo = tramoDesdeAvance(polilinea, 0, 0);
    expect(tramo.length).toBeGreaterThanOrEqual(2);
    expect(tramo[0]![0]).toBeCloseTo(tramo[tramo.length - 1]![0]!, 6);
    expect(tramo[0]![1]).toBeCloseTo(tramo[tramo.length - 1]![1]!, 6);
  });

  it('cuando el tramo cruza varios vértices, los incluye todos y termina con el punto interpolado', () => {
    const polilinea: [number, number][] = [
      [-17.4, -66.16],
      [-17.4, -66.159],
      [-17.4, -66.158],
      [-17.4, -66.157],
      [-17.4, -66.156],
    ];
    const largo = largoTotalM(polilinea);
    const tramo = tramoDesdeAvance(polilinea, 0, largo * 0.6);
    expect(tramo.length).toBeGreaterThan(2);
  });

  it('con la polilínea real de Z12 y un atasco de 250 m, siempre hay al menos 2 puntos (regresión del bug real)', () => {
    const trufi = LINEAS_MOCK.z12;
    for (const avanceInicio of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.999]) {
      const tramo = tramoDesdeAvance(trufi.polilinea, avanceInicio, 250);
      expect(tramo.length).toBeGreaterThanOrEqual(2);
    }
  });
});
