import {
  bearingEnAvance,
  distanciaEntreAvancesM,
  largoTotalM,
  posicionEnPolilinea,
} from './datos/geometria';
import { LINEAS_MOCK, TRUFIS_MOCK } from './datos/datos';
import type { LineaMockId, ParadaMock } from './datos/tipos';

/**
 * Motor del APK demo del conductor (`docs/plan-apk-demo-conductor.md`, paso A) — reducer PURO
 * (nada de `Date.now()`/`setInterval` adentro: el reloj entra como parámetro `ahora` en cada
 * función) que simula las 8 unidades mock (5 Z12 + 3 Línea 120, mismos datos que
 * `apps/web/src/lib/mock-flota`) para que la app del conductor pueda arrancar/avanzar/detener
 * un recorrido, mostrar quién va adelante/atrás y qué unidades hay en cola, todo sin backend.
 *
 * `demo-provider.tsx` es el único lugar que llama `tick()` (con un `setInterval` de 1 s) y
 * envuelve las demás funciones como `acciones` del contexto — este archivo no sabe nada de
 * React.
 */

// ================================================================================================
// Constantes de simulación.
// ================================================================================================

/** Velocidad nominal de un trufi urbano — usada para AMBOS (a) avanzar las unidades por su
 * polilínea y (b) calcular los minutos de ETA de `adelanteAtras`. Deliberadamente NO se escala
 * por `velocidadDemo` en el cálculo de minutos mostrado (ver `vecinoDesde`) — `velocidadDemo`
 * acelera el RELOJ de la simulación (para no esperar en vivo), no la físca del vehículo. */
export const VELOCIDAD_NOMINAL_KMH = 20;
const VELOCIDAD_NOMINAL_MPS = (VELOCIDAD_NOMINAL_KMH * 1000) / 3600;

/** Frecuencia de salida de cada línea (RF del guion: "Z12 cada 8 min / L120 cada 12 min"). */
export const FRECUENCIA_MS: Record<LineaMockId, number> = {
  z12: 8 * 60_000,
  l120: 12 * 60_000,
};

/** Cadencia de un "punto GPS" simulado — cada ~5 s de tiempo SIMULADO (ya escalado por
 * `velocidadDemo`) mientras la jornada está activa: alimenta tanto el buffer de "sin señal"
 * (`puntosPendientes`) como el crecimiento de `datosHoyMB`. */
const INTERVALO_PUNTO_GPS_MS = 5_000;
/** Exportadas — `use-gps-operativo-demo.ts` las reusa para derivar un contador de "puntos GPS
 * grabados" a partir de `datosHoyMB`, y `usePerfilDemo`/la tarjeta "Datos de hoy" (B/C) para
 * mostrar la base sin duplicar el número mágico. */
export const MB_POR_PUNTO = 0.004;
export const DATOS_HOY_BASE_MB = 1.8;

/** Duración de la fase `sincronizando` tras `recuperarSenal` — también escalada por
 * `velocidadDemo`, para que ×4 acorte la espera visible igual que acorta todo lo demás. */
const MS_SINCRONIZANDO_BASE = 3_000;

/** Tope de `dt` por tick (segundos REALES, antes de escalar por `velocidadDemo`) — si la app
 * estuvo en background (o el debugger pausó el JS) y `tick()` recibe un salto grande de
 * `ahora`, no queremos que las unidades salten kilómetros de una sola vez. */
const DT_MAXIMO_S = 5;

// ================================================================================================
// Tipos del estado.
// ================================================================================================

export type FaseUnidadDemo = 'en_cola' | 'en_ruta' | 'finalizado';
export type EstadoSenalDemo = 'ok' | 'sin_senal' | 'sincronizando';

export interface UnidadDemo {
  trufiId: string;
  lineaId: LineaMockId;
  fase: FaseUnidadDemo;
  /** `[0, 1)` — fracción de recorrido sobre `LINEAS_MOCK[lineaId].polilinea`. Sin significado
   * mientras `fase === 'en_cola'` (la unidad está en la terminal, avance `0`). */
  avance: number;
}

/** Espejo mínimo de `DeteccionPuntoControl` (`apps/mobile/src/gps/geofence.ts`) — el contrato
 * real trae más campos opcionales (accuracy, fase de aproximación) que el motor demo no
 * necesita simular; `use-gps-operativo-demo.ts` completa el resto al mapear a
 * `DeteccionPuntoControl` real para que el toast/sonido existentes disparen igual. */
export interface DeteccionPuntoControlDemo {
  puntoControlId: string;
  distanciaM: number;
  /** Número de pasada de ESTE punto de control (1ª, 2ª... si el chofer reinicia jornada varias
   * veces en la misma sesión demo) — mismo propósito que `DeteccionPuntoControl.pasada` real:
   * distinguir dos cruces del mismo punto para no deduplicar el toast entre vueltas. */
  pasada: number;
  /** epoch ms de cuándo se cruzó. */
  en: number;
}

export type TipoReporteDemo =
  | 'fuera_de_orden'
  | 'pinchazo'
  | 'control_policial'
  | 'bloqueo_via'
  | 'falla_mecanica'
  | 'incidente_pasajero'
  | 'otro';

/** Etiquetas en español para los chips del modal "Reportar" (guion E06 03:36). */
export const ETIQUETAS_TIPO_REPORTE_DEMO: Record<TipoReporteDemo, string> = {
  fuera_de_orden: 'Vehículo fuera de orden',
  pinchazo: 'Pinchazo',
  control_policial: 'Control policial',
  bloqueo_via: 'Bloqueo de vía',
  falla_mecanica: 'Falla mecánica',
  incidente_pasajero: 'Incidente con pasajero',
  otro: 'Otro',
};

export interface ReporteDemo {
  id: string;
  tipo: TipoReporteDemo;
  /** Solo con `tipo === 'fuera_de_orden'` — placa elegida de una lista con fotos. */
  placaReportada?: string;
  nota?: string;
  creadoEn: number;
  /** `'pendiente'` mientras `senal !== 'ok'` en el momento de crearlo — pasa a `'enviado'`
   * cuando `recuperarSenal` termina de "sincronizar" (ver `resolverSincronizacion`). */
  estado: 'enviado' | 'pendiente';
}

