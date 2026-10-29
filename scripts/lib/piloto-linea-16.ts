/**
 * Funciones PURAS de `scripts/crear-piloto-linea-16.ts` y `scripts/renombrar-piloto-linea-16.ts`
 * (sin red, sin fs, sin process): lista de pilotos, hoy en La Paz, rangos de fechas, plan de
 * asignaciones faltantes, decisión de anular/publicar la rotación, fusión/reescritura del archivo
 * de credenciales y parseo/validación del TSV de datos reales. Tests: `piloto-linea-16.test.ts`.
 */

// ============================================================================================
// Pilotos (placas y CI SINTÉTICOS con que se crearon; los datos reales viven fuera del repo)
// ============================================================================================

export interface PilotoDef {
  placa: string;
  conductor: { nombre: string; documentoIdentidad: string; licenciaConducir: string };
  /** true = piloto agregado después (rango por defecto: desde HOY, no días pasados). */
  nuevo: boolean;
}

/** El primero es el piloto original (sin cambios). El orden importa: se crea primero. */
export const PILOTOS: readonly PilotoDef[] = [
  { placa: '1616PIL', conductor: { nombre: 'Piloto Línea Dieciséis', documentoIdentidad: '9000016 CB', licenciaConducir: 'LIC-9000016' }, nuevo: false },
  { placa: '1616PIB', conductor: { nombre: 'Piloto Línea Dieciséis Bravo', documentoIdentidad: '9000017 CB', licenciaConducir: 'LIC-9000017' }, nuevo: true },
  { placa: '1616PIC', conductor: { nombre: 'Piloto Línea Dieciséis Charlie', documentoIdentidad: '9000018 CB', licenciaConducir: 'LIC-9000018' }, nuevo: true },
  { placa: '1616PID', conductor: { nombre: 'Piloto Línea Dieciséis Delta', documentoIdentidad: '9000019 CB', licenciaConducir: 'LIC-9000019' }, nuevo: true },
  { placa: '1616PIE', conductor: { nombre: 'Piloto Línea Dieciséis Eco', documentoIdentidad: '9000020 CB', licenciaConducir: 'LIC-9000020' }, nuevo: true },
  { placa: '1616PIF', conductor: { nombre: 'Piloto Línea Dieciséis Fox', documentoIdentidad: '9000021 CB', licenciaConducir: 'LIC-9000021' }, nuevo: true },
  { placa: '1616PIG', conductor: { nombre: 'Piloto Línea Dieciséis Golf', documentoIdentidad: '9000022 CB', licenciaConducir: 'LIC-9000022' }, nuevo: true },
  { placa: '1616PIH', conductor: { nombre: 'Piloto Línea Dieciséis Hotel', documentoIdentidad: '9000023 CB', licenciaConducir: 'LIC-9000023' }, nuevo: true },
  { placa: '1616PJA', conductor: { nombre: 'Piloto Línea Dieciséis Nueve', documentoIdentidad: '9000024 CB', licenciaConducir: 'LIC-9000024' }, nuevo: true },
  { placa: '1616PJB', conductor: { nombre: 'Piloto Línea Dieciséis Diez', documentoIdentidad: '9000025 CB', licenciaConducir: 'LIC-9000025' }, nuevo: true },
  { placa: '1616PJC', conductor: { nombre: 'Piloto Línea Dieciséis Once', documentoIdentidad: '9000026 CB', licenciaConducir: 'LIC-9000026' }, nuevo: true },
  { placa: '1616PJD', conductor: { nombre: 'Piloto Línea Dieciséis Doce', documentoIdentidad: '9000027 CB', licenciaConducir: 'LIC-9000027' }, nuevo: true },
  { placa: '1616PJE', conductor: { nombre: 'Piloto Línea Dieciséis Trece', documentoIdentidad: '9000028 CB', licenciaConducir: 'LIC-9000028' }, nuevo: true },
  { placa: '1616PJF', conductor: { nombre: 'Piloto Línea Dieciséis Catorce', documentoIdentidad: '9000029 CB', licenciaConducir: 'LIC-9000029' }, nuevo: true },
  { placa: '1616PJG', conductor: { nombre: 'Piloto Línea Dieciséis Quince', documentoIdentidad: '9000030 CB', licenciaConducir: 'LIC-9000030' }, nuevo: true },
  { placa: '1616PJH', conductor: { nombre: 'Piloto Línea Dieciséis Dieciséis', documentoIdentidad: '9000031 CB', licenciaConducir: 'LIC-9000031' }, nuevo: true },
  { placa: '1616PJI', conductor: { nombre: 'Piloto Línea Dieciséis Diecisiete', documentoIdentidad: '9000032 CB', licenciaConducir: 'LIC-9000032' }, nuevo: true },
  { placa: '1616PJJ', conductor: { nombre: 'Piloto Línea Dieciséis Dieciocho', documentoIdentidad: '9000033 CB', licenciaConducir: 'LIC-9000033' }, nuevo: true },
  { placa: '1616PJK', conductor: { nombre: 'Piloto Línea Dieciséis Diecinueve', documentoIdentidad: '9000034 CB', licenciaConducir: 'LIC-9000034' }, nuevo: true },
  { placa: '1616PJL', conductor: { nombre: 'Piloto Línea Dieciséis Veinte', documentoIdentidad: '9000035 CB', licenciaConducir: 'LIC-9000035' }, nuevo: true },
  { placa: '1616PJM', conductor: { nombre: 'Piloto Línea Dieciséis Veintiuno', documentoIdentidad: '9000036 CB', licenciaConducir: 'LIC-9000036' }, nuevo: true },
  { placa: '1616PJN', conductor: { nombre: 'Piloto Línea Dieciséis Veintidós', documentoIdentidad: '9000037 CB', licenciaConducir: 'LIC-9000037' }, nuevo: true },
  { placa: '1616PJO', conductor: { nombre: 'Piloto Línea Dieciséis Veintitrés', documentoIdentidad: '9000038 CB', licenciaConducir: 'LIC-9000038' }, nuevo: true },
  { placa: '1616PJP', conductor: { nombre: 'Piloto Línea Dieciséis Veinticuatro', documentoIdentidad: '9000039 CB', licenciaConducir: 'LIC-9000039' }, nuevo: true },
  { placa: '1616PJQ', conductor: { nombre: 'Piloto Línea Dieciséis Veinticinco', documentoIdentidad: '9000040 CB', licenciaConducir: 'LIC-9000040' }, nuevo: true },
  { placa: '1616PJR', conductor: { nombre: 'Piloto Línea Dieciséis Veintiséis', documentoIdentidad: '9000041 CB', licenciaConducir: 'LIC-9000041' }, nuevo: true },
  { placa: '1616PJS', conductor: { nombre: 'Piloto Línea Dieciséis Veintisiete', documentoIdentidad: '9000042 CB', licenciaConducir: 'LIC-9000042' }, nuevo: true },
  { placa: '1616PJT', conductor: { nombre: 'Piloto Línea Dieciséis Veintiocho', documentoIdentidad: '9000043 CB', licenciaConducir: 'LIC-9000043' }, nuevo: true },
  { placa: '1616PJU', conductor: { nombre: 'Piloto Línea Dieciséis Veintinueve', documentoIdentidad: '9000044 CB', licenciaConducir: 'LIC-9000044' }, nuevo: true },
  { placa: '1616PJV', conductor: { nombre: 'Piloto Línea Dieciséis Treinta', documentoIdentidad: '9000045 CB', licenciaConducir: 'LIC-9000045' }, nuevo: true },
  { placa: '1616PJW', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y uno', documentoIdentidad: '9000046 CB', licenciaConducir: 'LIC-9000046' }, nuevo: true },
  { placa: '1616PJX', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y dos', documentoIdentidad: '9000047 CB', licenciaConducir: 'LIC-9000047' }, nuevo: true },
  { placa: '1616PJY', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y tres', documentoIdentidad: '9000048 CB', licenciaConducir: 'LIC-9000048' }, nuevo: true },
  { placa: '1616PJZ', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y cuatro', documentoIdentidad: '9000049 CB', licenciaConducir: 'LIC-9000049' }, nuevo: true },
  { placa: '1616PKA', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y cinco', documentoIdentidad: '9000050 CB', licenciaConducir: 'LIC-9000050' }, nuevo: true },
  { placa: '1616PKB', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y seis', documentoIdentidad: '9000051 CB', licenciaConducir: 'LIC-9000051' }, nuevo: true },
  { placa: '1616PKC', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y siete', documentoIdentidad: '9000052 CB', licenciaConducir: 'LIC-9000052' }, nuevo: true },
  { placa: '1616PKD', conductor: { nombre: 'Piloto Línea Dieciséis Treinta y ocho', documentoIdentidad: '9000053 CB', licenciaConducir: 'LIC-9000053' }, nuevo: true },
];

// ============================================================================================
// Fechas
// ============================================================================================

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
  /** Piloto renombrado: si ya hay línea, conservar su nombre (el real) en vez de `nombre` (sintético). */
  conservarNombre?: boolean;
}

const RE_LINEA_PILOTO = /^([0-9]{3,4}[A-Z]{3}) \| (.+) \| pin=(\d{6,12})$/;

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
  for (const n of nuevas) pilotos.set(n.placa, { nombre: (n.conservarNombre && pilotos.get(n.placa)?.nombre) || n.nombre, pin: n.pin });
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

// ============================================================================================
// Datos reales (TSV fuera del repo) y renombrado
// ============================================================================================

// Réplicas de `PlacaVehiculoSchema` / `NombrePersonaSchema` (packages/shared; fuente de verdad: si
// cambian allá, reflejarlo acá a mano). No se importa shared: los scripts son standalone (sin zod en runtime).
const normalizarPlaca = (p: string): string => p.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizarNombre = (n: string): string => n.normalize('NFC').trim().replace(/\s+/g, ' ');

/** Placa PTA actual (3-4 dígitos + 3 letras). Devuelve la placa normalizada o el motivo. */
export function validarPlacaReal(texto: string): { ok: true; placa: string } | { ok: false; motivo: string } {
  const t = texto.trim();
  if (t.length === 0) return { ok: false, motivo: 'placa vacía' };
  if (t.length > 20) return { ok: false, motivo: 'placa demasiado larga' };
  if (!/^[A-Za-z0-9 -]+$/.test(t)) return { ok: false, motivo: 'placa con caracteres no permitidos' };
  const placa = normalizarPlaca(t);
  if (!/^\d{3,4}[A-Z]{3}$/.test(placa)) return { ok: false, motivo: 'placa no es 3 o 4 números + 3 letras' };
  return { ok: true, placa };
}

/** Nombre de persona: 3..200, solo letras/marcas, espacios, apóstrofes, guiones y puntos; empieza y termina en letra. */
export function validarNombreReal(texto: string): { ok: true; nombre: string } | { ok: false; motivo: string } {
  const nombre = normalizarNombre(texto);
  if (nombre.length < 3) return { ok: false, motivo: 'nombre de menos de 3 caracteres' };
  if (nombre.length > 200) return { ok: false, motivo: 'nombre de más de 200 caracteres' };
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$/u.test(nombre)) {
    return { ok: false, motivo: 'nombre con caracteres no permitidos o que no empieza/termina en letra (sin punto final)' };
  }
  return { ok: true, nombre };
}

export interface FilaReal {
  /** N° de línea (1-based) en el archivo. */
  linea: number;
  placaActual: string;
  /** '' si accion = 'desactivar'. */
  placaReal: string;
  nombreReal: string;
  /** 'desactivar' = fila `PLACA<TAB>-<TAB>-`: vehículo + conductor pasan a inactivo (no se renombra). */
  accion: 'renombrar' | 'desactivar';
}

export interface ErrorFila {
  linea: number;
  /** Placa actual de la fila (sintética, no es PII) o '?' si no se pudo leer. */
  placa: string;
  motivo: string;
}

function filasCrudas(texto: string): { linea: number; cols: string[] }[] {
  const out: { linea: number; cols: string[] }[] = [];
  texto.split('\n').forEach((cruda, i) => {
    const l = cruda.replace(/\r$/, '');
    if (l.trim() === '' || l.trimStart().startsWith('#')) return;
    out.push({ linea: i + 1, cols: l.split('\t').map((c) => c.trim()) });
  });
  return out;
}

/** Parsea y valida TODO el TSV `placa_actual<TAB>placa_real<TAB>nombre_real`. Sin escrituras ni red.
 * Los motivos de error NUNCA incluyen el nombre ni la placa real. */
export function parsearReales(texto: string, pilotos: readonly PilotoDef[] = PILOTOS): { filas: FilaReal[]; errores: ErrorFila[] } {
  const validas = new Set(pilotos.map((p) => p.placa));
  const filas: FilaReal[] = [];
  const errores: ErrorFila[] = [];
  for (const { linea, cols } of filasCrudas(texto)) {
    const placaActual = (cols[0] ?? '').toUpperCase();
    const err = (motivo: string): void => void errores.push({ linea, placa: placaActual || '?', motivo });
    if (cols.length !== 3) { err(`se esperaban 3 columnas separadas por TAB, hay ${cols.length}`); continue; }
    if (!validas.has(placaActual)) { err('placa_actual no es un piloto conocido'); continue; }
    if (cols[1] === '-' && cols[2] === '-') { filas.push({ linea, placaActual, placaReal: '', nombreReal: '', accion: 'desactivar' }); continue; }
    const pr = validarPlacaReal(cols[1]!);
    if (!pr.ok) { err(`placa_real: ${pr.motivo}`); continue; }
    const nr = validarNombreReal(cols[2]!);
    if (!nr.ok) { err(`nombre_real: ${nr.motivo}`); continue; }
    filas.push({ linea, placaActual, placaReal: pr.placa, nombreReal: nr.nombre, accion: 'renombrar' });
  }
  // Duplicados y colisiones (sobre las filas ya válidas).
  const porActual = (f: FilaReal): string => f.placaActual;
  const contar = <T>(k: (f: FilaReal) => T): Map<T, FilaReal[]> => {
    const m = new Map<T, FilaReal[]>();
    for (const f of filas) if (f.accion === 'renombrar' || k === porActual) m.set(k(f), [...(m.get(k(f)) ?? []), f]);
    return m;
  };
  const malas = new Set<number>();
  const marca = (f: FilaReal, motivo: string): void => { malas.add(f.linea); errores.push({ linea: f.linea, placa: f.placaActual, motivo }); };
  for (const g of contar(porActual).values()) if (g.length > 1) g.forEach((f) => marca(f, `placa_actual repetida (líneas ${g.map((x) => x.linea).join(', ')})`));
  for (const g of contar((f) => f.placaReal).values()) if (g.length > 1) g.forEach((f) => marca(f, `placa_real repetida (líneas ${g.map((x) => x.linea).join(', ')})`));
  for (const g of contar((f) => f.nombreReal.toLowerCase()).values()) if (g.length > 1) g.forEach((f) => marca(f, `nombre_real repetido (líneas ${g.map((x) => x.linea).join(', ')})`));
  const sinteticas = new Set(pilotos.map((p) => p.placa));
  for (const f of filas) {
    if (malas.has(f.linea) || f.accion === 'desactivar') continue;
    // La placa real no puede ser la sintética de OTRO piloto (cadena/permuta de renombres).
    if (f.placaReal !== f.placaActual && sinteticas.has(f.placaReal)) marca(f, 'placa_real coincide con la placa sintética de un piloto');
  }
  errores.sort((a, b) => a.linea - b.linea);
  return { filas: filas.filter((f) => !malas.has(f.linea)), errores };
}

/** Solo lo que necesita el creador: placa_actual→placa_real y los pilotos marcados `-` (desactivados).
 * No lee nombres. Lanza si hay filas inválidas. */
export function leerMapaPlacas(texto: string): { mapa: Map<string, string>; desactivados: Set<string> } {
  // Misma validación que el renombrador (parsearReales): creador y renombrador no pueden discrepar.
  const { filas, errores } = parsearReales(texto);
  if (errores.length > 0) throw new Error(`QUIVO_PILOTO16_REALES_FILE inválido (línea(s) ${errores.map((e) => e.linea).join(', ')}): ${errores[0]!.motivo}.`);
  const mapa = new Map<string, string>();
  const desactivados = new Set<string>();
  for (const f of filas) {
    if (f.accion === 'desactivar') desactivados.add(f.placaActual);
    else mapa.set(f.placaActual, f.placaReal);
  }
  return { mapa, desactivados };
}

export interface Renombre {
  placaActual: string;
  placaReal: string;
  nombreReal: string;
  /** false = solo la placa se aplicó (el PATCH del nombre falló): se conserva el nombre de la línea. Default true. */
  nombreAplicado?: boolean;
}

/**
 * Reescribe SOLO las líneas de credenciales de los pilotos renombrados a `placaReal | nombreReal | pin=<mismo>`,
 * conservando PIN, orden y cualquier otra línea; actualiza `actualizado=` si existe. Idempotente: si la línea
 * ya está con la placa real, solo ajusta el nombre. `sinLinea` = placas actuales sin línea de credenciales.
 */
export function reescribirCreds(previo: string, renombres: Renombre[], ahoraIso: string): { texto: string; sinLinea: string[] } {
  const lineas = previo.split('\n');
  const sinLinea: string[] = [];
  for (const r of renombres) {
    const i = lineas.findIndex((l) => {
      const m = RE_LINEA_PILOTO.exec(l.trim());
      return !!m && (m[1] === r.placaActual || m[1] === r.placaReal);
    });
    if (i < 0) { sinLinea.push(r.placaActual); continue; }
    const m = RE_LINEA_PILOTO.exec(lineas[i]!.trim())!;
    lineas[i] = `${r.placaReal} | ${r.nombreAplicado === false ? m[2]! : r.nombreReal} | pin=${m[3]!}`;
  }
  const j = lineas.findIndex((l) => l.startsWith('actualizado='));
  if (j >= 0) lineas[j] = `actualizado=${ahoraIso}`;
  return { texto: lineas.join('\n'), sinLinea };
}
