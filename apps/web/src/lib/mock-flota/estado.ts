import { LINEAS_MOCK, TRUFIS_MOCK } from './datos';
import { CATALOGO_INFRACCIONES } from './catalogo-infracciones';
import { posicionEnPolilinea } from './geometria';
import type {
  AccionAplicada,
  EstadoFlotaMock,
  EstadoTrufi,
  InfraccionMock,
  InfraccionTipo,
  ModoAplicacion,
  Severidad,
} from './tipos';

/**
 * Reducer del mock de flota — Decisión 3 del plan.
 *
 * El reducer es PURO a propósito (testeable sin mockear `Math.random` ni `Date.now`): toda
 * la aleatoriedad (qué trufis, qué tipo de infracción, qué severidad cuando es "aleatoria")
 * y los timestamps se resuelven ANTES de dispatchear, en `flota-mock-context.tsx` (los
 * "action creators" del hook), y viajan ya resueltos en el payload de la acción. Las
 * funciones de selección de este archivo (`elegirAleatorios`, `elegirTipoInfraccion`)
 * reciben un `rng` inyectable — el hook les pasa `Math.random` por default, y los tests
 * pasan uno determinístico.
 */

/** Cuántos días adelante, como máximo, se puede fijar el plazo de una acción aplicada. */
export const PLAZO_MAX_DIAS = 30;

/**
 * `true` si `venceEl` (fecha SIN hora, `yyyy-mm-dd`) cae entre el día calendario LOCAL de
 * `now` (inclusive) y ese mismo día + `PLAZO_MAX_DIAS` (inclusive). Compara por DÍA
 * calendario, no por hora exacta, para que "hoy" sea válido sin importar la hora del día en
 * que se aplica la acción.
 *
 * Todo en huso LOCAL a propósito (nunca UTC): `venceEl` se parsea a mano desde sus partes
 * Y/M/D (nunca con `new Date(venceEl)`, que el motor de JS interpreta como medianoche UTC) y
 * el día de `now` se lee con los getters LOCALES (`getFullYear`/`getMonth`/`getDate`, nunca
 * los `getUTC*`). En Bolivia (UTC-4), a las 21:00 locales el reloj UTC ya marca el día
 * siguiente — comparar con getters UTC corría "hoy" un día hacia adelante respecto al día que
 * el usuario realmente está viviendo, y por lo tanto rechazaba plazos válidos cerca del cierre
 * del día (y aceptaba uno que ya estaba fuera de rango).
 */
export function fechaPlazoValida(venceEl: string, now: string): boolean {
  const ahora = new Date(now);
  if (Number.isNaN(ahora.getTime())) {
    return false;
  }

  const partesVence = /^(\d{4})-(\d{2})-(\d{2})$/.exec(venceEl);
  if (!partesVence) {
    return false;
  }
  const anioVence = Number(partesVence[1]);
  const mesVence = Number(partesVence[2]) - 1;
  const diaVence = Number(partesVence[3]);

  const inicioHoyMs = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const limiteMs = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + PLAZO_MAX_DIAS).getTime();
  const venceDiaMs = new Date(anioVence, mesVence, diaVence).getTime();

  if (Number.isNaN(venceDiaMs)) {
    return false;
  }

  return venceDiaMs >= inicioHoyMs && venceDiaMs <= limiteMs;
}

export function infraccionActivaDe(
  estado: EstadoFlotaMock,
  trufiId: string,
): InfraccionMock | undefined {
  return estado.infracciones.find((i) => i.trufiId === trufiId && i.estado === 'activa');
}

export function infraccionesDe(estado: EstadoFlotaMock, trufiId: string): InfraccionMock[] {
  return estado.infracciones.filter((i) => i.trufiId === trufiId);
}

/** IDs de `candidatos` que HOY no tienen ninguna infracción activa. */
export function trufisSinInfraccionActiva(
  estado: EstadoFlotaMock,
  candidatos: string[],
): string[] {
  return candidatos.filter((id) => !infraccionActivaDe(estado, id));
}

/**
 * Elige `n` elementos de `items` sin repetición, con un `rng` inyectable (`() => number` en
 * `[0, 1)`, como `Math.random`). Si `items.length <= n`, devuelve todos (mismo orden de
 * entrada) — cubre el caso "hay menos trufis libres que los pedidos" sin lanzar.
 */
export function elegirAleatorios<T>(items: T[], n: number, rng: () => number = Math.random): T[] {
  if (items.length <= n) {
    return [...items];
  }
  // Fisher-Yates parcial: solo se necesitan los primeros `n` del shuffle.
  const copia = [...items];
  const limite = Math.min(n, copia.length);
  for (let i = 0; i < limite; i++) {
    const j = i + Math.floor(rng() * (copia.length - i));
    const tmp = copia[i]!;
    copia[i] = copia[j]!;
    copia[j] = tmp;
  }
  return copia.slice(0, limite);
}

/**
 * Elige un tipo de infracción del catálogo. Con `severidad: 'aleatoria'` sortea entre TODO
 * el catálogo; con una severidad concreta, sortea solo entre los tipos de esa severidad.
 */
export function elegirTipoInfraccion(
  severidad: Severidad | 'aleatoria',
  rng: () => number = Math.random,
): InfraccionTipo {
  const candidatos =
    severidad === 'aleatoria'
      ? CATALOGO_INFRACCIONES
      : CATALOGO_INFRACCIONES.filter((tipo) => tipo.severidad === severidad);
  const pool = candidatos.length > 0 ? candidatos : CATALOGO_INFRACCIONES;
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx]!;
}

// ============================================================================================
// Velocidades de recorrido — un loop completo tarda entre 3 y 4 minutos, con offset inicial
// distinto por trufi para que no arranquen todos en el mismo punto de su línea.
// ============================================================================================