export interface EstadoMotorDemo {
  /** Último `ahora` (epoch ms) procesado — referencia para calcular `dt` en el próximo
   * `tick()`. */
  ahora: number;
  /** FIX POST-REVISIÓN (hallazgo de revisión): reloj SIMULADO — arranca igual a `ahora` en
   * `crearEstadoInicial` y en cada `tick()` avanza `dtSim` (el `dt` YA escalado por
   * `velocidadDemo`), nunca el `dt` real. Antes, `despacharPendientes`/`salidaBase` comparaban
   * contra el `ahora` REAL: con `velocidadDemo` ×4 las unidades avanzaban 4× más rápido por su
   * polilínea (`avanzarUnidades` sí usa `dtSim`) pero la próxima salida de la cola seguía
   * tardando los mismos minutos REALES de siempre (`FRECUENCIA_MS`) — el espaciado entre
   * unidades se rompía (llegaban a destino mucho antes de que saliera la siguiente). Con
   * `ahoraSimulado`, `salidaBase`/`FRECUENCIA_MS` viven en el MISMO reloj que el avance físico,
   * así que el espaciado se mantiene correcto sin importar la velocidad — incluida si se cambia
   * a mitad de una espera (el acumulado ya recorrido no se re-escala, solo el próximo tramo). */
  ahoraSimulado: number;
  trufiPropioId: string;
  lineaPropiaId: LineaMockId;
  velocidadDemo: 1 | 4;
  /** Las 8 unidades mock (ambas líneas), por `trufiId`. */
  unidades: Record<string, UnidadDemo>;
  /** Cola de salida por línea — solo unidades `en_cola`, en orden (índice 0 = próxima a
   * despachar). */
  colas: Record<LineaMockId, string[]>;
  /** epoch ms en que le toca salir a `colas[linea][0]` — las siguientes posiciones de la cola
   * salen `FRECUENCIA_MS[linea]` más tarde cada una (ver `proximaSalidaDe`). */
  salidaBase: Record<LineaMockId, number>;
  /** Jornada propia activa (equivalente a `tracking` de `useGpsOperativo` real). */
  tracking: boolean;
  senal: EstadoSenalDemo;
  /** Puntos GPS acumulados sin enviar mientras `senal === 'sin_senal'`. */
  puntosPendientes: number;
  /** epoch ms en que termina la fase `sincronizando` — `null` fuera de esa fase. */
  sincronizandoHasta: number | null;
  ultimaSincronizacion: number | null;
  /** Ids de paradas de control cruzadas por la unidad PROPIA en la vuelta/jornada actual. */
  puntosCumplidos: string[];
  /** Contador de pasadas por punto de control (persiste entre jornadas de la misma sesión
   * demo — solo `reiniciar()` lo limpia), para que `DeteccionPuntoControlDemo.pasada` refleje
   * una 2ª vuelta si el chofer reinicia/vuelve a iniciar jornada. */
  pasadasPorPunto: Record<string, number>;
  ultimaDeteccion: DeteccionPuntoControlDemo | null;
  reportes: ReporteDemo[];
  /** "Datos de hoy" mock (MB) — crece con cada punto GPS simulado mientras hay jornada activa. */
  datosHoyMB: number;
  /** Acumulador interno (ms SIMULADOS) hacia el próximo punto GPS — detalle de implementación
   * de `tick()`, no forma parte de lo que lee la UI. */
  acumuladorPuntoGpsMs: number;
}

// ================================================================================================
// Estado inicial.
// ================================================================================================

/**
 * Arma el estado inicial para una sesión demo con `trufiPropioId` como unidad del chofer.
 *
 * Escenario (plan §"Initial scenario"): dentro de la línea propia, las unidades que salen ANTES
 * en el orden de `TRUFIS_MOCK` ya están `en_ruta`, repartidas a lo largo de la ruta (la que
 * salió hace más tiempo, más avanzada) — así siempre hay una unidad ADELANTE apenas el chofer
 * inicia. Las que salen DESPUÉS quedan `en_cola`, con la propia AL FRENTE de esa cola (todas las
 * que iban antes que ella ya se fueron). La otra línea (la que no maneja este chofer) se siembra
 * con el mismo criterio, usando el punto medio de su flota como referencia — no la observa nadie
 * en esta sesión, pero mantiene el motor consistente si algún día se necesita.
 *
 * FIX POST-REVISIÓN (hallazgo en teléfono real): la fórmula anterior repartía a las unidades ya
 * `en_ruta` a fracciones fijas (`0.9`, `0.9*2/3`, ...) del largo TOTAL de la polilínea de la
 * línea, sin ninguna relación con la frecuencia real de salida. En Z12 (circuito de ~38 km) eso
 * dejaba a la unidad más cercana adelante a ~11 km del chofer al arrancar — demasiado lejos para
 * verse en cámara ("a 3,6 km" en el guion, no "a 11 km"). Ahora cada unidad que ya salió se ubica
 * a la distancia que HABRÍA RECORRIDO a velocidad nominal desde su salida, sabiendo que las
 * salidas están separadas por `FRECUENCIA_MS[línea]` entre sí (mismo modelo que usa la cola en
 * régimen — ver `despacharPendientes`): la unidad que salió 1 período antes queda a
 * `FRECUENCIA_MS * VELOCIDAD_NOMINAL_MPS` metros (≈2,7 km en Z12 a 8 min/20 km·h⁻¹, ≈4 km en
 * Línea 120 a 12 min), la que salió 2 períodos antes al doble, etc. — ver `reubicarAdelante` para
 * el acotado a [1,5, 4] km y el porqué de escalar los gaps en vez de clampear cada uno por
 * separado.
 *
 * FIX POST-REVISIÓN #2 (hallazgo — "el espaciado inicial solo vale si se toca 'Iniciar' de
 * inmediato"): las unidades que ya están `en_ruta` en la línea propia se SIGUEN moviendo mientras
 * el chofer espera en la cola (`avanzarUnidades` no distingue "propia esperando" de "propia en
 * ruta" para las unidades ajenas) — a razón de ~333 m/min, 2 minutos de espera ya alejan a la más
 * cercana casi 700 m del rango pensado. Por eso este cálculo de siembra inicial es solo el punto
 * de PARTIDA (`ahora === ahoraSimulado`, espera cero); `iniciarJornada` vuelve a llamar
 * `reubicarAdelante` en el momento real en que el chofer arranca, para corregir el corrimiento
 * acumulado durante la espera (ver su FIX POST-REVISIÓN).
 */
