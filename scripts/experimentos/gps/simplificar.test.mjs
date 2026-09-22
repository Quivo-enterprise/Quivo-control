import { describe, it, expect } from 'vitest';
import {
  haversineMetros,
  centroide,
  proyectarAMetros,
  douglasPeucker,
  marcarZonaProtegida,
  combinarRetenido,
  submuestrearPorDistancia,
  submuestrearPorTiempo,
  calcularDesviaciones,
  percentil,
  longitudKm,
  detectarCercanos,
  calcularPasadasPorTraza,
  compararPasadas,
  ejecutarPipeline,
  DP_TOLERANCIAS_M,
  DIST_SUBMUESTREO_M,
  TIEMPO_SUBMUESTREO_S,
  ZONA_PROTEGIDA_MARGEN_M,
} from './simplificar.mjs';

/**
 * Traza sintética con curvas: dos rectas casi rectas seguidas de un giro pronunciado, con
 * ruido GPS de ~5 m agregado a cada fix (offset determinístico, sin Math.random, para que el
 * test sea reproducible). Un fix por segundo, ~180 puntos (~3 minutos), con 3 puntos de
 * control repartidos: dos sobre el tramo recto y uno justo en el giro.
 */
function construirTrazaSintetica() {
  const ORIGEN = { lat: -17.3895, lng: -66.1568 }; // Cochabamba, un punto cualquiera
  const T0 = Date.parse('2026-09-20T08:00:00.000Z');

  // Ruido pseudoaleatorio determinístico ~5 m (una senoidal de alta frecuencia, no un RNG).
  function ruidoM(i) {
    return 5 * Math.sin(i * 2.7);
  }

  const puntos = [];
  let i = 0;

  // Tramo 1: recto hacia el este, ~500 m (50 fixes, 10 m/fix).
  for (let k = 0; k < 50; k++, i++) {
    const distM = k * 10;
    const lng = ORIGEN.lng + (distM / 111320) / Math.cos((ORIGEN.lat * Math.PI) / 180);
    puntos.push({ i, lat: ORIGEN.lat, lng, ruido: ruidoM(i) });
  }

  // Giro: 90 grados hacia el norte en 20 fixes, sobre un arco.
  const centroGiro = { lat: ORIGEN.lat, lng: ORIGEN.lng + (500 / 111320) / Math.cos((ORIGEN.lat * Math.PI) / 180) };
  const radioGiroM = 80;
  for (let k = 0; k <= 20; k++, i++) {
    const anguloRad = (k / 20) * (Math.PI / 2); // 0 -> 90 grados
    const dLatM = radioGiroM * Math.sin(anguloRad);
    const dLngM = radioGiroM * (1 - Math.cos(anguloRad));
    const lat = centroGiro.lat + dLatM / 111320;
    const lng = centroGiro.lng + dLngM / (111320 * Math.cos((centroGiro.lat * Math.PI) / 180));
    puntos.push({ i, lat, lng, ruido: ruidoM(i) });
  }

  // Tramo 2: recto hacia el norte, ~500 m (50 fixes, 10 m/fix), arrancando donde terminó el giro.
  const finGiro = puntos[puntos.length - 1];
  for (let k = 1; k <= 50; k++, i++) {
    const distM = k * 10;
    const lat = finGiro.lat + distM / 111320;
    puntos.push({ i, lat, lng: finGiro.lng, ruido: ruidoM(i) });
  }

  // Aplica el ruido como un offset perpendicular pequeño en longitud (suficiente para el
  // propósito del test: simular jitter de GPS real, no reproducir un modelo de error exacto).
  const gpsPoints = puntos.map((p) => ({
    ts: T0 + p.i * 1000,
    lat: p.lat + p.ruido / 111320,
    lng: p.lng,
    accuracy: 6,
    speed: 8,
  }));

  const puntosControl = [
    { id: 'pc-a', orden: 1, lat: gpsPoints[10].lat, lng: gpsPoints[10].lng, radioToleranciaM: 40, obligatorio: true, estado: 'activo' },
    { id: 'pc-b', orden: 2, lat: gpsPoints[70].lat, lng: gpsPoints[70].lng, radioToleranciaM: 40, obligatorio: true, estado: 'activo' },
    { id: 'pc-c', orden: 3, lat: gpsPoints[gpsPoints.length - 10].lat, lng: gpsPoints[gpsPoints.length - 10].lng, radioToleranciaM: 40, obligatorio: true, estado: 'activo' },
  ];

  return { gpsPoints, puntosControl };
}

