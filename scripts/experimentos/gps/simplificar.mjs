// simplificar.mjs
//
// Entregable 2 del experimento de puntos GPS (docs/plan-experimento-puntos-gps.md, paso A.3).
// Lee los CSV que parsear-logs.mjs escribió en datos/ (gps_points_sesion.csv,
// puntos_control_ruta.csv, cumplimientos_pc_sesion.csv) y calcula, para varias estrategias de
// reducción de la traza, qué tan bien conservan la forma del recorrido y las pasadas por
// punto de control frente al baseline (la traza cruda).
//
// Todas las funciones de cálculo son puras y exportadas para que
// simplificar.test.mjs las pruebe con una traza sintética sin tocar disco — solo main()
// (invocada al correr `node simplificar.mjs`) hace I/O.
//
// Proyección: equirectangular local alrededor del centroide de la traza (pedido explícito
// del encargo) — válida para el radio de una ruta urbana (unos pocos km), no para escala
// continental. Se usa para Douglas-Peucker, la métrica de desviación y el submuestreo por
// distancia: a esta escala la diferencia contra la distancia geodésica real es de
// centímetros, muy por debajo del ruido propio del GPS (varios metros). La única lógica que
// usa haversine real (no la proyección) es la que REPLICA el detector de puntos de control
// del móvil (ver más abajo) — ahí se usa la misma fórmula que usa esa lógica en producción,
// a propósito, para que la réplica sea fiel byte a byte, y el largo total en km reportado
// (más intuitivo como distancia geodésica que como suma de segmentos proyectados).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

export const RADIO_TIERRA_METROS = 6371000;

/**
 * Réplica exacta de haversineMetros (packages/shared/src/geo.ts:27-38) — misma fórmula,
 * mismo orden de argumentos [lng, lat]. Se usa acá solo donde hace falta ser fiel a la
 * lógica de producción (ver comentario de arriba).
 */