export function crearEstadoInicial(trufiPropioId: string, ahora: number): EstadoMotorDemo {
  const propio = TRUFIS_MOCK.find((t) => t.id === trufiPropioId);
  if (!propio) {
    throw new Error(`crearEstadoInicial: trufi desconocido "${trufiPropioId}"`);
  }
  const lineaPropiaId = propio.lineaId;

  const unidades: Record<string, UnidadDemo> = {};
  const colas: Record<LineaMockId, string[]> = { z12: [], l120: [] };
  const salidaBase: Record<LineaMockId, number> = {
    z12: ahora + FRECUENCIA_MS.z12,
    l120: ahora + FRECUENCIA_MS.l120,
  };

  (['z12', 'l120'] as const).forEach((lineaId) => {
    const flota = TRUFIS_MOCK.filter((t) => t.lineaId === lineaId);
    const esPropia = lineaId === lineaPropiaId;
    const posicionPropia = esPropia
      ? flota.findIndex((t) => t.id === trufiPropioId) + 1
      : Math.ceil(flota.length / 2);
    const largoTotal = largoTotalM(LINEAS_MOCK[lineaId].polilinea);
    const frecuenciaS = FRECUENCIA_MS[lineaId] / 1000;
    const distanciaPeriodoM = frecuenciaS * VELOCIDAD_NOMINAL_MPS;

    // Ya salieron antes — nearest ahead primero (mayor `posicion`, la más próxima a la propia),
    // con avances CRUDOS espaciados uniformemente por período (ver `reubicarAdelante`, que acota
    // la más cercana y escala el resto sin apilar ninguna).
    const yaSalieron = flota
      .map((trufi, indice) => ({ trufi, posicion: indice + 1 }))
      .filter(({ posicion }) => posicion < posicionPropia)
      .sort((a, b) => b.posicion - a.posicion);
    const crudas: UnidadDemo[] = yaSalieron.map(({ trufi }, rango) => ({
      trufiId: trufi.id,
      lineaId,
      fase: 'en_ruta',
      avance: largoTotal > 0 ? ((rango + 1) * distanciaPeriodoM) / largoTotal : 0,
    }));
    reubicarAdelante(crudas, largoTotal, frecuenciaS).forEach((u) => {
      unidades[u.trufiId] = u;
    });

    flota.forEach((trufi, indice) => {
      const posicion = indice + 1;
      if (posicion >= posicionPropia) {
        unidades[trufi.id] = { trufiId: trufi.id, lineaId, fase: 'en_cola', avance: 0 };
        colas[lineaId]!.push(trufi.id);
      }
    });
  });

  return {
    ahora,
    ahoraSimulado: ahora,
    trufiPropioId,
    lineaPropiaId,
    velocidadDemo: 1,
    unidades,
    colas,
    salidaBase,
    tracking: false,
    senal: 'ok',
    puntosPendientes: 0,
    sincronizandoHasta: null,
    ultimaSincronizacion: null,
    puntosCumplidos: [],
    pasadasPorPunto: {},
    ultimaDeteccion: null,
    reportes: [],
    datosHoyMB: DATOS_HOY_BASE_MB,
    acumuladorPuntoGpsMs: 0,
  };
}

// ================================================================================================
// Helpers internos.
// ================================================================================================

function paradasControlDe(lineaId: LineaMockId): ParadaMock[] {
  return LINEAS_MOCK[lineaId].paradas.filter((p) => p.esPuntoControl);
}

/** Distancia (metros) a la que debería quedar la unidad `en_ruta` más cercana adelante de la
 * terminal — un período de salida (`FRECUENCIA_MS` × `VELOCIDAD_NOMINAL_MPS`) acotado a
 * `[PISO_ADELANTE_M, TOPE_ADELANTE_M]` para que nunca se vea ni pegada a la terminal ni
 * perdida en el horizonte, sin importar la frecuencia/largo de cada línea. */
const PISO_ADELANTE_M = 1500;
const TOPE_ADELANTE_M = 4000;
/** Separación mínima (metros) entre dos unidades `en_ruta` consecutivas tras reubicar — nunca
 * colapsan al mismo `avance` (ver el hallazgo de revisión sobre `Math.min(0.95, …)` más abajo). */
const PISO_GAP_M = 50;

/**
 * Reubica un conjunto de unidades `en_ruta` de UNA MISMA línea, ya ordenadas ascendente por
 * `avance` (índice 0 = la de menor avance = la más cercana a la terminal = "adelante" más
 * cercano de la unidad propia, que arranca en `avance: 0`), para que la más cercana quede a
 * `distanciaPeriodoM` de la terminal (acotada a `[PISO_ADELANTE_M, TOPE_ADELANTE_M]`),
 * preservando el ORDEN y los gaps RELATIVOS entre unidades consecutivas: nunca las reordena y
 * nunca dos terminan en el mismo `avance`.
 *
 * Usada tanto para sembrar el escenario inicial (`crearEstadoInicial`) como para RE-sembrar la
 * línea propia al tocar "Iniciar recorrido" (`iniciarJornada`, ver su FIX POST-REVISIÓN) — en
 * ambos casos la entrada puede tener más de una unidad adelante, y los gaps entre ellas hay que
 * respetarlos, no aplastarlos.
 *
 * FIX POST-REVISIÓN (hallazgo de revisión — "el clamp por unidad apila varias en el mismo
 * avance"): la versión anterior (en `crearEstadoInicial`) hacía `Math.min(0.95, …)` UNIDAD POR
 * UNIDAD — con muchos períodos de por medio frente a un largo total chico (p. ej. Línea 120,
 * ~5 km de circuito completo), dos o más unidades podían caer en el mismo tope `0.95` y quedar
 * apiladas visualmente en el mapa. Acá se escala el gap de CADA unidad por el mismo factor (el
 * que acerca a la más cercana al rango buscado), con un piso de `PISO_GAP_M` por gap — así el
 * orden queda SIEMPRE estrictamente creciente, nunca colapsa.
 */
