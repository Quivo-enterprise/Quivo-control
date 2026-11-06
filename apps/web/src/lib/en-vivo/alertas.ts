import {
  GRAVEDAD_ORDEN,
  normalizarTelefonoBolivia,
  TIPOS_INFRACCION_SOLO_ALERTA,
  type GravedadRegla,
  type Infraccion,
  type PosicionEnVivo,
} from '@quivo/shared';

/**
 * Lógica pura de las alertas por infracción de `/en-vivo` (PR E, `docs/plan-en-vivo-alertas.md`):
 * contadores y filtro por nivel del HUD, orden de "Siguiente alerta", textos de la lista de
 * infracciones del panel y enlaces de contacto. Sin React: se testea en `node`.
 */

/** De más a menos grave: es el orden de la leyenda y de "Siguiente alerta". */
export const NIVELES_DESC: readonly GravedadRegla[] = ['gravisima', 'grave', 'leve'];

export const ETIQUETA_NIVEL: Record<GravedadRegla, { singular: string; plural: string }> = {
  gravisima: { singular: 'gravísima', plural: 'gravísimas' },
  grave: { singular: 'grave', plural: 'graves' },
  leve: { singular: 'leve', plural: 'leves' },
};

/** Una posición cuenta como "con alerta" solo con infracciones abiertas y un nivel conocido. */
export function nivelDeAlerta(p: Pick<PosicionEnVivo, 'infraccionNivel' | 'infraccionesAbiertas'>): GravedadRegla | null {
  return p.infraccionNivel && (p.infraccionesAbiertas ?? 0) > 0 ? p.infraccionNivel : null;
}

/** Roles que pueden atender, descartar y sancionar infracciones (la API da 403 al resto: el
 * `operador` las ve en solo lectura). Allowlist: un rol nuevo no hereda el permiso por omisión. */
const ROLES_ACTUAN_INFRACCIONES: readonly string[] = ['admin_quivo', 'admin_sindicato'];
export function puedeActuarEnInfracciones(rol: string | null | undefined): boolean {
  return rol !== null && rol !== undefined && ROLES_ACTUAN_INFRACCIONES.includes(rol);
}

export interface AlertaMarcador {
  nivel: GravedadRegla;
  abiertas: number;
  atendidas: number;
  parpadea: boolean;
}

/**
 * Alerta del marcador del vehículo (pendiente E #1): el nivel sale de las infracciones abiertas y,
 * solo si no queda ninguna, de las atendidas (ícono fijo de "ya la atendieron"); SOLO parpadea si
 * queda alguna abierta. `null` = sin ninguna: sin ícono.
 */
export function alertaMarcador(
  p: Pick<
    PosicionEnVivo,
    'infraccionNivel' | 'infraccionesAbiertas' | 'infraccionNivelAtendida' | 'infraccionesAtendidas'
  >,
): AlertaMarcador | null {
  const abiertas = p.infraccionNivel && (p.infraccionesAbiertas ?? 0) > 0 ? (p.infraccionesAbiertas ?? 0) : 0;
  const atendidas =
    p.infraccionNivelAtendida && (p.infraccionesAtendidas ?? 0) > 0 ? (p.infraccionesAtendidas ?? 0) : 0;
  // Con abiertas el nivel sale SOLO de ellas (una atendida gravísima no debe inflar una abierta leve);
  // las atendidas definen el nivel únicamente cuando no queda ninguna abierta.
  const nivel = abiertas > 0 ? p.infraccionNivel : atendidas > 0 ? p.infraccionNivelAtendida : null;
  if (!nivel) return null;
  return { nivel, abiertas, atendidas, parpadea: abiertas > 0 };
}

/** Vehículos (no infracciones) por su nivel máximo, sobre la lista que se está mirando. */
export function contarPorNivel(
  posiciones: Pick<PosicionEnVivo, 'infraccionNivel' | 'infraccionesAbiertas'>[],
): Record<GravedadRegla, number> {
  const cuenta: Record<GravedadRegla, number> = { gravisima: 0, grave: 0, leve: 0 };
  for (const p of posiciones) {
    const nivel = nivelDeAlerta(p);
    if (nivel) cuenta[nivel] += 1;
  }
  return cuenta;
}