describe('haversineMetros', () => {
  it('devuelve ~0 para el mismo punto', () => {
    expect(haversineMetros([-66.15, -17.39], [-66.15, -17.39])).toBeCloseTo(0, 6);
  });
  it('es simétrica', () => {
    const a = [-66.15, -17.39];
    const b = [-66.16, -17.4];
    expect(haversineMetros(a, b)).toBeCloseTo(haversineMetros(b, a), 6);
  });
});

describe('proyectarAMetros', () => {
  it('el centroide proyecta cerca de (0,0)', () => {
    const puntos = [{ lat: -17.39, lng: -66.15 }, { lat: -17.4, lng: -66.16 }];
    const origen = centroide(puntos);
    const [p0] = proyectarAMetros([origen], origen);
    expect(p0.x).toBeCloseTo(0, 6);
    expect(p0.y).toBeCloseTo(0, 6);
  });

  it('la distancia proyectada entre dos puntos se aproxima a la haversine real a escala urbana', () => {
    const a = { lat: -17.39, lng: -66.15 };
    const b = { lat: -17.395, lng: -66.155 };
    const origen = centroide([a, b]);
    const [pa, pb] = proyectarAMetros([a, b], origen);
    const distProyectada = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const distReal = haversineMetros([a.lng, a.lat], [b.lng, b.lat]);
    expect(Math.abs(distProyectada - distReal)).toBeLessThan(1);
  });
});

describe('douglasPeucker', () => {
  it('conserva siempre los extremos', () => {
    const puntos = [{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const retenido = douglasPeucker(puntos, 100);
    expect(retenido[0]).toBe(true);
    expect(retenido[retenido.length - 1]).toBe(true);
  });

  it('con tolerancia 0 conserva todos los puntos de una recta con un desvío', () => {
    const puntos = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 10 }, { x: 3, y: 0 }];
    const retenido = douglasPeucker(puntos, 0);
    expect(retenido.every(Boolean)).toBe(true);
  });

  it('con tolerancia muy alta colapsa todo a los dos extremos', () => {
    const puntos = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i) }));
    const retenido = douglasPeucker(puntos, 10000);
    expect(retenido.filter(Boolean).length).toBe(2);
  });

  it('detecta un punto que se aleja del SEGMENTO aunque quede cerca de la recta que lo prolonga (reversión colineal)', () => {
    // (0,0) -> (100,0) -> (1,0): el tercer punto vuelve casi hasta el origen sobre el mismo
    // eje X — está a 99m del segmento real [(0,0),(100,0)] visto desde el extremo, pero la
    // distancia a la RECTA infinita que pasa por (0,0) y (100,0) es 0 (los tres puntos son
    // colineales). Con distancia-a-recta, Douglas-Peucker nunca ve desviación y descarta el
    // punto del medio pase lo que pase con la tolerancia; con distancia-a-segmento, el punto
    // del medio quedó fuera del segmento [ini,fin] (t clampeado a 1) y sí importa.
    const puntos = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1, y: 0 }];
    const retenido = douglasPeucker(puntos, 2);
    expect(retenido).toEqual([true, true, true]);
  });

  it('reduce puntos en una traza con curvas sin perder la forma (menos puntos que el crudo)', () => {
    const { gpsPoints } = construirTrazaSintetica();
    const origen = centroide(gpsPoints);
    const xy = proyectarAMetros(gpsPoints, origen);
    const retenido = douglasPeucker(xy, 5);
    const guardados = retenido.filter(Boolean).length;
    expect(guardados).toBeLessThan(gpsPoints.length);
    expect(guardados).toBeGreaterThan(2);
  });
});

describe('marcarZonaProtegida', () => {
  it('marca como protegidos los puntos crudos cerca de un punto de control y no los lejanos', () => {
    const { gpsPoints, puntosControl } = construirTrazaSintetica();
    const marcados = marcarZonaProtegida(gpsPoints, puntosControl, ZONA_PROTEGIDA_MARGEN_M);
    // El punto usado para definir pc-a (índice 10) tiene que quedar protegido.
    expect(marcados[10]).toBe(true);
    // Un punto lejos de cualquier punto de control (bien al principio del tramo 1, separado
    // del pc-a por ~100 m > radio 40 + margen 50) no debería quedar marcado.
    expect(marcados[0]).toBe(false);
  });
});