function reubicarAdelante(
  unidadesOrdenadas: UnidadDemo[],
  largoTotal: number,
  frecuenciaS: number,
): UnidadDemo[] {
  if (unidadesOrdenadas.length === 0 || largoTotal <= 0) return unidadesOrdenadas;

  const distanciaPeriodoM = frecuenciaS * VELOCIDAD_NOMINAL_MPS;
  const distanciaNominalM = Math.min(TOPE_ADELANTE_M, Math.max(PISO_ADELANTE_M, distanciaPeriodoM));
  const topeAbsolutoM = largoTotal * 0.95; // nunca "da la vuelta" y termina detrás de la propia

  const gapsM = unidadesOrdenadas.map((u, i) =>
    i === 0 ? u.avance * largoTotal : (u.avance - unidadesOrdenadas[i - 1]!.avance) * largoTotal,
  );
  const factor = gapsM[0]! > 0 ? distanciaNominalM / gapsM[0]! : 1;

  let distanciaAcumuladaM = 0;
  return unidadesOrdenadas.map((u, i) => {
    const gapEscalado = Math.max(PISO_GAP_M, gapsM[i]! * factor);
    distanciaAcumuladaM = Math.min(topeAbsolutoM, distanciaAcumuladaM + gapEscalado);
    return { ...u, avance: distanciaAcumuladaM / largoTotal };
  });
}

/** Paradas de control cruzadas al avanzar de `avanceAnterior` a `avanceNuevo` (circular), en
 * orden de cruce. Robusto a más de un cruce en el mismo tick (saltos grandes de `dt` o
 * `velocidadDemo` alta) — se detectan TODOS, no solo el primero. */
function puntosCruzados(
  paradas: ParadaMock[],
  avanceAnterior: number,
  avanceNuevo: number,
): ParadaMock[] {
  const delta = ((avanceNuevo - avanceAnterior) % 1 + 1) % 1;
  if (delta === 0) return [];
  return paradas
    .map((p) => ({ p, rel: ((p.avance - avanceAnterior) % 1 + 1) % 1 }))
    .filter(({ rel }) => rel > 0 && rel <= delta)
    .sort((a, b) => a.rel - b.rel)
    .map(({ p }) => p);
}

function avanzarUnidades(estado: EstadoMotorDemo, dtSim: number, ahora: number): EstadoMotorDemo {
  if (dtSim <= 0) return estado;

  const unidades: Record<string, UnidadDemo> = { ...estado.unidades };
  let colas = estado.colas;
  let puntosCumplidos = estado.puntosCumplidos;
  let pasadasPorPunto = estado.pasadasPorPunto;
  let ultimaDeteccion = estado.ultimaDeteccion;
  let tracking = estado.tracking;

  for (const unidad of Object.values(estado.unidades)) {
    if (unidad.fase !== 'en_ruta') continue;
    const esPropio = unidad.trufiId === estado.trufiPropioId;
    if (esPropio && !estado.tracking) continue; // la propia solo avanza con jornada activa

    const linea = LINEAS_MOCK[unidad.lineaId];
    const largoTotal = largoTotalM(linea.polilinea);
    if (largoTotal <= 0) continue;
    const avanceCrudo = unidad.avance + (dtSim * VELOCIDAD_NOMINAL_MPS) / largoTotal;

    if (esPropio) {
      const cruzadas = puntosCruzados(paradasControlDe(unidad.lineaId), unidad.avance, avanceCrudo);
      if (cruzadas.length > 0) {
        const nuevosCumplidos = [...puntosCumplidos];
        let pasadas = pasadasPorPunto;
        for (const parada of cruzadas) {
          if (!nuevosCumplidos.includes(parada.id)) nuevosCumplidos.push(parada.id);
          pasadas = { ...pasadas, [parada.id]: (pasadas[parada.id] ?? 0) + 1 };
        }
        const ultima = cruzadas[cruzadas.length - 1]!;
        puntosCumplidos = nuevosCumplidos;
        pasadasPorPunto = pasadas;
        ultimaDeteccion = { puntoControlId: ultima.id, distanciaM: 0, pasada: pasadas[ultima.id]!, en: ahora };
      }

      if (avanceCrudo >= 1) {
        // Vuelta/jornada completa — igual que "Finalizar recorrido" manual (soporta ambos).
        unidades[unidad.trufiId] = { ...unidad, fase: 'finalizado', avance: avanceCrudo % 1 };
        tracking = false;
      } else {
        unidades[unidad.trufiId] = { ...unidad, avance: avanceCrudo };
      }
    } else if (avanceCrudo >= 1) {
      // Unidad ajena: recicla al fondo de la cola de su línea — mantiene la demo viva.
      unidades[unidad.trufiId] = { ...unidad, fase: 'en_cola', avance: 0 };
      colas = { ...colas, [unidad.lineaId]: [...colas[unidad.lineaId], unidad.trufiId] };
    } else {
      unidades[unidad.trufiId] = { ...unidad, avance: avanceCrudo };
    }
  }

  return { ...estado, unidades, colas, puntosCumplidos, pasadasPorPunto, ultimaDeteccion, tracking };
}