export function haversineMetros(a, b) {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h =
    senoLat * senoLat + Math.cos(latA * rad) * Math.cos(latB * rad) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Centroide simple (promedio) de lat/lng — suficiente como origen local de la proyección. */
export function centroide(puntos) {
  let sumaLat = 0;
  let sumaLng = 0;
  for (const p of puntos) {
    sumaLat += p.lat;
    sumaLng += p.lng;
  }
  return { lat: sumaLat / puntos.length, lng: sumaLng / puntos.length };
}

/** Proyección equirectangular local a metros alrededor de `origen`. */
export function proyectarAMetros(puntos, origen) {
  const rad = Math.PI / 180;
  const cosLat0 = Math.cos(origen.lat * rad);
  return puntos.map((p) => ({
    x: (p.lng - origen.lng) * rad * RADIO_TIERRA_METROS * cosLat0,
    y: (p.lat - origen.lat) * rad * RADIO_TIERRA_METROS,
  }));
}

function distanciaPuntoASegmento(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largo2 = dx * dx + dy * dy;
  if (largo2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/**
 * Douglas-Peucker iterativo (pila explícita, no recursión) sobre puntos ya proyectados a
 * metros. Devuelve un array booleano — retenido[i] — de la misma longitud que `puntosXY`.
 * Los extremos siempre se conservan (contrato del algoritmo).
 */
export function douglasPeucker(puntosXY, toleranciaM) {
  const n = puntosXY.length;
  const retenido = new Array(n).fill(false);
  if (n === 0) return retenido;
  retenido[0] = true;
  retenido[n - 1] = true;
  if (n < 3) return retenido;

  const pila = [[0, n - 1]];
  while (pila.length > 0) {
    const [ini, fin] = pila.pop();
    if (fin - ini < 2) continue;
    const a = puntosXY[ini];
    const b = puntosXY[fin];
    let distMax = -1;
    let idxMax = -1;
    for (let i = ini + 1; i < fin; i++) {
      // Distancia al SEGMENTO (a,b), no a la recta infinita que lo contiene: con la recta
      // infinita, un punto que se aleja del segmento pero queda cerca de su prolongación
      // (p.ej. una traza que retrocede sobre sí misma) mide una distancia perpendicular
      // chica aunque esté lejos de ambos extremos — el algoritmo lo descarta creyendo que
      // sigue "la línea" cuando en realidad el trazo real se desvió fuerte. Douglas-Peucker
      // se define sobre el segmento; `distanciaPerpendicularARecta` da la proyección sobre
      // la recta SIN clampear t a [0,1], así que fuera del segmento subestima la distancia.
      const d = distanciaPuntoASegmento(puntosXY[i], a, b);
      if (d > distMax) {
        distMax = d;
        idxMax = i;
      }
    }
    if (distMax > toleranciaM) {
      retenido[idxMax] = true;
      pila.push([ini, idxMax]);
      pila.push([idxMax, fin]);
    }
  }
  return retenido;
}

/**
 * Marca como protegido todo punto crudo dentro de (radioToleranciaM + margenM) de CUALQUIER
 * punto de control, medido con haversine real (mismo criterio de distancia que el detector
 * de producción, ver detectarCercanos más abajo) — así "zona protegida" significa lo mismo
 * que "el móvil lo consideraría posiblemente dentro/cerca del radio".
 */
export function marcarZonaProtegida(puntos, puntosControl, margenM) {
  return puntos.map((p) => {
    for (const pc of puntosControl) {
      const d = haversineMetros([p.lng, p.lat], [pc.lng, pc.lat]);
      if (d <= pc.radioToleranciaM + margenM) return true;
    }
    return false;
  });
}

/** OR lógico de dos máscaras booleanas de la misma longitud. */
export function combinarRetenido(a, b) {
  return a.map((v, i) => v || b[i]);
}

/**
 * Submuestreo por distancia (simula distanceFilter, plan §2): conserva el primer punto y,
 * de ahí en más, un punto solo si se alejó al menos `distMinM` del ÚLTIMO punto conservado
 * (no del punto crudo anterior) — mismo criterio que el distanceFilter real del SDK nativo.
 * A propósito NO fuerza el último punto crudo: un distanceFilter real tampoco lo hace, y la
 * cola sin forzar es justamente lo que la métrica de desviación necesita poder medir.
 */
export function submuestrearPorDistancia(puntos, distMinM) {
  const n = puntos.length;
  const retenido = new Array(n).fill(false);
  if (n === 0) return retenido;
  retenido[0] = true;
  let ultimo = puntos[0];
  for (let i = 1; i < n; i++) {
    const d = haversineMetros([puntos[i].lng, puntos[i].lat], [ultimo.lng, ultimo.lat]);
    if (d >= distMinM) {
      retenido[i] = true;
      ultimo = puntos[i];
    }
  }
  return retenido;
}

/** Submuestreo por tiempo: conserva un punto solo si pasaron >= `intervaloS` desde el último
 * conservado. Mismo criterio de "no forzar el último punto" que el submuestreo por distancia. */
export function submuestrearPorTiempo(puntos, intervaloS) {
  const n = puntos.length;
  const retenido = new Array(n).fill(false);
  if (n === 0) return retenido;
  retenido[0] = true;
  let ultimoTs = puntos[0].ts;
  const intervaloMs = intervaloS * 1000;
  for (let i = 1; i < n; i++) {
    if (puntos[i].ts - ultimoTs >= intervaloMs) {
      retenido[i] = true;
      ultimoTs = puntos[i].ts;
    }
  }
  return retenido;
}

/**
 * Desviación de cada punto crudo respecto de la polilínea simplificada (retenido). Para el
 * punto crudo i se mide contra el segmento de la polilínea que temporalmente lo contiene —
 * dos punteros, O(n) total, válido porque tanto la traza cruda como la simplificada
 * conservan el orden cronológico. Devuelve un array de distancias en metros, uno por punto
 * crudo (0 para los puntos que la variante sí conservó, por construcción).
 */
export function calcularDesviaciones(rawXY, retenido) {
  const keptIdx = [];
  for (let i = 0; i < retenido.length; i++) if (retenido[i]) keptIdx.push(i);

  const desviaciones = new Array(rawXY.length).fill(0);
  if (keptIdx.length === 0) return desviaciones;
  if (keptIdx.length === 1) {
    const unico = rawXY[keptIdx[0]];
    for (let i = 0; i < rawXY.length; i++) {
      desviaciones[i] = Math.hypot(rawXY[i].x - unico.x, rawXY[i].y - unico.y);
    }
    return desviaciones;
  }

  let seg = 0;
  for (let i = 0; i < rawXY.length; i++) {
    while (seg < keptIdx.length - 2 && i > keptIdx[seg + 1]) seg++;
    const a = rawXY[keptIdx[seg]];
    const b = rawXY[keptIdx[seg + 1]];
    desviaciones[i] = distanciaPuntoASegmento(rawXY[i], a, b);
  }
  return desviaciones;
}

/** Percentil por rango más cercano (redondeando hacia arriba) sobre una copia ordenada. */
export function percentil(valores, p) {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((x, y) => x - y);
  const idx = Math.min(ordenado.length - 1, Math.max(0, Math.ceil((p / 100) * ordenado.length) - 1));
  return ordenado[idx];
}

/** Suma de haversine entre puntos consecutivos, en km. */
export function longitudKm(puntosLatLng) {
  let metros = 0;
  for (let i = 1; i < puntosLatLng.length; i++) {
    metros += haversineMetros(
      [puntosLatLng[i - 1].lng, puntosLatLng[i - 1].lat],
      [puntosLatLng[i].lng, puntosLatLng[i].lat],
    );
  }
  return metros / 1000;
}

/*
 * === Réplica de la máquina de estados de puntos de control ===
 * Fuente: apps/mobile/src/gps/geofence.ts. Se replica la lógica de histéresis
 * multi-vuelta para poder recalcular "pasadas por punto de control" sobre cualquier
 * subconjunto de la traza (baseline y cada variante) y compararlas.
 *
 * Constantes citadas literal de la fuente:
 *   - FACTOR_REARME_RADIO = 1.5           (geofence.ts:89)
 *   - FIXES_REARME_CONSECUTIVOS = 2       (geofence.ts:104)
 *   - PASADA_MIN_MS = 2 * 60 * 1000       (geofence.ts:174)
 * Detección por punto de control (distancia haversine <= radio): detectarPuntosControlCercanos,
 * geofence.ts:38-61. Máquina de estados (tabla y cuerpo): filtrarNuevosCumplimientos,
 * geofence.ts:253-261 (tabla) y 263-385 (cuerpo) — la rama de avisosPrecision (M3, solo
 * telemetría de Sentry en producción) se omite acá a propósito: no afecta qué se emite ni
 * cuándo, solo genera un breadcrumb que esta réplica no necesita.
 */
export const FACTOR_REARME_RADIO = 1.5;
export const FIXES_REARME_CONSECUTIVOS = 2;
export const PASADA_MIN_MS = 2 * 60 * 1000;

function estadoInicialPc() {
  return { dentro: false, ultimoEmitidoMs: -Infinity, pasadas: 0, fixesFueraRadioRearme: 0, ultimoFixMs: -Infinity };
}

/** geofence.ts:38-61 — detectarPuntosControlCercanos, con la misma normalización de accuracy
 * (no finita, negativa o ausente => sin margen de error conocido). */
export function detectarCercanos(lat, lng, puntosControl, accuracyM) {
  const accuracyNormalizada =
    typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM >= 0 ? accuracyM : undefined;
  return puntosControl.map((pc) => {
    const distanciaM = haversineMetros([lng, lat], [pc.lng, pc.lat]);
    return {
      puntoControlId: pc.id,
      distanciaM,
      cumplido: distanciaM <= pc.radioToleranciaM,
      radioToleranciaM: pc.radioToleranciaM,
      accuracyM: accuracyNormalizada,
    };
  });
}

/** geofence.ts:263-385 — filtrarNuevosCumplimientos, adaptada a un solo punto de control por
 * llamada (el caller itera las detecciones de un tick) y sin sesionId (un solo recorrido a la
 * vez acá, así que la clave es directamente puntoControlId). */
function pasoFiltroUnPc(estado, deteccion, tsFixMs) {
  const ultimoFixMs = estado.ultimoFixMs ?? -Infinity;
  if (tsFixMs <= ultimoFixMs) return { emitir: false, estado };

  const margenM = deteccion.accuracyM ?? 0;

  if (!estado.dentro) {
    if (deteccion.cumplido && tsFixMs - estado.ultimoEmitidoMs >= PASADA_MIN_MS) {
      const pasada = estado.pasadas + 1;
      return {
        emitir: true,
        pasada,
        estado: { dentro: true, ultimoEmitidoMs: tsFixMs, pasadas: pasada, fixesFueraRadioRearme: 0, ultimoFixMs: tsFixMs },
      };
    }
    if (deteccion.cumplido) {
      return {
        emitir: false,
        estado: { ...estado, dentro: true, fixesFueraRadioRearme: 0, ultimoFixMs: tsFixMs },
      };
    }
    return { emitir: false, estado: { ...estado, ultimoFixMs: tsFixMs } };
  }

  const radioRearme = deteccion.radioToleranciaM * FACTOR_REARME_RADIO;
  if (deteccion.distanciaM - margenM > radioRearme) {
    const consecutivos = (estado.fixesFueraRadioRearme ?? 0) + 1;
    if (consecutivos >= FIXES_REARME_CONSECUTIVOS) {
      return {
        emitir: false,
        estado: { ...estado, dentro: false, fixesFueraRadioRearme: 0, ultimoFixMs: tsFixMs },
      };
    }
    return {
      emitir: false,
      estado: { ...estado, fixesFueraRadioRearme: consecutivos, ultimoFixMs: tsFixMs },
    };
  }
  if (deteccion.distanciaM > radioRearme) {
    return { emitir: false, estado: { ...estado, ultimoFixMs: tsFixMs } };
  }
  return { emitir: false, estado: { ...estado, fixesFueraRadioRearme: 0, ultimoFixMs: tsFixMs } };
}

/**
 * Corre la máquina de estados sobre una secuencia de puntos (ya en orden cronológico) contra
 * todos los puntos de control. Devuelve un Map puntoControlId -> array de { ts, pasada }
 * emitidos, en el orden en que se emitieron.
 */
export function calcularPasadasPorTraza(puntosOrdenados, puntosControl) {
  const estados = new Map(puntosControl.map((pc) => [pc.id, estadoInicialPc()]));
  const emitidosPorPc = new Map(puntosControl.map((pc) => [pc.id, []]));

  for (const p of puntosOrdenados) {
    const detecciones = detectarCercanos(p.lat, p.lng, puntosControl, p.accuracy);
    for (const deteccion of detecciones) {
      const estadoActual = estados.get(deteccion.puntoControlId);
      const resultado = pasoFiltroUnPc(estadoActual, deteccion, p.ts);
      estados.set(deteccion.puntoControlId, resultado.estado);
      if (resultado.emitir) {
        emitidosPorPc.get(deteccion.puntoControlId).push({ ts: p.ts, pasada: resultado.pasada });
      }
    }
  }
  return emitidosPorPc;
}

/** Cuenta de pasadas por PC a partir del Map que devuelve calcularPasadasPorTraza. */
function conteoPorPc(emitidosPorPc) {
  const conteo = new Map();
  for (const [pcId, eventos] of emitidosPorPc) conteo.set(pcId, eventos.length);
  return conteo;
}

/** Compara pasadas de una variante contra el baseline, PC por PC. */
export function compararPasadas(baselineConteo, variantConteo) {
  let perdidas = 0;
  let extra = 0;
  const detalle = {};
  for (const [pcId, nBase] of baselineConteo) {
    const nVar = variantConteo.get(pcId) ?? 0;
    const diff = nVar - nBase;
    if (diff < 0) perdidas += -diff;
    if (diff > 0) extra += diff;
    detalle[pcId] = { baseline: nBase, variante: nVar };
  }
  return { perdidas, extra, detalle };
}

const JORNADA_REFERENCIA_PUNTOS = 6000;
export const DP_TOLERANCIAS_M = [2, 5, 10, 20];
export const ZONA_PROTEGIDA_MARGEN_M = 50;
export const DIST_SUBMUESTREO_M = [30, 50, 80];
export const TIEMPO_SUBMUESTREO_S = [15, 30, 60];

function construirVariante(nombre, tipo, parametro, retenido, rawLatLng, rawXY, rawKm, rawCount, baselineConteoPc, puntosControl) {
  const puntosGuardados = retenido.reduce((acc, v) => acc + (v ? 1 : 0), 0);
  const desviaciones = calcularDesviaciones(rawXY, retenido);
  const puntosVariante = rawLatLng.filter((_, i) => retenido[i]);
  const kmVariante = longitudKm(puntosVariante);
  const conteoPc = conteoPorPc(calcularPasadasPorTraza(puntosVariante, puntosControl));
  const comparacion = compararPasadas(baselineConteoPc, conteoPc);

  return {
    nombre,
    tipo,
    parametro,
    puntosGuardados,
    pctVsCrudo: rawCount === 0 ? 0 : (puntosGuardados / rawCount) * 100,
    desviacionMaxM: Math.max(0, ...desviaciones),
    desviacionP95M: percentil(desviaciones, 95),
    kmTotales: kmVariante,
    difKmPct: rawKm === 0 ? 0 : ((kmVariante - rawKm) / rawKm) * 100,
    pasadasPerdidas: comparacion.perdidas,
    pasadasExtra: comparacion.extra,
    detallePasadasPorPc: comparacion.detalle,
    puntosDiaProyectado6000: puntosGuardados * (JORNADA_REFERENCIA_PUNTOS / rawCount),
  };
}

/**
 * Punto de entrada puro del pipeline completo. `datos` = { gpsPoints, puntosControl,
 * cumplimientos } ya parseados (arrays de objetos tipados, ver parseoCsv* más abajo para el
 * shape esperado). No toca disco — usable directo desde el test con una traza sintética.
 */
export function ejecutarPipeline(datos) {
  const gpsPoints = [...datos.gpsPoints].sort((a, b) => a.ts - b.ts);
  const puntosControl = datos.puntosControl ?? [];
  const cumplimientos = datos.cumplimientos ?? [];

  const rawCount = gpsPoints.length;
  const origen = centroide(gpsPoints);
  const rawXY = proyectarAMetros(gpsPoints, origen);
  const rawKm = longitudKm(gpsPoints);
  const baselineEmitidos = calcularPasadasPorTraza(gpsPoints, puntosControl);
  const baselineConteoPc = conteoPorPc(baselineEmitidos);

  const baseline = {
    puntos: rawCount,
    pctVsCrudo: 100,
    kmTotales: rawKm,
    pasadasPorPc: Object.fromEntries(baselineConteoPc),
    puntosDiaProyectado6000: rawCount === 0 ? 0 : rawCount * (JORNADA_REFERENCIA_PUNTOS / rawCount),
  };

  const variantes = [];

  for (const tol of DP_TOLERANCIAS_M) {
    const retenido = douglasPeucker(rawXY, tol);
    variantes.push(
      construirVariante('dp-' + tol, 'douglas-peucker', tol, retenido, gpsPoints, rawXY, rawKm, rawCount, baselineConteoPc, puntosControl),
    );
  }

  const zonaProtegida = puntosControl.length > 0 ? marcarZonaProtegida(gpsPoints, puntosControl, ZONA_PROTEGIDA_MARGEN_M) : gpsPoints.map(() => false);
  for (const tol of DP_TOLERANCIAS_M) {
    const retenidoDp = douglasPeucker(rawXY, tol);
    const retenido = combinarRetenido(retenidoDp, zonaProtegida);
    variantes.push(
      construirVariante(
        'dp-' + tol + '-zona-protegida',
        'douglas-peucker-zona-protegida',
        tol,
        retenido,
        gpsPoints,
        rawXY,
        rawKm,
        rawCount,
        baselineConteoPc,
        puntosControl,
      ),
    );
  }

  for (const distM of DIST_SUBMUESTREO_M) {
    const retenido = submuestrearPorDistancia(gpsPoints, distM);
    variantes.push(
      construirVariante('distancia-' + distM + 'm', 'submuestreo-distancia', distM, retenido, gpsPoints, rawXY, rawKm, rawCount, baselineConteoPc, puntosControl),
    );
  }

  for (const seg of TIEMPO_SUBMUESTREO_S) {
    const retenido = submuestrearPorTiempo(gpsPoints, seg);
    variantes.push(
      construirVariante('tiempo-' + seg + 's', 'submuestreo-tiempo', seg, retenido, gpsPoints, rawXY, rawKm, rawCount, baselineConteoPc, puntosControl),
    );
  }

  let sanityCheckCumplimientos = null;
  if (cumplimientos.length > 0) {
    const realesPorPc = new Map();
    for (const c of cumplimientos) {
      const actual = realesPorPc.get(c.puntoControlId) ?? 0;
      realesPorPc.set(c.puntoControlId, actual + 1);
    }
    const pcIds = new Set([...baselineConteoPc.keys(), ...realesPorPc.keys()]);
    sanityCheckCumplimientos = [...pcIds].map((pcId) => ({
      puntoControlId: pcId,
      pasadasBaselineRecalculadas: baselineConteoPc.get(pcId) ?? 0,
      pasadasRealesRegistradas: realesPorPc.get(pcId) ?? 0,
    }));
  }

  return {
    generadoEn: new Date().toISOString(),
    entrada: {
      puntosCrudos: rawCount,
      kmCrudos: rawKm,
      puntosControl: puntosControl.length,
      tieneCumplimientosReales: cumplimientos.length > 0,
    },
    jornadaReferenciaPuntos: JORNADA_REFERENCIA_PUNTOS,
    baseline,
    variantes,
    sanityCheckCumplimientos,
  };
}

// === I/O: CSV -> objetos tipados, y resultado -> markdown/JSON (solo usado por main()) ===

function parseCsv(texto) {
  const lineas = texto.split('\n').filter((l) => l.length > 0);
  if (lineas.length === 0) return { columnas: [], filas: [] };
  const columnas = parseLineaCsv(lineas[0]);
  const filas = lineas.slice(1).map((linea) => {
    const valores = parseLineaCsv(linea);
    const fila = {};
    columnas.forEach((col, i) => {
      fila[col] = valores[i] ?? '';
    });
    return fila;
  });
  return { columnas, filas };
}

function parseLineaCsv(linea) {
  const valores = [];
  let actual = '';
  let dentroDeComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (dentroDeComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          dentroDeComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      dentroDeComillas = true;
    } else if (c === ',') {
      valores.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  valores.push(actual);
  return valores;
}

function numeroOVacio(texto) {
  if (texto === undefined || texto === '') return undefined;
  const n = Number(texto);
  return Number.isNaN(n) ? undefined : n;
}

function leerGpsPointsCsv(ruta) {
  const { filas } = parseCsv(readFileSync(ruta, 'utf8'));
  return filas.map((f) => ({
    ts: Date.parse(f.ts),
    lat: Number(f.lat),
    lng: Number(f.lng),
    accuracy: numeroOVacio(f.accuracy),
    speed: numeroOVacio(f.speed),
  }));
}

function leerPuntosControlCsv(ruta) {
  const { filas } = parseCsv(readFileSync(ruta, 'utf8'));
  return filas.map((f) => ({
    id: f.id,
    orden: Number(f.orden),
    lat: Number(f.lat),
    lng: Number(f.lng),
    radioToleranciaM: Number(f.radio_tolerancia_m),
    obligatorio: f.obligatorio === 'true',
    estado: f.estado,
  }));
}

function leerCumplimientosCsv(ruta) {
  const { filas } = parseCsv(readFileSync(ruta, 'utf8'));
  return filas.map((f) => ({
    puntoControlId: f.punto_control_id,
    ts: Date.parse(f.ts),
    distanciaM: Number(f.distancia_m),
    cumplido: f.cumplido === 'true',
    validadoPor: f.validado_por,
    pasada: f.pasada === '' ? null : Number(f.pasada),
  }));
}

function num(v, decimales = 1) {
  return Number(v).toFixed(decimales);
}

function generarMarkdown(resultado) {
  const filasBaseline = [
    '| crudo (baseline) | ' +
      resultado.baseline.puntos +
      ' | 100.0 | 0.0 | 0.0 | ' +
      num(resultado.baseline.kmTotales, 2) +
      ' | 0.0 | 0 | 0 | ' +
      num(resultado.baseline.puntosDiaProyectado6000, 0) +
      ' |',
  ];
  const filasVariantes = resultado.variantes.map(
    (v) =>
      '| ' +
      v.nombre +
      ' | ' +
      v.puntosGuardados +
      ' | ' +
      num(v.pctVsCrudo, 1) +
      ' | ' +
      num(v.desviacionMaxM, 1) +
      ' | ' +
      num(v.desviacionP95M, 1) +
      ' | ' +
      num(v.kmTotales, 2) +
      ' | ' +
      num(v.difKmPct, 1) +
      ' | ' +
      v.pasadasPerdidas +
      ' | ' +
      v.pasadasExtra +
      ' | ' +
      num(v.puntosDiaProyectado6000, 0) +
      ' |',
  );

  let md = '# Resultado — simplificación de traza GPS\n\n';
  md += 'Generado: ' + resultado.generadoEn + '\n\n';
  md +=
    'Entrada: ' +
    resultado.entrada.puntosCrudos +
    ' puntos crudos, ' +
    num(resultado.entrada.kmCrudos, 2) +
    ' km, ' +
    resultado.entrada.puntosControl +
    ' puntos de control. Proyección a jornada de referencia: ' +
    resultado.jornadaReferenciaPuntos +
    ' puntos/día.\n\n';
  md +=
    '| Variante | Puntos | % vs crudo | Desv. máx (m) | Desv. p95 (m) | km | Dif. km (%) | Pasadas perdidas | Pasadas extra | Puntos/día proyectado (6000) |\n';
  md += '|---|---|---|---|---|---|---|---|---|---|\n';
  md += filasBaseline.join('\n') + '\n';
  md += filasVariantes.join('\n') + '\n';

  if (resultado.sanityCheckCumplimientos) {
    md += '\n## Sanity check — baseline recalculado vs cumplimientos_pc reales\n\n';
    md += '| Punto de control | Pasadas baseline (recalculadas) | Pasadas reales (cumplimientos_pc) | Diferencia |\n';
    md += '|---|---|---|---|\n';
    for (const fila of resultado.sanityCheckCumplimientos) {
      md +=
        '| ' +
        fila.puntoControlId +
        ' | ' +
        fila.pasadasBaselineRecalculadas +
        ' | ' +
        fila.pasadasRealesRegistradas +
        ' | ' +
        (fila.pasadasBaselineRecalculadas - fila.pasadasRealesRegistradas) +
        ' |\n';
    }
  } else {
    md += '\nSin cumplimientos_pc_sesion.csv: no se pudo hacer el sanity check contra cumplimientos reales.\n';
  }

  return md;
}

function main() {
  const dirDatos = join(aqui, 'datos');
  const dirResultados = join(aqui, 'resultados');

  const rutaGps = join(dirDatos, 'gps_points_sesion.csv');
  if (!existsSync(rutaGps)) {
    console.error('simplificar: falta ' + rutaGps + ' — correr primero exportar-sesion.cjs + parsear-logs.mjs.');
    process.exitCode = 1;
    return;
  }

  const gpsPoints = leerGpsPointsCsv(rutaGps);
  const rutaPc = join(dirDatos, 'puntos_control_ruta.csv');
  const puntosControl = existsSync(rutaPc) ? leerPuntosControlCsv(rutaPc) : [];
  const rutaCump = join(dirDatos, 'cumplimientos_pc_sesion.csv');
  const cumplimientos = existsSync(rutaCump) ? leerCumplimientosCsv(rutaCump) : [];

  const resultado = ejecutarPipeline({ gpsPoints, puntosControl, cumplimientos });

  mkdirSync(dirResultados, { recursive: true });
  writeFileSync(join(dirResultados, 'simplificar-resultado.json'), JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  writeFileSync(join(dirResultados, 'simplificar-resultado.md'), generarMarkdown(resultado), 'utf8');

  console.log('simplificar: OK — resultados en ' + dirResultados);
  console.log('  puntos crudos: ' + resultado.entrada.puntosCrudos + ', km: ' + num(resultado.entrada.kmCrudos, 2));
  for (const v of resultado.variantes) {
    console.log(
      '  ' +
        v.nombre +
        ': ' +
        v.puntosGuardados +
        ' puntos (' +
        num(v.pctVsCrudo, 1) +
        '%), desv. p95 ' +
        num(v.desviacionP95M, 1) +
        ' m, pasadas perdidas ' +
        v.pasadasPerdidas +
        ', extra ' +
        v.pasadasExtra,
    );
  }
}

const esCliDirecto = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;
if (esCliDirecto) {
  main();
}