describe('combinarRetenido', () => {
  it('hace un OR punto a punto', () => {
    expect(combinarRetenido([true, false, false], [false, false, true])).toEqual([true, false, true]);
  });
});

describe('submuestrearPorDistancia', () => {
  it('siempre conserva el primer punto', () => {
    const { gpsPoints } = construirTrazaSintetica();
    const retenido = submuestrearPorDistancia(gpsPoints, 30);
    expect(retenido[0]).toBe(true);
  });

  it('a mayor distMinM, menos o igual cantidad de puntos conservados', () => {
    const { gpsPoints } = construirTrazaSintetica();
    const r30 = submuestrearPorDistancia(gpsPoints, 30).filter(Boolean).length;
    const r80 = submuestrearPorDistancia(gpsPoints, 80).filter(Boolean).length;
    expect(r80).toBeLessThanOrEqual(r30);
  });
});

describe('submuestrearPorTiempo', () => {
  it('con un fix por segundo, un intervalo de 15s conserva aproximadamente 1 de cada 15', () => {
    const { gpsPoints } = construirTrazaSintetica();
    const retenido = submuestrearPorTiempo(gpsPoints, 15);
    const guardados = retenido.filter(Boolean).length;
    const esperado = Math.floor(gpsPoints.length / 15) + 1;
    expect(guardados).toBeLessThanOrEqual(esperado + 1);
    expect(guardados).toBeGreaterThan(0);
  });
});

describe('calcularDesviaciones + percentil', () => {
  it('es 0 en los puntos que la variante conservó, y > 0 en un punto fuera de la recta entre extremos', () => {
    const puntos = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: -1 }, { x: 4, y: 0 }];
    const retenido = [true, false, false, false, true];
    const desv = calcularDesviaciones(puntos, retenido);
    expect(desv[0]).toBe(0);
    expect(desv[4]).toBe(0);
    // El segmento retenido es (0,0)-(4,0): el punto (2,3) queda a 3m perpendicular.
    expect(desv[2]).toBeCloseTo(3, 6);
  });

  it('el percentil 95 nunca supera el máximo', () => {
    const valores = [1, 2, 3, 4, 5, 100];
    expect(percentil(valores, 95)).toBeLessThanOrEqual(Math.max(...valores));
  });
});

describe('longitudKm', () => {
  it('es 0 para un solo punto y crece con más tramos', () => {
    expect(longitudKm([{ lat: -17.39, lng: -66.15 }])).toBe(0);
    const { gpsPoints } = construirTrazaSintetica();
    expect(longitudKm(gpsPoints)).toBeGreaterThan(0.5); // ~1.08 km de tramos rectos + arco
  });
});