/** Despacha automáticamente (`en_cola` → `en_ruta`) lo que corresponda por horario — la unidad
 * PROPIA nunca se despacha sola acá, solo por `iniciarJornada()`. `while` (no `if`) porque un
 * `dt` grande (velocidad ×4, o la app recuperando de background) puede deber más de una salida.
 * FIX POST-REVISIÓN: compara contra `ahoraSimulado` (ver el docblock de ese campo en
 * `EstadoMotorDemo`), NUNCA contra el `ahora` real — `salidaBase`/`FRECUENCIA_MS` viven en el
 * mismo reloj que el avance físico de las unidades. */
function despacharPendientes(estado: EstadoMotorDemo, ahoraSimulado: number): EstadoMotorDemo {
  let siguiente = estado;
  for (const lineaId of ['z12', 'l120'] as const) {
    let cola = siguiente.colas[lineaId];
    let base = siguiente.salidaBase[lineaId];
    let unidades = siguiente.unidades;
    let cambiado = false;

    while (cola.length > 0 && ahoraSimulado >= base) {
      const cabezaId = cola[0];
      if (!cabezaId || cabezaId === siguiente.trufiPropioId) break;
      const cabeza = unidades[cabezaId];
      if (!cabeza) break;
      unidades = { ...unidades, [cabezaId]: { ...cabeza, fase: 'en_ruta', avance: 0 } };
      cola = cola.slice(1);
      base += FRECUENCIA_MS[lineaId];
      cambiado = true;
    }

    if (cambiado) {
      siguiente = {
        ...siguiente,
        unidades,
        colas: { ...siguiente.colas, [lineaId]: cola },
        salidaBase: { ...siguiente.salidaBase, [lineaId]: base },
      };
    }
  }
  return siguiente;
}

function acumularPuntosGps(estado: EstadoMotorDemo, dtSim: number): EstadoMotorDemo {
  if (!estado.tracking || dtSim <= 0) return estado;
  let acumulador = estado.acumuladorPuntoGpsMs + dtSim * 1000;
  let puntosNuevos = 0;
  while (acumulador >= INTERVALO_PUNTO_GPS_MS) {
    acumulador -= INTERVALO_PUNTO_GPS_MS;
    puntosNuevos += 1;
  }
  if (puntosNuevos === 0) return { ...estado, acumuladorPuntoGpsMs: acumulador };

  const datosHoyMB = estado.datosHoyMB + puntosNuevos * MB_POR_PUNTO;
  const puntosPendientes =
    estado.senal === 'sin_senal' ? estado.puntosPendientes + puntosNuevos : estado.puntosPendientes;
  return { ...estado, acumuladorPuntoGpsMs: acumulador, datosHoyMB, puntosPendientes };
}

function resolverSincronizacion(estado: EstadoMotorDemo, ahora: number): EstadoMotorDemo {
  if (estado.senal !== 'sincronizando' || estado.sincronizandoHasta === null || ahora < estado.sincronizandoHasta) {
    return estado;
  }
  return {
    ...estado,
    senal: 'ok',
    sincronizandoHasta: null,
    ultimaSincronizacion: ahora,
    puntosPendientes: 0,
    reportes: estado.reportes.map((r) => (r.estado === 'pendiente' ? { ...r, estado: 'enviado' } : r)),
  };
}

// ================================================================================================
// Acciones — cada una es pura: `(estado, ...) => nuevoEstado`. `demo-provider.tsx` las envuelve
// en callbacks que llaman `setEstado(actual => accion(actual, ...))`.
// ================================================================================================

/** Avanza la simulación hasta `ahora` — única función que mueve el reloj. `demo-provider.tsx`
 * la llama cada 1 s real; el `dt` real se clampa a `DT_MAXIMO_S` antes de escalar por
 * `velocidadDemo`, para no hacer saltar las unidades kilómetros si el intervalo se atrasó
 * (app en background, debugger pausado). */
export function tick(estado: EstadoMotorDemo, ahora: number): EstadoMotorDemo {
  const dtReal = Math.max(0, Math.min(DT_MAXIMO_S, (ahora - estado.ahora) / 1000));
  const dtSim = dtReal * estado.velocidadDemo;
  // FIX POST-REVISIÓN: el reloj simulado avanza `dtSim` (YA escalado por `velocidadDemo`), igual
  // que `avanzarUnidades` más abajo — ver el docblock de `ahoraSimulado` en `EstadoMotorDemo`.
  const ahoraSimulado = estado.ahoraSimulado + dtSim * 1000;

  let siguiente: EstadoMotorDemo = { ...estado, ahora, ahoraSimulado };
  siguiente = avanzarUnidades(siguiente, dtSim, ahora);
  siguiente = despacharPendientes(siguiente, ahoraSimulado);
  siguiente = acumularPuntosGps(siguiente, dtSim);
  siguiente = resolverSincronizacion(siguiente, ahora);
  return siguiente;
}

/** Botón "Iniciar recorrido" — no-op si la unidad propia no está `en_cola` (ya en ruta o
 * finalizada). Saca a la unidad propia de la cola de su línea y reprograma la próxima salida de
 * su línea a "una frecuencia a partir de ahora" — así el compañero que sigue en la cola sale
 * "unos minutos simulados después" de que el chofer arranca, en vez de heredar un horario
 * potencialmente muy futuro (o muy pasado, ver el FIX de abajo).
 *
 * FIX POST-REVISIÓN (hallazgo de revisión — "ráfaga de salidas al arrancar tarde"): la versión
 * anterior usaba `Math.min(salidaBase, ahoraSimulado + frecuencia)`. Como `salidaBase` de la
 * línea propia queda CONGELADO mientras la propia espera en cola (`despacharPendientes` nunca
 * despacha al frente de cola cuando el frente es la unidad propia — solo `iniciarJornada` la
 * saca), si el chofer tardaba más de una frecuencia en tocar "Iniciar", `salidaBase` ya estaba en
 * el PASADO respecto de `ahoraSimulado` — y `Math.min(pasado, futuro)` siempre elegía el pasado
 * (ver la demostración algebraica en el test: `ahoraSimulado + frecuencia - salidaBase` nunca es
 * negativo). En el primer `tick()` siguiente, `despacharPendientes` veía `ahoraSimulado >= base`
 * y despachaba TODA la cola pendiente de una sola vez (`while`, no `if`) — unidades apareciendo
 * "encima" del chofer con ~0 m de distancia. `Math.max` en su lugar SIEMPRE reprograma la próxima
 * salida a `ahoraSimulado + frecuencia` (nunca antes de ahora), sin ráfaga. */
