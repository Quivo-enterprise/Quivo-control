import { LINEAS_MOCK, TRUFIS_MOCK } from '../datos';
import { esHoraPico, intensidadTipicaDe } from './demanda';
import { entreEnteros, mulberry32, ordenarPorFecha, SEMILLA_HISTORIAL } from './rng';
import type { EstadoFlotaMock, LineaMockId, RecorridoMock, SalidaMock, TrufiMock } from '../tipos';

/**
 * Slice `recorridos` — historial de vueltas por trufi (E07 04:03/05:05 del guion: "recorridos
 * registrados en 24 h" / pestaña "Recorridos" de la ficha). También siembra, junto con el
 * historial de recorridos, las `SalidaMock` que le corresponden — comparten exactamente la
 * misma línea de tiempo simulada (cada recorrido sembrado salió de una salida sembrada), así
 * que generarlos por separado en `salidas.ts` hubiera duplicado el mismo bucle de tiempo con
 * OTRO `rng` desincronizado. `estado/index.ts` reparte el resultado a `estado.recorridos` y
 * `estado.salidas`.
 */

/** Hora local (0-23) desde la que arranca el historial sembrado — "desde las 05:00 del día
 * hasta ahora" del contrato. */
export const HORA_INICIO_HISTORIAL = 5;

function inicioDelDiaLocal(now: Date, hora: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hora, 0, 0, 0);
}

function puntosControlEstaticosDe(lineaId: LineaMockId): number {
  return LINEAS_MOCK[lineaId].paradas.filter((p) => p.esPuntoControl).length;
}

export function crearRecorrido(
  id: string,
  trufiId: string,
  lineaId: LineaMockId,
  inicio: string,
  puntosTotal: number,
): RecorridoMock {
  return { id, trufiId, lineaId, inicio, puntosCumplidos: 0, puntosTotal, estado: 'en_curso' };
}

/** Duración de vuelta sembrada (minutos, `[min, max]`) — más corta en hora pico (más frecuencia,
 * menos tiempo muerto por semáforo/tráfico en el mock) que fuera de pico. Los rangos están
 * elegidos para que la CAPACIDAD de la línea (nº de trufis × 60 / duración media) cubra el
 * `target` de arranques/hora de `targetIniciosDeHora` — ver el comentario de esa función para
 * el cálculo. */
const DURACION_VUELTA_MIN: Record<'pico' | 'valle', readonly [number, number]> = {
  pico: [35, 45],
  valle: [45, 55],
};

/** Minutos de recambio (bajar/subir pasajeros, changuear) entre el fin de una vuelta y el
 * momento en que ESE MISMO trufi queda libre para arrancar la siguiente. */
const RECAMBIO_MIN: readonly [number, number] = [2, 5];

/** Jitter (minutos) sobre la posición, dentro de la hora, de cada arranque sembrado — separa los
 * arranques de una hora entre sí sin que se vean "de reloj" (equiespaciados exactos). */
const JITTER_INICIO_MIN = 4;

/**
 * Cantidad de arranques sembrados que le corresponden a una línea en una hora dada —
 * demand-driven: `round(nTrufisLinea * intensidadTipicaDe(hora))` (la MISMA curva que ya dibuja
 * `demanda.ts#movimientoTipicoPorHora`, para que el historial sembrado y la curva "típica" de
 * las horas futuras del chart de Análisis cuenten la misma historia) con jitter sembrado de a lo
 * sumo 1 arranque.
 *
 * El jitter es A PROPÓSITO asimétrico (pico: +0 o +1; valle: -1 o 0), no ±1 parejo en las dos
 * direcciones — así el piso de una hora pico (`nominal - 0`) queda siempre por encima del techo
 * de una hora valle (`nominal + 1`) para las dos líneas, sin depender de qué toque sortear:
 *   Z12  (5 trufis): valle nominal 3 (rango sembrado 2-3), pico nominal 7 (rango 7-8).
 *   L120 (3 trufis): valle nominal 2 (rango sembrado 1-2), pico nominal 4 (rango 4-5).
 * Ese margen (mín. pico 7 > máx. valle 3 en Z12; mín. pico 4 > máx. valle 2 en L120) es lo que
 * garantiza, por construcción y no por suerte del `rng`, el contrato de forma de
 * `demanda.test.ts` ("toda hora pico completa >= toda hora valle completa, el máximo cae en una
 * hora pico"). Capacidad: con `DURACION_VUELTA_MIN.pico` (35-45 min) + `RECAMBIO_MIN` (2-5 min)
 * un trufi hace hasta ~60/37 ≈ 1.6 vueltas/hora en pico — Z12 (5 trufis) cubre así hasta 8
 * arranques/hora y L120 (3 trufis) hasta 4-5, que es justo el techo de este target.
 */