/** Texto compacto de los contadores: "1 gravísima · 2 graves · 3 leves" (omite los niveles en 0). */
export function resumenContadores(cuenta: Record<GravedadRegla, number>): string {
  return NIVELES_DESC.filter((n) => cuenta[n] > 0)
    .map((n) => `${cuenta[n]} ${cuenta[n] === 1 ? ETIQUETA_NIVEL[n].singular : ETIQUETA_NIVEL[n].plural}`)
    .join(' · ');
}

/** Filtro "solo con alertas de ese nivel" (`null` = sin filtro). */
export function filtrarPorNivel<T extends Pick<PosicionEnVivo, 'infraccionNivel' | 'infraccionesAbiertas'>>(
  posiciones: T[],
  nivel: GravedadRegla | null,
): T[] {
  return nivel ? posiciones.filter((p) => nivelDeAlerta(p) === nivel) : posiciones;
}

/**
 * Vehículos con alerta abierta en el orden de "Siguiente alerta": nivel descendente y, a igual
 * nivel, la alerta que se vio primero (`primeraVezMs`: la posición no trae el inicio de la
 * infracción, así que se usa el instante en que ESTA pestaña la vio por primera vez; sin dato,
 * al final) y, por último, la placa para un orden estable.
 */
export function ordenarAlertas<
  T extends Pick<PosicionEnVivo, 'id' | 'vehiculoPlaca' | 'infraccionNivel' | 'infraccionesAbiertas'>,
>(posiciones: T[], primeraVezMs: ReadonlyMap<string, number> = new Map()): T[] {
  return posiciones
    .filter((p) => nivelDeAlerta(p) !== null)
    .sort((a, b) => {
      const dif = GRAVEDAD_ORDEN[nivelDeAlerta(b)!] - GRAVEDAD_ORDEN[nivelDeAlerta(a)!];
      if (dif !== 0) return dif;
      const ta = primeraVezMs.get(a.id) ?? Number.POSITIVE_INFINITY;
      const tb = primeraVezMs.get(b.id) ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.vehiculoPlaca.localeCompare(b.vehiculoPlaca);
    });
}

/**
 * Instante (ms) en que esta pestaña vio por primera vez la alerta de cada vehículo. Es PURA y
 * determinista: devuelve el MISMO mapa (misma referencia) si nada cambió, así se puede usar como
 * estado derivado durante el render sin bucles. Las alertas que ya no están (cerradas) se olvidan.
 */
export function actualizarPrimeraVez(
  previo: ReadonlyMap<string, number>,
  posiciones: Pick<PosicionEnVivo, 'id' | 'infraccionNivel' | 'infraccionesAbiertas'>[],
  ahoraMs: number,
): ReadonlyMap<string, number> {
  const vivas = new Set<string>();
  const siguiente = new Map(previo);
  for (const p of posiciones) {
    if (!nivelDeAlerta(p)) continue;
    vivas.add(p.id);
    if (!siguiente.has(p.id)) siguiente.set(p.id, ahoraMs);
  }
  for (const id of previo.keys()) if (!vivas.has(id)) siguiente.delete(id);
  const igual = siguiente.size === previo.size && [...siguiente].every(([id, t]) => previo.get(id) === t);
  return igual ? previo : siguiente;
}

/** Id del vehículo que sigue en la lista circular, a partir del seleccionado (o el primero). */
export function siguienteAlertaId(ordenadas: { id: string }[], actualId: string | null): string | null {
  if (ordenadas.length === 0) return null;
  const i = actualId ? ordenadas.findIndex((p) => p.id === actualId) : -1;
  return ordenadas[(i + 1) % ordenadas.length]!.id;
}

// ---------------------------------------------------------------------------------------------
// Lista de infracciones del panel
// ---------------------------------------------------------------------------------------------