export function iniciarJornada(estado: EstadoMotorDemo, ahora: number): EstadoMotorDemo {
  const propio = estado.unidades[estado.trufiPropioId];
  if (!propio || propio.fase !== 'en_cola') return { ...estado, ahora };

  const frecuencia = FRECUENCIA_MS[estado.lineaPropiaId];
  const colaSinPropio = estado.colas[estado.lineaPropiaId].filter((id) => id !== estado.trufiPropioId);
  const salidaBase = {
    ...estado.salidaBase,
    [estado.lineaPropiaId]: Math.max(estado.salidaBase[estado.lineaPropiaId], estado.ahoraSimulado + frecuencia),
  };

  // FIX POST-REVISIÓN (hallazgo de revisión — "punto de control del origen nunca se detecta"):
  // `puntosCruzados` (más arriba) exige `rel > 0` para contar un cruce — un punto de control
  // EXACTAMENTE en el origen (avance 0, p. ej. `villa-armonia` en Z12 o `plaza-colon` en L120)
  // queda con `rel === 0` justo al arrancar (avanceAnterior === avanceNuevo === 0) y nunca se
  // detecta en el primer tick. Sin este caso especial, el toast/guiado de "próximo punto de
  // control" del guion (E06 03:04) nunca avanzaba al SEGUNDO punto hasta dar la vuelta completa.
  // Se marca cumplido acá mismo y se emite como `ultimaDeteccion` (misma forma que un cruce
  // real, `distanciaM: 0`) para que el toast/contador existentes avancen igual que con cualquier
  // otro cruce.
  const paradaOrigen = paradasControlDe(estado.lineaPropiaId).find((p) => p.avance === 0);
  const puntosCumplidos = paradaOrigen ? [paradaOrigen.id] : [];
  const pasadasPorPunto = paradaOrigen
    ? { ...estado.pasadasPorPunto, [paradaOrigen.id]: (estado.pasadasPorPunto[paradaOrigen.id] ?? 0) + 1 }
    : estado.pasadasPorPunto;
  const ultimaDeteccion = paradaOrigen
    ? { puntoControlId: paradaOrigen.id, distanciaM: 0, pasada: pasadasPorPunto[paradaOrigen.id]!, en: ahora }
    : null;

  // FIX POST-REVISIÓN (hallazgo de revisión — "la brecha inicial se abre mientras el chofer
  // espera en cola"): las unidades `en_ruta` de la línea propia se siguieron moviendo TODO el
  // tiempo que el chofer esperó en cola antes de tocar "Iniciar" (`avanzarUnidades` no distingue
  // "propia esperando" — solo pausa a la unidad propia, no a sus compañeras de línea que ya
  // salieron), a ~333 m/min: con solo 2 minutos de espera la más cercana adelante ya se corrió
  // ~700 m fuera del rango pensado para la toma. Se reubican acá mismo, en el instante en que la
  // propia vuelve a `avance: 0`, con `reubicarAdelante` (mismo helper que siembra el escenario
  // inicial) para que la más cercana quede otra vez dentro de rango SIN reordenarlas ni
  // apilarlas — preserva el orden y los gaps relativos entre ellas, solo comprime/expande la
  // distancia total al frente.
  const frecuenciaS = frecuencia / 1000;
  const largoTotalPropia = largoTotalM(LINEAS_MOCK[estado.lineaPropiaId].polilinea);
  const enRutaPropiaOrdenadas = Object.values(estado.unidades)
    .filter((u) => u.lineaId === estado.lineaPropiaId && u.fase === 'en_ruta')
    .sort((a, b) => a.avance - b.avance);
  const unidadesReubicadas = { ...estado.unidades };
  reubicarAdelante(enRutaPropiaOrdenadas, largoTotalPropia, frecuenciaS).forEach((u) => {
    unidadesReubicadas[u.trufiId] = u;
  });

  return {
    ...estado,
    ahora,
    tracking: true,
    senal: 'ok',
    puntosCumplidos,
    pasadasPorPunto,
    ultimaDeteccion,
    unidades: { ...unidadesReubicadas, [estado.trufiPropioId]: { ...propio, fase: 'en_ruta', avance: 0 } },
    colas: { ...estado.colas, [estado.lineaPropiaId]: colaSinPropio },
    salidaBase,
  };
}

/** Botón "Finalizar recorrido" — no-op si la unidad propia no está `en_ruta`. La unidad NO
 * vuelve a la cola sola (a diferencia de las ajenas): el chofer tiene que iniciar sesión de
 * nuevo o usar el panel demo (`reiniciar`) para otra vuelta. */
export function finalizarJornada(estado: EstadoMotorDemo, ahora: number): EstadoMotorDemo {
  const propio = estado.unidades[estado.trufiPropioId];
  if (!propio || propio.fase !== 'en_ruta') return { ...estado, ahora };
  return {
    ...estado,
    ahora,
    tracking: false,
    unidades: { ...estado.unidades, [estado.trufiPropioId]: { ...propio, fase: 'finalizado' } },
  };
}

export function perderSenal(estado: EstadoMotorDemo): EstadoMotorDemo {
  if (estado.senal !== 'ok') return estado;
  return { ...estado, senal: 'sin_senal' };
}

/** → `sincronizando` por `MS_SINCRONIZANDO_BASE` (escalado por `velocidadDemo`); `tick()`
 * completa la transición a `ok` cuando `ahora >= sincronizandoHasta` (ver
 * `resolverSincronizacion`). */
export function recuperarSenal(estado: EstadoMotorDemo, ahora: number): EstadoMotorDemo {
  if (estado.senal !== 'sin_senal') return estado;
  return {
    ...estado,
    senal: 'sincronizando',
    sincronizandoHasta: ahora + MS_SINCRONIZANDO_BASE / estado.velocidadDemo,
  };
}

