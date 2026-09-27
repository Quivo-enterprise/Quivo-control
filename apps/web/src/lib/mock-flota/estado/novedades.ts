import { TRUFIS_MOCK } from '../datos';
import { entreEnteros, mulberry32, ordenarPorFecha, SEMILLA_HISTORIAL } from './rng';
import { HORA_INICIO_HISTORIAL } from './recorridos';
import type { EstadoFlotaMock, InfraccionMock, LineaMockId, NovedadMock, SubtipoReporteConductor } from '../tipos';

/**
 * Slice `novedades` — bandeja de novedades (E07 04:17 del guion: "revisar → ver en el mapa →
 * marcar atendida con nota / crear infracción / WhatsApp"). Las novedades generadas por un
 * escenario en vivo (`simularAtasco`/`simularDesvio`/etc.) las crea `estado/index.ts`
 * (`crearNovedad` de abajo) al mismo tiempo que dispara la transición de `flota.ts`/`senal.ts`
 * — este slice no sabe nada de `fase`, solo del registro de novedades en sí.
 */

/** Distinta de `SEMILLA_HISTORIAL` (recorridos.ts) a propósito — dos streams de `mulberry32`
 * con la MISMA semilla producirían la misma secuencia de números; no rompe nada compartirla,
 * pero usar semillas separadas por slice es más fácil de razonar. */
const SEMILLA_NOVEDADES = SEMILLA_HISTORIAL ^ 0x1111;

const SUBTIPOS_REPORTE: SubtipoReporteConductor[] = [
  'pinchazo',
  'control_policial',
  'bloqueo_via',
  'falla_mecanica',
  'incidente_pasajero',
];

const NOTAS_ATENCION: Record<string, string[]> = {
  desvio: ['Se contactó al conductor, retomó la ruta.', 'Confirmado con el conductor — corte de calle, ya regularizado.'],
  fuera_de_orden: ['Se avisó al conductor que le tocaba esperar su turno.', 'Coordinado con el conductor, sin reclamos.'],
  reporte_conductor: ['Atendido, se envió asistencia.', 'Resuelto por el propio conductor, se registra igual.'],
  atascado: ['El tráfico se liberó solo, trufi retomó marcha.', 'Se avisó a los pasajeros de la demora.'],
  sin_senal: ['Señal recuperada, sin novedad en el recorrido real.', 'Conductor confirmó por teléfono que todo normal.'],
};

export function crearNovedad(
  id: string,
  tipo: NovedadMock['tipo'],
  trufiId: string,
  creadaEn: string,
  subtipo?: SubtipoReporteConductor,
  infraccionId?: string,
): NovedadMock {
  return { id, tipo, trufiId, creadaEn, estado: 'nueva', subtipo, infraccionId };
}

export function agregarNovedad(estado: EstadoFlotaMock, novedad: NovedadMock): EstadoFlotaMock {
  return { ...estado, novedades: [...estado.novedades, novedad] };
}

/** Enlaza una novedad ya existente con la infracción que generó (ítem 12 del guion delegado) —
 * usado por `estado/index.ts` cuando `simularDesvio`/`crearInfraccionDesdeNovedad` crean la
 * infracción DE VERDAD (no cuando `simularInfracciones` la descarta en silencio porque el trufi
 * ya tenía una activa — ahí la novedad se queda sin `infraccionId`, ver
 * `flota-mock-context.tsx`). */
export function vincularInfraccionANovedad(estado: EstadoFlotaMock, novedadId: string, infraccionId: string): EstadoFlotaMock {
  const idx = estado.novedades.findIndex((n) => n.id === novedadId);
  if (idx === -1) {
    return estado;
  }
  const novedades = [...estado.novedades];
  novedades[idx] = { ...novedades[idx]!, infraccionId };
  return { ...estado, novedades };
}

/** Infracción que generó `novedadId`, si tiene una vinculada (`NovedadMock.infraccionId`) —
 * `undefined` para las novedades sembradas (nunca tienen infracción real detrás) o para
 * cualquier novedad cuya infracción se haya descartado por dedupe. */
export function infraccionDeNovedad(estado: EstadoFlotaMock, novedadId: string): InfraccionMock | undefined {
  const novedad = estado.novedades.find((n) => n.id === novedadId);
  if (!novedad?.infraccionId) {
    return undefined;
  }
  return estado.infracciones.find((i) => i.id === novedad.infraccionId);
}

