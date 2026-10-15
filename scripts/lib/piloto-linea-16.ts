/**
 * Funciones PURAS de `scripts/crear-piloto-linea-16.ts` (sin red, sin fs, sin process): hoy en
 * La Paz, rangos de fechas, plan de asignaciones faltantes, decisión de anular/publicar la
 * rotación y fusión del archivo de credenciales. Tests: `piloto-linea-16.test.ts`.
 */

/** Hoy (YYYY-MM-DD) en America/La_Paz (UTC-4 fijo, Bolivia no tiene DST). */
export function hoyLaPaz(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
}

export function fechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

export function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Días desde..hasta inclusive. Lanza si hay fechas inválidas, desde > hasta o más de `max` días. */
export function rangoFechas(desde: string, hasta: string, max: number): string[] {
  if (!fechaValida(desde) || !fechaValida(hasta)) throw new Error(`Fechas inválidas (${desde} / ${hasta}); se espera YYYY-MM-DD.`);
  if (desde > hasta) throw new Error(`desde (${desde}) es posterior a hasta (${hasta}).`);
  const fechas: string[] = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    fechas.push(f);
    if (fechas.length > max) throw new Error(`El rango supera ${max} días.`);
  }
  return fechas;
}

// ============================================================================================
// Plan de asignaciones
// ============================================================================================

export interface AsignacionLike {
  vehiculoId: string;
  conductorId: string | null;
  rutaId: string;
  /** ISO; solo cuentan los primeros 10 caracteres (YYYY-MM-DD). */
  fecha: string;
  horario: string;
}

export interface PilotoPlanEntrada {
  /** undefined = el vehículo aún no existe (dry-run / primera corrida). */
  vehiculoId: string | undefined;
  conductorId: string | undefined;
  fechas: string[];
  /** true: asignaciones fuera de `fechas` se consideran diferencia (piloto 1, rango fijo). false: solo se avisan. */
  fueraEsDiferencia: boolean;
}

export interface PilotoPlanSalida {
  faltan: string[];
  /** Asignaciones existentes que NO coinciden con el plan (conductor/ruta/horario, y fuera de rango si estricto). */
  diferencias: string[];
  /** Fechas de asignaciones propias fuera de `fechas` (informativo). */
  fuera: string[];
}

export interface PlanRotacion {
  porPiloto: PilotoPlanSalida[];
  /** Asignaciones de vehículos que no son de ningún piloto. */
  ajenas: number;
  hayFaltantes: boolean;
  hayDiferencias: boolean;
}

const fechaDe = (a: { fecha: string }): string => a.fecha.slice(0, 10);

export function planearRotacion(existentes: AsignacionLike[], pilotos: PilotoPlanEntrada[], rutaId: string | null, horario: string): PlanRotacion {
  const vehiculosPiloto = new Set(pilotos.map((p) => p.vehiculoId).filter((x): x is string => !!x));
  const porPiloto = pilotos.map((p): PilotoPlanSalida => {
    const propias = p.vehiculoId ? existentes.filter((a) => a.vehiculoId === p.vehiculoId) : [];
    const porFecha = new Map(propias.map((a) => [fechaDe(a), a]));
    const faltan = p.fechas.filter((f) => !porFecha.has(f));
    const diferencias: string[] = [];
    for (const f of p.fechas) {
      const a = porFecha.get(f);
      if (!a) continue;
      if (!p.conductorId || a.conductorId !== p.conductorId) diferencias.push(`${f}: conductor distinto al del piloto (${a.conductorId})`);
      if (rutaId && a.rutaId !== rutaId) diferencias.push(`${f}: ruta distinta (${a.rutaId})`);
      if (a.horario !== horario) diferencias.push(`${f}: horario '${a.horario}' en vez de '${horario}'`);
    }
    const fuera = propias.filter((a) => !p.fechas.includes(fechaDe(a))).map(fechaDe);
    if (fuera.length > 0 && p.fueraEsDiferencia) diferencias.push(`${fuera.length} asignación(es) fuera del rango (${fuera.join(', ')})`);
    return { faltan, diferencias, fuera };
  });
  const ajenas = existentes.filter((a) => !vehiculosPiloto.has(a.vehiculoId)).length;
  return {
    porPiloto,
    ajenas,
    hayFaltantes: porPiloto.some((p) => p.faltan.length > 0),
    hayDiferencias: porPiloto.some((p) => p.diferencias.length > 0) || ajenas > 0,
  };
}

// ============================================================================================
// Decisión de anular
// ============================================================================================

export type AccionRotacion = 'crear' | 'completar_borrador' | 'sin_cambios' | 'anular' | 'abortar_difiere' | 'abortar_sesion_activa';

export interface DecisionEntrada {
  /** null = la rotación propia no existe. */
  estado: 'borrador' | 'publicada' | string | null;
  hayFaltantes: boolean;
  hayDiferencias: boolean;
  /** Cantidad de sesiones/recorridos activos ahora en los vehículos de la rotación. */
  sesionesActivas: number;
  forzar: boolean;
}