export function alternarVelocidad(estado: EstadoMotorDemo): EstadoMotorDemo {
  return { ...estado, velocidadDemo: estado.velocidadDemo === 1 ? 4 : 1 };
}

/** Panel demo — salta el avance propio a unos metros antes del próximo punto de control (en
 * vez de directo encima), para que el cruce se siga detectando naturalmente en el próximo
 * `tick()` (dispara el toast/sonido igual que un cruce real). No-op si la unidad propia no está
 * `en_ruta` o su línea no tiene puntos de control. */
export function saltarAlProximoPunto(estado: EstadoMotorDemo): EstadoMotorDemo {
  const propio = estado.unidades[estado.trufiPropioId];
  if (!propio || propio.fase !== 'en_ruta') return estado;
  const paradas = paradasControlDe(estado.lineaPropiaId);
  if (paradas.length === 0) return estado;

  const conRelativo = paradas
    .map((p) => ({ p, rel: ((p.avance - propio.avance) % 1 + 1) % 1 }))
    .sort((a, b) => a.rel - b.rel);
  const proxima = conRelativo.find(({ rel }) => rel > 0) ?? conRelativo[0];
  if (!proxima) return estado;

  const EPSILON_AVANCE = 0.0005; // unos pocos metros antes del punto, según el largo de la línea
  const nuevoAvance = ((proxima.p.avance - EPSILON_AVANCE) % 1 + 1) % 1;
  return { ...estado, unidades: { ...estado.unidades, [propio.trufiId]: { ...propio, avance: nuevoAvance } } };
}

/** Panel demo — el trufi que va adelante "se acerca" (salta a un 30% de la distancia actual,
 * con un piso de 30 m), para ver en vivo cómo baja el indicador de distancia. No-op si no hay
 * nadie `en_ruta` adelante (solo cola). */
export function acercarAdelante(estado: EstadoMotorDemo): EstadoMotorDemo {
  const { adelante } = adelanteAtras(estado, estado.trufiPropioId);
  if (!adelante || adelante.enCola) return estado;
  const propio = estado.unidades[estado.trufiPropioId];
  const unidadAdelante = estado.unidades[adelante.trufiId];
  if (!propio || !unidadAdelante) return estado;

  const polilinea = LINEAS_MOCK[estado.lineaPropiaId].polilinea;
  const largoTotal = largoTotalM(polilinea);
  if (largoTotal <= 0) return estado;
  const distanciaActual = distanciaEntreAvancesM(polilinea, propio.avance, unidadAdelante.avance);
  const nuevaDistancia = Math.max(30, distanciaActual * 0.3);
  const nuevoAvance = ((propio.avance + nuevaDistancia / largoTotal) % 1 + 1) % 1;

  return {
    ...estado,
    unidades: { ...estado.unidades, [unidadAdelante.trufiId]: { ...unidadAdelante, avance: nuevoAvance } },
  };
}

/** Modal "Reportar" — `estado: 'pendiente'` si no hay señal en el momento de crear el reporte
 * (se resuelve a `'enviado'` al recuperar señal, ver `resolverSincronizacion`); `id` lo genera
 * el caller (`crypto.randomUUID()`/similar) para mantener esta función pura. */
export function crearReporte(
  estado: EstadoMotorDemo,
  entrada: { tipo: TipoReporteDemo; placaReportada?: string; nota?: string },
  ahora: number,
  id: string,
): EstadoMotorDemo {
  const reporte: ReporteDemo = {
    id,
    tipo: entrada.tipo,
    placaReportada: entrada.placaReportada,
    nota: entrada.nota,
    creadoEn: ahora,
    estado: estado.senal === 'ok' ? 'enviado' : 'pendiente',
  };
  return { ...estado, reportes: [...estado.reportes, reporte] };
}

/** Panel demo — reinicia toda la sesión demo (misma unidad propia) al escenario inicial. */
export function reiniciar(estado: EstadoMotorDemo, ahora: number): EstadoMotorDemo {
  return crearEstadoInicial(estado.trufiPropioId, ahora);
}

// ================================================================================================
// Selectores.
// ================================================================================================

export interface VecinoDemo {
  trufiId: string;
  placa: string;
  /** Metros a lo largo de la ruta (no en línea recta) — `0` cuando `enCola` es `true` (todavía
   * no hay una posición sobre la ruta que medir). */
  distanciaM: number;
  /** Minutos de ETA a velocidad nominal — `0` cuando `enCola` es `true` (usar `saleA` en su
   * lugar). */
  minutos: number;
  /** `true` cuando este vecino todavía no salió — es el próximo de la cola, no una unidad
   * `en_ruta`. Solo puede pasar en `atras` (mientras nadie salió detrás todavía). */
  enCola?: boolean;
  /** epoch ms de salida programada — solo presente junto con `enCola: true`. */
  saleA?: number;
}

function vecinoDesde(unidad: UnidadDemo, distanciaM: number): VecinoDemo {
  const trufi = TRUFIS_MOCK.find((t) => t.id === unidad.trufiId);
  const minutos = Math.round((distanciaM / VELOCIDAD_NOMINAL_MPS / 60) * 10) / 10;
  return { trufiId: unidad.trufiId, placa: trufi?.placa ?? '', distanciaM: Math.round(distanciaM), minutos };
}

/**
 * Vecino inmediato adelante/atrás de `trufiId` a lo largo de la ruta de su línea (no en línea
 * recta). Vacío (`{}`) si la unidad no está `en_ruta` (mientras está en cola o finalizada no hay
 * indicadores que mostrar). Si nadie quedó `en_ruta` detrás (por ejemplo, recién arrancó y
 * todavía nadie salió después), `atras` cae al próximo de la cola con `enCola: true` + `saleA`
 * en vez de una distancia real.
 *
 * OJO — comparación LINEAL de `avance` (no circular/modular), a propósito: aunque la ruta sea
 * un loop cerrado, cada unidad `en_ruta` está haciendo SU PROPIA vuelta (arranca en `avance: 0`
 * al salir de cola — ver `iniciarJornada`/`despacharPendientes`) — dos unidades en la misma
 * línea nunca "comparten reloj" de vuelta. Con distancia circular (`distanciaEntreAvancesM`,
 * que sí hace falta para medir metros ENTRE dos avances ya sabidos "adelante"/"atrás"), una
 * unidad que salió antes y va con `avance` alto se puede leer como "detrás" solo por el
 * wraparound del `%1` — exactamente el bug que este comentario documenta para no reintroducirlo:
 * mayor `avance` = objetivamente más avanzada en SU vuelta = adelante; menor `avance` = atrás.
 */