function targetIniciosDeHora(nTrufisLinea: number, hora: number, rng: () => number): number {
  const nominal = Math.round(nTrufisLinea * intensidadTipicaDe(hora));
  const jitter = esHoraPico(hora) ? entreEnteros(rng, 0, 1) : -entreEnteros(rng, 0, 1);
  return Math.max(1, nominal + jitter);
}

/** `cantidad` instantes de arranque (ms epoch) sembrados dentro de la hora que arranca en
 * `horaInicioMs` — equiespaciados (cada arranque en el centro de su franja de `60/cantidad`
 * minutos) más `JITTER_INICIO_MIN` de jitter, clampeados para no salirse de la hora. */
function tiemposDeInicioDeHora(horaInicioMs: number, cantidad: number, rng: () => number): number[] {
  const horaFinMs = horaInicioMs + 60 * 60_000;
  const tiempos: number[] = [];
  for (let i = 0; i < cantidad; i++) {
    const centroMs = horaInicioMs + Math.round(((i + 0.5) / cantidad) * 60 * 60_000);
    const jitterMs = entreEnteros(rng, -JITTER_INICIO_MIN, JITTER_INICIO_MIN) * 60_000;
    const candidatoMs = centroMs + jitterMs;
    tiempos.push(Math.min(Math.max(candidatoMs, horaInicioMs), horaFinMs - 1));
  }
  return tiempos;
}

interface LibreDesde {
  trufi: TrufiMock;
  libreDesdeMs: number;
}

/**
 * Siembra el historial 05:00→`now` de UNA línea — demand-driven, hora por hora:
 *
 * 1. `targetIniciosDeHora` decide cuántas vueltas arrancan esa hora (siguiendo la curva de
 *    demanda de `demanda.ts`, ver su comentario para el porqué del margen pico/valle).
 * 2. `tiemposDeInicioDeHora` reparte esos arranques a lo largo de la hora.
 * 3. Cada arranque se asigna al trufi de la línea libre desde hace más tiempo (`libreDesdeMs`
 *    más chico); si ESE trufi todavía no está libre en el instante candidato, el arranque
 *    desliza hacia adelante hasta que se libera — mientras siga entrando en la hora (o, en la
 *    hora EN CURSO, antes de `now`). Si ni el trufi más libre ni ningún otro entran, el
 *    arranque se descarta (evita el phase-lock del enfoque viejo: acá NO hay un espaciado de
 *    entrada fijo ni una espera fija entre vueltas — el reparto lo decide la demanda + quién
 *    está libre).
 *
 * La hora en la que cae `now` es PARCIAL: solo se siembran arranques con margen para cerrar al
 * menos `DURACION_VUELTA_MIN` antes de `now` (si no, ese resto de flota queda para la vuelta EN
 * CURSO que arma `estado/index.ts#estadoInicial` aparte, no acá).
 */