/**
 * Reglas (del chairman): anular una rotación PUBLICADA solo si hay faltantes Y todo lo existente
 * coincide con el plan; y solo si no hay sesión activa (salvo --forzar-anular). Nunca modifica ni
 * borra asignaciones existentes de una rotación publicada.
 */
export function decidirAnular(e: DecisionEntrada): { accion: AccionRotacion; motivo: string } {
  if (e.estado === null) return { accion: 'crear', motivo: 'la rotación no existe' };
  if (e.estado !== 'publicada') return { accion: 'completar_borrador', motivo: `rotación en '${e.estado}': se completa y se publica` };
  if (e.hayDiferencias) return { accion: 'abortar_difiere', motivo: 'la rotación publicada difiere del plan; no se reescribe' };
  if (!e.hayFaltantes) return { accion: 'sin_cambios', motivo: 'la rotación publicada ya coincide con el plan' };
  if (e.sesionesActivas > 0 && !e.forzar) {
    return { accion: 'abortar_sesion_activa', motivo: `hay ${e.sesionesActivas} sesión(es) activa(s) en los vehículos de la rotación (usar --forzar-anular para ignorar)` };
  }
  return { accion: 'anular', motivo: e.sesionesActivas > 0 ? 'faltantes; sesiones activas ignoradas por --forzar-anular' : 'hay asignaciones faltantes y lo existente coincide con el plan' };
}

export interface SesionEnVivoLike {
  activa: boolean;
  vehiculoPlaca: string;
  estadoFrescura: string;
}

/** Sesiones que bloquean anular: sesión de login abierta (`fin IS NULL AND estado='activa'`) de un
 * vehículo del piloto cuyo recorrido está reportando o detenido (no perdido / sin datos / finalizado). */
export function sesionesBloqueantes(sesiones: SesionEnVivoLike[], placas: string[]): SesionEnVivoLike[] {
  const set = new Set(placas.map((p) => p.toUpperCase()));
  return sesiones.filter((s) => s.activa && set.has(s.vehiculoPlaca.toUpperCase()) && (s.estadoFrescura === 'reportando' || s.estadoFrescura === 'detenido'));
}

// ============================================================================================
// Archivo de credenciales
// ============================================================================================

export interface CredNueva {
  placa: string;
  nombre: string;
  pin: string;
}

const RE_LINEA_PILOTO = /^([0-9]{4}[A-Z]{3}) \| (.+) \| pin=(\d{6,12})$/;

/**
 * Fusiona credenciales nuevas en el contenido previo del archivo SIN pisar a otros pilotos.
 * Formato legible: una línea `PLACA | Nombre del conductor | pin=NNNNNNNN` por piloto. El formato
 * legado (`placa=…` / `pin_conductor=…` de una sola corrida) se migra a ese formato (si trae PIN y
 * placa; `pin_vehiculo` se conserva como línea `pin_vehiculo=`). `nombreLegado` = nombre del conductor
 * al que pertenecía el formato legado (el piloto 1). `extras` = claves `k=v` sueltas (p. ej. pin_vehiculo). Una placa en `nuevas` reemplaza solo su propia línea.
 */
export function fusionarCreds(previo: string, nuevas: CredNueva[], ahoraIso: string, nombreLegado: string, extras: Record<string, string> = {}): string {
  const pilotos = new Map<string, { nombre: string; pin: string }>();
  const otras: string[] = [];
  const legado = new Map<string, string>();
  for (const cruda of previo.split('\n')) {
    const linea = cruda.trim();
    if (linea === '' || linea.startsWith('#')) continue;
    const m = RE_LINEA_PILOTO.exec(linea);
    if (m) {
      pilotos.set(m[1]!, { nombre: m[2]!, pin: m[3]! });
      continue;
    }
    const kv = /^([a-z_]+)=(.*)$/.exec(linea);
    if (kv) {
      if (kv[1] === 'actualizado') continue;
      legado.set(kv[1]!, kv[2]!);
      continue;
    }
    otras.push(linea);
  }
  const placaLegada = legado.get('placa');
  const pinLegado = legado.get('pin_conductor');
  if (placaLegada && pinLegado && /^\d{6,12}$/.test(pinLegado)) {
    if (!pilotos.has(placaLegada)) pilotos.set(placaLegada, { nombre: nombreLegado, pin: pinLegado });
    legado.delete('placa');
    legado.delete('pin_conductor');
  }
  for (const n of nuevas) pilotos.set(n.placa, { nombre: n.nombre, pin: n.pin });
  for (const [k, v] of Object.entries(extras)) legado.set(k, v);
  const lineas = [
    '# Piloto línea 16 — credenciales móviles (login en la app: placa + PIN del conductor)',
    ...[...pilotos].sort(([a], [b]) => a.localeCompare(b)).map(([placa, v]) => `${placa} | ${v.nombre} | pin=${v.pin}`),
    ...[...legado].map(([k, v]) => `${k}=${v}`),
    ...otras,
    `actualizado=${ahoraIso}`,
  ];
  return lineas.join('\n') + '\n';
}