interface VelocidadTrufi {
  periodoSegundos: number;
  avanceInicial: number;
}

const VELOCIDADES: Record<string, VelocidadTrufi> = {
  'trufi-z12-1': { periodoSegundos: 190, avanceInicial: 0 },
  'trufi-z12-2': { periodoSegundos: 225, avanceInicial: 0.45 },
  'trufi-l120-1': { periodoSegundos: 205, avanceInicial: 0.2 },
};

/** Cadencia del reloj de la simulación — un tick avanza a cada trufi un paso chico. Se
 * exporta desde acá (única fuente) porque `flota-mock-context.tsx` la necesita para su
 * `setInterval` y antes la duplicaba con su propia constante local. */
export const INTERVALO_TICK_MS = 1000;

function avanceInicialDe(trufiId: string): number {
  return VELOCIDADES[trufiId]?.avanceInicial ?? 0;
}

function pasoPorTickDe(trufiId: string): number {
  const periodo = VELOCIDADES[trufiId]?.periodoSegundos ?? 200;
  return INTERVALO_TICK_MS / 1000 / periodo;
}

export function estadoInicial(): EstadoFlotaMock {
  const trufis: Record<string, EstadoTrufi> = {};
  for (const trufi of TRUFIS_MOCK) {
    const linea = LINEAS_MOCK[trufi.lineaId];
    const avance = avanceInicialDe(trufi.id);
    const { lat, lng } = posicionEnPolilinea(linea.polilinea, avance);
    trufis[trufi.id] = { trufiId: trufi.id, avance, lat, lng, siguienteParadaId: null };
  }
  return { trufis, infracciones: [], pausado: false };
}

// ============================================================================================
// Acciones
// ============================================================================================

export type AccionFlotaMock =
  | { type: 'tick' }
  | { type: 'simular-infracciones'; infracciones: InfraccionMock[] }
  | { type: 'limpiar-infracciones' }
  | { type: 'asignar-parada'; trufiId: string; paradaId: string }
  | {
      type: 'aplicar-accion';
      infraccionId: string;
      accionId: string;
      modo: ModoAplicacion;
      aplicadaEn: string;
      venceEl?: string;
    }
  | { type: 'toggle-pausa' };

function tick(estado: EstadoFlotaMock): EstadoFlotaMock {
  if (estado.pausado) {
    return estado;
  }

  const trufis: Record<string, EstadoTrufi> = {};
  for (const trufi of TRUFIS_MOCK) {
    const actual = estado.trufis[trufi.id];
    if (!actual) {
      continue;
    }
    const linea = LINEAS_MOCK[trufi.lineaId];
    const nuevoAvance = (actual.avance + pasoPorTickDe(trufi.id)) % 1;
    const { lat, lng } = posicionEnPolilinea(linea.polilinea, nuevoAvance);
    trufis[trufi.id] = { ...actual, avance: nuevoAvance, lat, lng };
  }
  return { ...estado, trufis };
}

function simularInfracciones(
  estado: EstadoFlotaMock,
  nuevas: InfraccionMock[],
): EstadoFlotaMock {
  // Defensa adicional (además del filtro que ya hace el hook antes de dispatchear): nunca
  // agregar una infracción a un trufi que ya tiene una activa.
  const aAgregar = nuevas.filter((inf) => !infraccionActivaDe(estado, inf.trufiId));
  if (aAgregar.length === 0) {
    return estado;
  }
  return { ...estado, infracciones: [...estado.infracciones, ...aAgregar] };
}

function asignarParada(
  estado: EstadoFlotaMock,
  trufiId: string,
  paradaId: string,
): EstadoFlotaMock {
  const actual = estado.trufis[trufiId];
  if (!actual) {
    return estado;
  }
  return {
    ...estado,
    trufis: { ...estado.trufis, [trufiId]: { ...actual, siguienteParadaId: paradaId } },
  };
}

function aplicarAccion(
  estado: EstadoFlotaMock,
  infraccionId: string,
  accionId: string,
  modo: ModoAplicacion,
  aplicadaEn: string,
  venceEl: string | undefined,
): EstadoFlotaMock {
  const infraccion = estado.infracciones.find((i) => i.id === infraccionId);
  if (!infraccion || infraccion.estado !== 'activa') {
    return estado;
  }

  if (modo === 'plazo') {
    if (!venceEl || !fechaPlazoValida(venceEl, aplicadaEn)) {
      // Plazo inválido (fuera de [hoy, hoy+30d] o fecha ilegible) — la acción se ignora.
      return estado;
    }
  }

  const accionAplicada: AccionAplicada =
    modo === 'plazo' ? { accionId, modo, aplicadaEn, venceEl } : { accionId, modo, aplicadaEn };

  return {
    ...estado,
    infracciones: estado.infracciones.map((i) =>
      i.id === infraccionId ? { ...i, estado: 'sancionada', accionAplicada } : i,
    ),
  };
}

export function reducer(estado: EstadoFlotaMock, accion: AccionFlotaMock): EstadoFlotaMock {
  switch (accion.type) {
    case 'tick':
      return tick(estado);
    case 'simular-infracciones':
      return simularInfracciones(estado, accion.infracciones);
    case 'limpiar-infracciones':
      return estado.infracciones.length === 0 ? estado : { ...estado, infracciones: [] };
    case 'asignar-parada':
      return asignarParada(estado, accion.trufiId, accion.paradaId);
    case 'aplicar-accion':
      return aplicarAccion(
        estado,
        accion.infraccionId,
        accion.accionId,
        accion.modo,
        accion.aplicadaEn,
        accion.venceEl,
      );
    case 'toggle-pausa':
      return { ...estado, pausado: !estado.pausado };
    default:
      return estado;
  }
}