export function adelanteAtras(
  estado: EstadoMotorDemo,
  trufiId: string,
): { adelante?: VecinoDemo; atras?: VecinoDemo } {
  const unidad = estado.unidades[trufiId];
  if (!unidad || unidad.fase !== 'en_ruta') return {};

  const linea = LINEAS_MOCK[unidad.lineaId];
  const companeros = Object.values(estado.unidades).filter(
    (u) => u.lineaId === unidad.lineaId && u.fase === 'en_ruta' && u.trufiId !== trufiId,
  );

  let mejorAdelante: { u: UnidadDemo; distanciaM: number } | null = null;
  let mejorAtras: { u: UnidadDemo; distanciaM: number } | null = null;
  for (const otro of companeros) {
    if (otro.avance > unidad.avance) {
      const distanciaM = (otro.avance - unidad.avance) * largoTotalM(linea.polilinea);
      if (!mejorAdelante || distanciaM < mejorAdelante.distanciaM) mejorAdelante = { u: otro, distanciaM };
    } else if (otro.avance < unidad.avance) {
      const distanciaM = (unidad.avance - otro.avance) * largoTotalM(linea.polilinea);
      if (!mejorAtras || distanciaM < mejorAtras.distanciaM) mejorAtras = { u: otro, distanciaM };
    }
  }

  const resultado: { adelante?: VecinoDemo; atras?: VecinoDemo } = {};
  if (mejorAdelante) resultado.adelante = vecinoDesde(mejorAdelante.u, mejorAdelante.distanciaM);

  if (mejorAtras) {
    resultado.atras = vecinoDesde(mejorAtras.u, mejorAtras.distanciaM);
  } else {
    const proximoId = estado.colas[unidad.lineaId][0];
    const proximoTrufi = proximoId ? TRUFIS_MOCK.find((t) => t.id === proximoId) : undefined;
    if (proximoId && proximoTrufi) {
      resultado.atras = {
        trufiId: proximoId,
        placa: proximoTrufi.placa,
        distanciaM: 0,
        minutos: 0,
        enCola: true,
        saleA: estado.salidaBase[unidad.lineaId],
      };
    }
  }
  return resultado;
}

export function colaDe(estado: EstadoMotorDemo, lineaId: LineaMockId): string[] {
  return estado.colas[lineaId];
}

/** epoch ms de salida programada de `trufiId` — `null` si no está `en_cola` (ya salió, o no
 * pertenece a la línea consultada). Útil para la pantalla "Hoja de ruta" (orden de salida con
 * hora).
 *
 * FIX POST-REVISIÓN (hallazgo de revisión — "hora de salida mostrada en el pasado"): mientras la
 * unidad PROPIA espera en cola, `salidaBase` de SU línea queda congelado (`despacharPendientes`
 * nunca avanza el horario del frente de cola cuando el frente es la propia — solo
 * `iniciarJornada` lo hace). Si el chofer tarda en arrancar más que una frecuencia, la hora cruda
 * (`salidaBase + indice*frecuencia`) queda en el pasado respecto de `ahoraSimulado` — se "enrolla"
 * hacia adelante en múltiplos de la frecuencia de la línea para no mostrar nunca una hora de
 * salida ya vencida (afecta a la propia Y a cualquiera detrás de ella en la misma cola). */
export function proximaSalidaDe(estado: EstadoMotorDemo, trufiId: string): number | null {
  const unidad = estado.unidades[trufiId];
  if (!unidad || unidad.fase !== 'en_cola') return null;
  const indice = estado.colas[unidad.lineaId].indexOf(trufiId);
  if (indice === -1) return null;
  const frecuencia = FRECUENCIA_MS[unidad.lineaId];
  const salidaCruda = estado.salidaBase[unidad.lineaId] + indice * frecuencia;
  if (salidaCruda >= estado.ahoraSimulado) return salidaCruda;
  const atrasoMs = estado.ahoraSimulado - salidaCruda;
  const saltos = Math.ceil(atrasoMs / frecuencia);
  return salidaCruda + saltos * frecuencia;
}

export interface PosicionDemo {
  lat: number;
  lng: number;
  /** Grados, 0=norte/+lat, 90=este/+lng — ver `bearingEnAvance`. */
  heading: number;
}

export function posicionDe(estado: EstadoMotorDemo, trufiId: string): PosicionDemo | null {
  const unidad = estado.unidades[trufiId];
  if (!unidad) return null;
  const linea = LINEAS_MOCK[unidad.lineaId];
  const { lat, lng } = posicionEnPolilinea(linea.polilinea, unidad.avance);
  return { lat, lng, heading: bearingEnAvance(linea.polilinea, unidad.avance) };
}

export interface VehiculoMapaDemo {
  trufiId: string;
  lat: number;
  lng: number;
  heading: number;
}

/** Unidades `en_ruta` de `lineaId`, EXCLUYENDO la propia — para dibujar los marcadores de
 * "otros vehículos" en el mapa. */
export function otrosVehiculos(estado: EstadoMotorDemo, lineaId: LineaMockId): VehiculoMapaDemo[] {
  return Object.values(estado.unidades)
    .filter((u) => u.lineaId === lineaId && u.fase === 'en_ruta' && u.trufiId !== estado.trufiPropioId)
    .map((u) => {
      const posicion = posicionDe(estado, u.trufiId)!;
      return { trufiId: u.trufiId, lat: posicion.lat, lng: posicion.lng, heading: posicion.heading };
    });
}