function sembrarLinea(
  lineaId: LineaMockId,
  now: Date,
  inicioDiaMs: number,
  rng: () => number,
  contador: { valor: number },
): { recorridos: RecorridoMock[]; salidas: SalidaMock[] } {
  const trufisLinea = TRUFIS_MOCK.filter((t) => t.lineaId === lineaId);
  const puntosTotal = puntosControlEstaticosDe(lineaId);
  const nowMs = now.getTime();
  const nowHour = now.getHours();
  const estados: LibreDesde[] = trufisLinea.map((trufi) => ({ trufi, libreDesdeMs: inicioDiaMs }));
  const recorridos: RecorridoMock[] = [];
  const salidas: SalidaMock[] = [];

  const ultimaHora = Math.min(nowHour, 22);
  for (let hora = HORA_INICIO_HISTORIAL; hora <= ultimaHora; hora++) {
    const pico = esHoraPico(hora);
    const duracionRango = pico ? DURACION_VUELTA_MIN.pico : DURACION_VUELTA_MIN.valle;
    const horaInicioMs = inicioDiaMs + (hora - HORA_INICIO_HISTORIAL) * 60 * 60_000;
    const horaFinMs = horaInicioMs + 60 * 60_000;
    // Límite para el INICIO del arranque (no para su cierre — una vuelta arranca dentro de su
    // hora y perfectamente puede cerrar en la siguiente, eso no cambia en qué bucket de
    // `movimientoPorHora` cae). En la hora EN CURSO el límite es `now` (no se puede arrancar
    // algo en el futuro) más el margen de `DURACION_VUELTA_MIN` mínimo para que valga la pena
    // sembrarlo (si no, ese resto de flota queda para la vuelta EN CURSO armada aparte); en una
    // hora ya cerrada el límite es simplemente el fin de esa hora.
    const limiteInicioMs = hora === nowHour ? nowMs - duracionRango[0] * 60_000 : horaFinMs;

    const cantidad = targetIniciosDeHora(trufisLinea.length, hora, rng);
    const candidatos = tiemposDeInicioDeHora(horaInicioMs, cantidad, rng);

    for (const candidatoMs of candidatos) {
      if (candidatoMs > limiteInicioMs) {
        continue; // ni el candidato entra — se cae.
      }

      // Asigna al trufi libre desde hace más tiempo que, deslizado a su `libreDesdeMs`, todavía
      // arranca dentro del límite — si el más libre no entra prueba el siguiente (así ninguna
      // hora operativa completa queda en 0 solo porque el trufi "de turno" se liberó tarde).
      const ordenLibres = [...estados].sort((a, b) => a.libreDesdeMs - b.libreDesdeMs);
      let elegido: LibreDesde | undefined;
      let inicioMs = 0;
      for (const candidatoTrufi of ordenLibres) {
        const posibleMs = Math.max(candidatoMs, candidatoTrufi.libreDesdeMs);
        if (posibleMs > limiteInicioMs) {
          continue;
        }
        elegido = candidatoTrufi;
        inicioMs = posibleMs;
        break;
      }
      if (!elegido) {
        continue; // ningún trufi de la línea llega a arrancar dentro de la hora — se cae.
      }

      const duracionMin = entreEnteros(rng, duracionRango[0], duracionRango[1]);
      const finPlaneadoMs = inicioMs + duracionMin * 60_000;
      // Ítem 9 del guion delegado: nunca cierra en el futuro respecto de `now` — si el sorteo se
      // pasó, clampea.
      const finMs = Math.min(finPlaneadoMs, nowMs);
      const seClampeo = finMs < finPlaneadoMs;
      const completo = !seClampeo && rng() > 0.15;
      const puntosCumplidos = completo ? puntosTotal : entreEnteros(rng, 0, Math.max(0, puntosTotal - 1));
      contador.valor += 1;

      const inicioIso = new Date(inicioMs).toISOString();
      recorridos.push({
        id: `rec-seed-${elegido.trufi.id}-${contador.valor}`,
        trufiId: elegido.trufi.id,
        lineaId,
        inicio: inicioIso,
        fin: new Date(finMs).toISOString(),
        puntosCumplidos,
        puntosTotal,
        estado: completo ? 'completo' : 'incompleto',
      });

      const jitterSeg = entreEnteros(rng, 0, 90);
      salidas.push({
        id: `sal-seed-${elegido.trufi.id}-${contador.valor}`,
        trufiId: elegido.trufi.id,
        lineaId,
        programada: inicioIso,
        real: new Date(inicioMs + jitterSeg * 1000).toISOString(),
        fueraDeOrden: false,
      });

      const recambioMin = entreEnteros(rng, RECAMBIO_MIN[0], RECAMBIO_MIN[1]);
      // Libre desde el fin PLANEADO (no el clampeado) — si `now` cae a mitad de vuelta esa misma
      // hora, el trufi simplemente no vuelve a entrar en el `while` (candidatos posteriores ya no
      // le van a caber antes de `limiteMs`).
      elegido.libreDesdeMs = finPlaneadoMs + recambioMin * 60_000;
    }
  }

  return { recorridos, salidas };
}

