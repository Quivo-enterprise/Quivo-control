import {
  GRAVEDAD_ORDEN,
  normalizarTelefonoBolivia,
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

const ETIQUETA_TIPO_INFRACCION: Record<Infraccion['tipo'], string> = {
  desvio_ruta: 'Alteración de ruta',
  pc_omitido: 'Punto de control omitido',
  molinos_omitido: 'Molinos omitido',
  espera_corta: 'Espera corta en Molinos',
};

export function etiquetaTipoInfraccion(tipo: Infraccion['tipo']): string {
  return ETIQUETA_TIPO_INFRACCION[tipo];
}

export const ETIQUETA_ESTADO_INFRACCION: Record<Infraccion['estado'], string> = {
  abierta: 'Abierta',
  atendida: 'Atendida',
  sancionada: 'Sancionada',
  descartada: 'Descartada',
};

/** Abiertas primero (más recientes arriba); el resto por fecha descendente. */
export function ordenarInfracciones(infracciones: Infraccion[]): Infraccion[] {
  return [...infracciones].sort((a, b) => {
    const aa = a.estado === 'abierta' ? 0 : 1;
    const bb = b.estado === 'abierta' ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return b.inicioTs.getTime() - a.inicioTs.getTime();
  });
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/** "a 180 m de la ruta" (desvío) / "PC 3 omitido". El número del PC es su posición en la lista
 * del recorrido (`idsPuntosControl`, la misma que el mapa y el panel) y, si no se conoce, `orden + 1`. */
export function detalleInfraccion(
  i: Pick<Infraccion, 'tipo' | 'detalle'>,
  idsPuntosControl: readonly string[] = [],
): string {
  if (i.tipo === 'desvio_ruta') {
    const m = numero(i.detalle.distanciaMaxM);
    return m === null ? 'fuera de la ruta' : `a ${Math.round(m)} m de la ruta`;
  }
  if (i.tipo === 'molinos_omitido') return 'cerró la vuelta sin pasar por Molinos';
  if (i.tipo === 'espera_corta') {
    const esperado = numero(i.detalle.esperaMin);
    const requerido = numero(i.detalle.requeridoMin);
    return esperado !== null && requerido !== null
      ? `esperó ${esperado} de ${requerido} min en Molinos`
      : 'salió de Molinos antes de tiempo';
  }
  const posicion = typeof i.detalle.puntoControlId === 'string' ? idsPuntosControl.indexOf(i.detalle.puntoControlId) : -1;
  const orden = posicion >= 0 ? posicion : numero(i.detalle.orden);
  const nombre = typeof i.detalle.nombre === 'string' && i.detalle.nombre.trim() ? i.detalle.nombre.trim() : null;
  const base = orden === null ? 'PC omitido' : `PC ${orden + 1} omitido`;
  return nombre ? `${base} (${nombre})` : base;
}

/** Duración "12 min" / "45 s" solo si la infracción ya cerró (`finTs`). */
export function duracionInfraccion(i: Pick<Infraccion, 'inicioTs' | 'finTs'>): string | null {
  if (!i.finTs) return null;
  const s = Math.max(0, Math.round((i.finTs.getTime() - i.inicioTs.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** `desvio_ruta` y `molinos_omitido` se pueden sancionar; `pc_omitido` y `espera_corta` son solo
 * alerta (la API da 409). */
export function puedeSancionar(i: Pick<Infraccion, 'tipo' | 'estado'>): boolean {
  return (
    (i.tipo === 'desvio_ruta' || i.tipo === 'molinos_omitido') &&
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

/** Valores iniciales de la sanción para una infracción de desvío. */
export function motivoSancion(i: Pick<Infraccion, 'tipo' | 'detalle' | 'inicioTs'>, placa?: string): string {
  const hora = i.inicioTs.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  return `${etiquetaTipoInfraccion(i.tipo)}${placa ? ` del vehículo ${placa}` : ''}: ${detalleInfraccion(i)} (${hora}).`;
}

/** Solo las reglas activas del sindicato de la infracción: `admin_quivo` recibe las de TODOS los
 * sindicatos y una ajena no puede ofrecerse ni preseleccionarse. */
export function reglasSancionables<R extends { sindicatoId: string; estado: string }>(
  reglas: readonly R[],
  sindicatoId: string,
): R[] {
  return reglas.filter((r) => r.sindicatoId === sindicatoId && r.estado === 'activo');
}

/** Regla preseleccionada de la sanción: la de la infracción si sigue activa; si no, la regla activa
 * de "Alteración de ruta". Sin ninguna, `undefined`: el admin la elige (no se asume la primera). */
export function reglaInicialSancion(
  inf: Pick<Infraccion, 'reglaId'>,
  reglasActivas: { id: string; tipo: string }[],
): string | undefined {
  if (inf.reglaId && reglasActivas.some((r) => r.id === inf.reglaId)) return inf.reglaId;
  return reglasActivas.find((r) => r.tipo === 'desvio_ruta')?.id;
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