export const ETIQUETA_ESTADO_INFRACCION: Record<Infraccion['estado'], string> = {
  abierta: 'Abierta',
  atendida: 'Atendida',
  sancionada: 'Sancionada',
  descartada: 'Descartada',
};

/** Resultado local de una acción lograda: se aplica solo mientras el servidor siga en `desde` (si cambió después, manda él). */
export type ResueltasInfraccion = ReadonlyMap<string, { desde: Infraccion['estado']; a: Infraccion['estado'] }>;
export function aplicarResueltas<T extends Pick<Infraccion, 'id' | 'estado'>>(lista: readonly T[], resueltas: ResueltasInfraccion): T[] {
  return lista.map((i) => {
    const r = resueltas.get(i.id);
    return r && i.estado === r.desde ? { ...i, estado: r.a } : i;
  });
}

/** Abiertas primero (más recientes arriba); el resto por fecha descendente. */
export function ordenarInfracciones(infracciones: Infraccion[]): Infraccion[] {
  return [...infracciones].sort((a, b) => {
    const aa = a.estado === 'abierta' ? 0 : 1;
    const bb = b.estado === 'abierta' ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return b.inicioTs.getTime() - a.inicioTs.getTime();
  });
}

/** Duración "12 min" / "45 s" solo si la infracción ya cerró (`finTs`). */
export function duracionInfraccion(i: Pick<Infraccion, 'inicioTs' | 'finTs'>): string | null {
  if (!i.finTs) return null;
  const s = Math.max(0, Math.round((i.finTs.getTime() - i.inicioTs.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Se sanciona todo tipo salvo los de `TIPOS_INFRACCION_SOLO_ALERTA` (hoy `espera_corta`; la API da 409). */
export function puedeSancionar(i: Pick<Infraccion, 'tipo' | 'estado'>): boolean {
  return (
    !(TIPOS_INFRACCION_SOLO_ALERTA as readonly string[]).includes(i.tipo) &&
    (i.estado === 'abierta' || i.estado === 'atendida')
  );
}

/** Atender solo aplica a una abierta (API: `ESTADOS_ORIGEN.atender`). */
export function puedeAtender(i: Pick<Infraccion, 'estado'>): boolean {
  return i.estado === 'abierta';
}

/** Descartar aplica a abierta y atendida (API: `ESTADOS_ORIGEN.descartar = ['abierta', 'atendida']`). */
export function puedeDescartar(i: Pick<Infraccion, 'estado'>): boolean {
  return i.estado === 'abierta' || i.estado === 'atendida';
}

/** Solo las reglas activas del sindicato de la infracción: `admin_quivo` recibe las de TODOS los
 * sindicatos y una ajena no puede ofrecerse ni preseleccionarse. */
export function reglasSancionables<R extends { sindicatoId: string; estado: string }>(
  reglas: readonly R[],
  sindicatoId: string,
): R[] {
  return reglas.filter((r) => r.sindicatoId === sindicatoId && r.estado === 'activo');
}

// ---------------------------------------------------------------------------------------------
// Cabecera del panel y contacto
// ---------------------------------------------------------------------------------------------

/** `speed` de la posición viene en m/s; el panel lo muestra en km/h (`null` si no hay dato). */
export function velocidadKmh(speedMs: number | null | undefined): number | null {
  return typeof speedMs === 'number' && Number.isFinite(speedMs) && speedMs >= 0 ? Math.round(speedMs * 3.6) : null;
}

/** Solo dígitos con prefijo país para `wa.me` (`59171234567`). `null` si no es un celular boliviano válido. */
export function telefonoParaWhatsapp(telefono: string | null | undefined): string | null {
  const e164 = normalizarTelefonoBolivia(telefono ?? '');
  return e164 ? e164.slice(1) : null;
}

export function urlWhatsapp(
  telefono: string | null | undefined,
  contexto: { placa: string; lineaNombre: string; infraccion?: string | null },
): string | null {
  const numeroWa = telefonoParaWhatsapp(telefono);
  if (!numeroWa) return null;
  const partes = [`Hola, te escribo del control: vehículo ${contexto.placa}, línea ${contexto.lineaNombre}.`];
  if (contexto.infraccion) partes.push(`Tenemos registrada una infracción abierta: ${contexto.infraccion}.`);
  return `https://wa.me/${numeroWa}?text=${encodeURIComponent(partes.join(' '))}`;
}

export function urlLlamada(telefono: string | null | undefined): string | null {
  const e164 = normalizarTelefonoBolivia(telefono ?? '');
  return e164 ? `tel:${e164}` : null;
}

const DIA_BO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' });
const HORA_BO = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Hora de una alerta en Bolivia: `HH:MM` si es de hoy, `ayer HH:MM` si es de ayer, `dd/mm HH:MM` si es anterior
 * (una infracción que cruzó la medianoche sigue visible hoy). */
export function etiquetaInicioAlerta(inicio: Date, ahora: Date = new Date()): string {
  const hora = HORA_BO.format(inicio);
  const dia = DIA_BO.format(inicio);
  if (dia === DIA_BO.format(ahora)) return hora;
  if (dia === DIA_BO.format(new Date(ahora.getTime() - 24 * 3_600_000))) return `ayer ${hora}`;
  const [, mes, d] = dia.split('-');
  return `${d}/${mes} ${hora}`;
}

/** HH:MM en hora de La Paz (para "datos de las HH:MM"). */
export const horaBo = (ts: number | Date): string => HORA_BO.format(ts);

/** "1 alerta abierta" / "3 alertas abiertas". */
export const textoAlertasAbiertas = (n: number): string => `${n} alerta${n === 1 ? '' : 's'} abierta${n === 1 ? '' : 's'}`;

/**
 * Resumen de la barra de En vivo con las alertas abiertas DEL DÍA (`abiertasHoy`; `'cargando'` = sin datos
 * aún, `'error'` = sin datos y fallida) y el botón junto a él. /posiciones trae una sola sesión por vehículo: las alertas de otras
 * sesiones de hoy no se alcanzan en el mapa (`alcanzables`), y ahí "Siguiente alerta" pasa a "Ver alertas".
 * Sin permiso para /alertas (`operador`) el botón se oculta en vez de quedar deshabilitado junto al número.
 */
export function resumenAlertasDia(
  abiertasHoy: number | 'cargando' | 'error',
  alcanzables: number,
  puedeVerAlertas: boolean,
): { texto: string | null; boton: 'siguiente' | 'enlace' | 'oculto' } {
  if (alcanzables > 0) return { texto: null, boton: 'siguiente' };
  if (abiertasHoy === 'cargando') return { texto: null, boton: 'siguiente' };
  if (abiertasHoy === 'error') return { texto: 'Alertas del día sin cargar', boton: 'siguiente' };
  if (abiertasHoy === 0) return { texto: 'Sin infracciones abiertas', boton: 'siguiente' };
  return { texto: textoAlertasAbiertas(abiertasHoy), boton: puedeVerAlertas ? 'enlace' : 'oculto' };
}

/** Conteo de alertas abiertas por gravedad (chips del celular); el nivel sin alertas cuenta 0. */
export function cuentaAbiertasPorGravedad(infracciones: readonly Pick<Infraccion, 'estado' | 'gravedad'>[]): Record<GravedadRegla, number> {
  const cuenta: Record<GravedadRegla, number> = { gravisima: 0, grave: 0, leve: 0 };
  for (const i of infracciones) if (i.estado === 'abierta') cuenta[i.gravedad] += 1;
  return cuenta;
}

/** Lista plana del celular: gravísima, grave, leve; dentro de cada nivel, la más reciente primero. */
export function ordenarPorGravedad<T extends Pick<Infraccion, 'gravedad' | 'inicioTs'>>(infracciones: readonly T[]): T[] {
  return [...infracciones].sort((a, b) => NIVELES_DESC.indexOf(a.gravedad) - NIVELES_DESC.indexOf(b.gravedad) || b.inicioTs.getTime() - a.inicioTs.getTime());
}