export function atenderNovedad(estado: EstadoFlotaMock, id: string, nota: string): EstadoFlotaMock {
  const idx = estado.novedades.findIndex((n) => n.id === id);
  if (idx === -1) {
    return estado;
  }
  const novedades = [...estado.novedades];
  novedades[idx] = { ...novedades[idx]!, estado: 'atendida', nota };
  return { ...estado, novedades };
}

export function revisarNovedad(estado: EstadoFlotaMock, id: string): EstadoFlotaMock {
  const idx = estado.novedades.findIndex((n) => n.id === id);
  if (idx === -1 || estado.novedades[idx]!.estado !== 'nueva') {
    return estado;
  }
  const novedades = [...estado.novedades];
  novedades[idx] = { ...novedades[idx]!, estado: 'en_revision' };
  return { ...estado, novedades };
}

/** Novedades NO atendidas (`nueva` | `en_revision`) — el badge del rail de vistas cuenta esto. */
export function novedadesAbiertas(estado: EstadoFlotaMock, lineaId?: LineaMockId): NovedadMock[] {
  return estado.novedades.filter((n) => {
    if (n.estado === 'atendida') {
      return false;
    }
    if (!lineaId) {
      return true;
    }
    const trufi = TRUFIS_MOCK.find((t) => t.id === n.trufiId);
    return trufi?.lineaId === lineaId;
  });
}

/**
 * Siembra 4-6 novedades más temprano en el día (entre las 05:00 y `now - 30min`, para que
 * queden claramente "del pasado" respecto de cualquier novedad que se dispare en vivo durante
 * la grabación) — la mayoría `atendida` con nota, 1-2 `nueva` (contrato: "4-6 earlier in the
 * day, mostly atendida with notas, 1-2 nueva").
 *
 * Ítem 11 del guion delegado (auditoría de timestamps sembrados en el futuro): si `now` es
 * antes de las 05:00, no siembra nada — mismo criterio que `flota.ts#sembrarSanciones` (ítem
 * 10). Sin este chequeo, `finVentanaMs`/`rangoMs` colapsan a un solo instante (las 05:00) que
 * de todas formas queda en el FUTURO respecto de un `now` de madrugada.
 */
export function sembrarNovedades(now: Date): NovedadMock[] {
  const inicioDia = new Date(now.getFullYear(), now.getMonth(), now.getDate(), HORA_INICIO_HISTORIAL, 0, 0, 0);
  if (now.getTime() < inicioDia.getTime()) {
    return [];
  }
  const rng = mulberry32(SEMILLA_NOVEDADES);
  const finVentanaMs = Math.max(inicioDia.getTime(), now.getTime() - 30 * 60_000);
  const rangoMs = Math.max(1, finVentanaMs - inicioDia.getTime());

  const total = entreEnteros(rng, 4, 6);
  const nuevas = Math.min(total - 1, entreEnteros(rng, 1, 2));
  const tipos: NovedadMock['tipo'][] = ['desvio', 'fuera_de_orden', 'reporte_conductor', 'atascado', 'sin_senal'];

  const novedades: NovedadMock[] = [];
  for (let i = 0; i < total; i++) {
    const trufi = TRUFIS_MOCK[entreEnteros(rng, 0, TRUFIS_MOCK.length - 1)]!;
    const tipo = tipos[entreEnteros(rng, 0, tipos.length - 1)]!;
    const subtipo = tipo === 'reporte_conductor' ? SUBTIPOS_REPORTE[entreEnteros(rng, 0, SUBTIPOS_REPORTE.length - 1)] : undefined;
    const creadaEn = new Date(inicioDia.getTime() + Math.floor(rng() * rangoMs)).toISOString();
    const esNueva = i < nuevas;
    const notasTipo = NOTAS_ATENCION[tipo] ?? NOTAS_ATENCION.desvio!;
    novedades.push({
      id: `nov-seed-${trufi.id}-${i}`,
      tipo,
      subtipo,
      trufiId: trufi.id,
      creadaEn,
      estado: esNueva ? 'nueva' : 'atendida',
      nota: esNueva ? undefined : notasTipo[entreEnteros(rng, 0, notasTipo.length - 1)],
    });
  }
  // Orden cronológico — más prolijo para la bandeja que el orden de sorteo (ítem 11: mismo
  // helper que usan `recorridos.ts#sembrarHistorial` y `salidas.ts`).
  return ordenarPorFecha(novedades, (n) => n.creadaEn);
}