describe('detectarCercanos + calcularPasadasPorTraza (réplica de geofence.ts)', () => {
  it('detecta cumplido cuando la distancia es menor al radio', () => {
    const pc = [{ id: 'pc-1', lat: -17.39, lng: -66.15, radioToleranciaM: 50 }];
    const [d] = detectarCercanos(-17.39, -66.15, pc, 5);
    expect(d.cumplido).toBe(true);
    expect(d.distanciaM).toBeCloseTo(0, 3);
  });

  it('sobre la traza sintética completa detecta al menos una pasada por cada punto de control', () => {
    const { gpsPoints, puntosControl } = construirTrazaSintetica();
    const emitidos = calcularPasadasPorTraza(gpsPoints, puntosControl);
    for (const pc of puntosControl) {
      expect(emitidos.get(pc.id).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('compararPasadas detecta 0 perdidas/extra cuando ambos conteos son iguales', () => {
    const base = new Map([['pc-1', 3], ['pc-2', 1]]);
    const variante = new Map([['pc-1', 3], ['pc-2', 1]]);
    expect(compararPasadas(base, variante)).toEqual({ perdidas: 0, extra: 0, detalle: { 'pc-1': { baseline: 3, variante: 3 }, 'pc-2': { baseline: 1, variante: 1 } } });
  });

  it('compararPasadas cuenta perdidas y extra por separado', () => {
    const base = new Map([['pc-1', 3], ['pc-2', 1]]);
    const variante = new Map([['pc-1', 1], ['pc-2', 2]]);
    const r = compararPasadas(base, variante);
    expect(r.perdidas).toBe(2); // pc-1: 3 -> 1
    expect(r.extra).toBe(1); // pc-2: 1 -> 2
  });
});

describe('ejecutarPipeline (integración con la traza sintética)', () => {
  const { gpsPoints, puntosControl } = construirTrazaSintetica();
  const resultado = ejecutarPipeline({ gpsPoints, puntosControl, cumplimientos: [] });

  it('genera una variante por cada combinación pedida (4 DP + 4 DP-zona + 3 distancia + 3 tiempo = 14)', () => {
    expect(resultado.variantes.length).toBe(
      DP_TOLERANCIAS_M.length * 2 + DIST_SUBMUESTREO_M.length + TIEMPO_SUBMUESTREO_S.length,
    );
  });

  it('el baseline reporta el 100% de los puntos crudos', () => {
    expect(resultado.baseline.puntos).toBe(gpsPoints.length);
    expect(resultado.baseline.pctVsCrudo).toBe(100);
  });

  it('toda variante guarda estrictamente menos puntos que el crudo', () => {
    for (const v of resultado.variantes) {
      expect(v.puntosGuardados).toBeLessThan(gpsPoints.length);
      expect(v.puntosGuardados).toBeGreaterThanOrEqual(2);
    }
  });

  it('DP con zona protegida nunca guarda menos puntos que el DP equivalente sin zona', () => {
    const porTolerancia = new Map();
    for (const v of resultado.variantes) {
      if (v.tipo === 'douglas-peucker') porTolerancia.set(v.parametro, v.puntosGuardados);
    }
    for (const v of resultado.variantes) {
      if (v.tipo === 'douglas-peucker-zona-protegida') {
        expect(v.puntosGuardados).toBeGreaterThanOrEqual(porTolerancia.get(v.parametro));
      }
    }
  });

  it('la proyección a 6000 puntos/día escala proporcionalmente a los puntos guardados', () => {
    for (const v of resultado.variantes) {
      const esperado = v.puntosGuardados * (6000 / gpsPoints.length);
      expect(v.puntosDiaProyectado6000).toBeCloseTo(esperado, 6);
    }
  });

  it('DP solo (sin zona protegida) puede perder una pasada real — el riesgo que motiva H-simplificación', () => {
    // Con esta geometría, dp-2 termina de adelgazar TODO el tramo recto alrededor de pc-c
    // (los puntos ahí quedan cerca del segmento vigente entre anclas lejanas, así que
    // ninguno supera la tolerancia de 2m) — se pierde la única pasada de pc-c. Es
    // determinístico (sin aleatoriedad) y es exactamente el riesgo que el plan pide falsear
    // con datos reales antes de confiar en DP sin protección.
    const dp2 = resultado.variantes.find((v) => v.nombre === 'dp-2');
    expect(dp2.pasadasPerdidas).toBeGreaterThan(0);
  });

  it('la misma tolerancia CON zona protegida no pierde ninguna pasada, en todas las tolerancias DP (H-simplificación)', () => {
    for (const v of resultado.variantes) {
      if (v.tipo === 'douglas-peucker-zona-protegida') {
        expect(v.pasadasPerdidas).toBe(0);
      }
    }
  });

  it('el submuestreo de captura (distancia/tiempo) sí puede perder pasadas (hipótesis H-captura)', () => {
    const conAlgunaPerdida = resultado.variantes.some(
      (v) => (v.tipo === 'submuestreo-distancia' || v.tipo === 'submuestreo-tiempo') && v.pasadasPerdidas > 0,
    );
    expect(conAlgunaPerdida).toBe(true);
  });

  it('sin cumplimientos reales, el sanity check queda null', () => {
    expect(resultado.sanityCheckCumplimientos).toBeNull();
  });

  it('con cumplimientos reales, el sanity check compara baseline recalculado vs registrado', () => {
    const cumplimientos = puntosControl.map((pc) => ({ puntoControlId: pc.id, ts: Date.now(), distanciaM: 5, cumplido: true, validadoPor: 'worker', pasada: 1 }));
    const conCump = ejecutarPipeline({ gpsPoints, puntosControl, cumplimientos });
    expect(conCump.sanityCheckCumplimientos).not.toBeNull();
    expect(conCump.sanityCheckCumplimientos.length).toBeGreaterThanOrEqual(puntosControl.length);
  });
});