/**
 * Siembra el historial de 05:00 (local, del día de `now`) hasta `now`, determinístico
 * (`mulberry32(SEMILLA_HISTORIAL)`, mismo resultado para el mismo día) — demand-driven por línea
 * (`sembrarLinea`), vueltas en su mayoría `completo`, algunas `incompleto`. El ÚLTIMO tramo
 * (desde el fin de la última vuelta sembrada hasta `now`) queda para la vuelta EN CURSO de cada
 * trufi `en_ruta` (armada aparte por `estado/index.ts#estadoInicial`, no acá — un trufi
 * `en_cola` en la escena inicial no tiene vuelta en curso).
 *
 * Bug de cámara 2026-09 ("Hora de mayor movimiento" mostraba 05:00 con las barras 05/06 como
 * las más altas): el primer fix (entrada escalonada + espera fija fuera de pico) mejoró el pico
 * de arranque pero terminó en un PHASE-LOCK — como los 8 trufis entran a horas fijas y encadenan
 * con la misma regla de espera, terminan arrancando su vuelta N-ésima todos ~en la misma franja,
 * así que una hora pico podía caer justo en el "valle" entre dos arranques sincronizados de la
 * flota entera (p. ej. hora 12 con solo 2 recorridos, hora 09 con 1). Este segundo fix reemplaza
 * el enfoque completo: en vez de simular c/trufi de forma independiente con reglas de espaciado
 * fijas, `sembrarLinea` decide CUÁNTOS arranques quiere cada hora (`targetIniciosDeHora`, atado
 * a la misma curva de demanda que ya dibuja `demanda.ts`) y reparte esos arranques entre los
 * trufis libres de la línea — determinístico, sin espaciados fijos que puedan alinearse entre sí.
 */
export function sembrarHistorial(now: Date): { recorridos: RecorridoMock[]; salidas: SalidaMock[] } {
  const rng = mulberry32(SEMILLA_HISTORIAL);
  const inicioDiaMs = inicioDelDiaLocal(now, HORA_INICIO_HISTORIAL).getTime();
  const contador = { valor: 0 };
  const recorridos: RecorridoMock[] = [];
  const salidas: SalidaMock[] = [];

  for (const lineaId of Object.keys(LINEAS_MOCK) as LineaMockId[]) {
    const resultado = sembrarLinea(lineaId, now, inicioDiaMs, rng, contador);
    recorridos.push(...resultado.recorridos);
    salidas.push(...resultado.salidas);
  }

  // Ítem 11: los dos arrays quedaron agrupados POR LÍNEA (bucle externo en `sembrarHistorial`),
  // no en orden cronológico — se reordenan acá para que cualquier consumidor que asuma "orden
  // cronológico" (listas, `proximaProgramadaDe` de `salidas.ts`) los reciba ya bien ordenados.
  return {
    recorridos: ordenarPorFecha(recorridos, (r) => r.inicio),
    salidas: ordenarPorFecha(salidas, (s) => s.programada),
  };
}

export function recorridosDelDia(
  estado: EstadoFlotaMock,
  filtro: { lineaId?: LineaMockId; trufiId?: string } = {},
): RecorridoMock[] {
  return estado.recorridos.filter(
    (r) => (!filtro.lineaId || r.lineaId === filtro.lineaId) && (!filtro.trufiId || r.trufiId === filtro.trufiId),
  );
}

/** Suma un cumplimiento al recorrido `en_curso` de `trufiId` (si tiene uno) — llamado desde
 * `estado/index.ts#tick` por cada `{ tipo: 'cumplimiento' }` que reporta `flota.ts#avanzarTrufi`. */
export function registrarCumplimiento(estado: EstadoFlotaMock, trufiId: string): EstadoFlotaMock {
  const idx = estado.recorridos.findIndex((r) => r.trufiId === trufiId && r.estado === 'en_curso');
  if (idx === -1) {
    return estado;
  }
  const recorrido = estado.recorridos[idx]!;
  const puntosCumplidos = Math.min(recorrido.puntosTotal, recorrido.puntosCumplidos + 1);
  if (puntosCumplidos === recorrido.puntosCumplidos) {
    return estado;
  }
  const recorridos = [...estado.recorridos];
  recorridos[idx] = { ...recorrido, puntosCumplidos };
  return { ...estado, recorridos };
}

/** Cierra el recorrido `en_curso` de `trufiId` — `completo` si ya cumplió todos los puntos de
 * control, si no `incompleto`. Usado tanto al completar una vuelta normal (`vuelta-completa`,
 * `estado/index.ts#tick`) como por la acción de demo `finalizarRecorrido`. */
export function cerrarRecorridoEnCurso(estado: EstadoFlotaMock, trufiId: string, nowIso: string): EstadoFlotaMock {
  const idx = estado.recorridos.findIndex((r) => r.trufiId === trufiId && r.estado === 'en_curso');
  if (idx === -1) {
    return estado;
  }
  const recorrido = estado.recorridos[idx]!;
  const completo = recorrido.puntosCumplidos >= recorrido.puntosTotal;
  const recorridos = [...estado.recorridos];
  recorridos[idx] = { ...recorrido, fin: nowIso, estado: completo ? 'completo' : 'incompleto' };
  return { ...estado, recorridos };
}
