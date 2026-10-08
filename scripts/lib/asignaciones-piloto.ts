/**
 * Helpers PUROS (sin red, sin env, sin efectos) de `scripts/extender-asignaciones-piloto.ts`.
 * Viven aparte para poder testearlos con vitest sin disparar la lectura de credenciales ni el
 * login que el script hace al cargarse.
 *
 * "Fecha" en todo este archivo = string `YYYY-MM-DD` del calendario de Bolivia (America/La_Paz,
 * UTC-4 fijo todo el año, sin horario de verano). Es la misma convención que el servidor:
 * `fechaActualBolivia` (apps/api/src/common/tiempo/jornada.ts) y la columna `@db.Date`.
 */

export const BOLIVIA_UTC_OFFSET_HORAS = 4;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaIso(valor: string): boolean {
  if (!FECHA_REGEX.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** Fecha calendario de hoy en La Paz (`YYYY-MM-DD`). Acepta `ahora` para tests deterministas. */
export function fechaActualLaPaz(ahora: Date = new Date()): string {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HORAS * 3_600_000);
  return bolivia.toISOString().slice(0, 10);
}

/** Rango inclusive `[desde, hasta]` de fechas `YYYY-MM-DD`. Lanza si el formato es inválido o
 * `desde > hasta`. Aritmética en UTC puro: sin saltos por zona horaria. */
export function generarRangoFechas(desde: string, hasta: string): string[] {
  if (!esFechaIso(desde))
    throw new Error(`Fecha "desde" inválida: "${desde}" (se espera YYYY-MM-DD)`);
  if (!esFechaIso(hasta))
    throw new Error(`Fecha "hasta" inválida: "${hasta}" (se espera YYYY-MM-DD)`);
  if (desde > hasta) throw new Error(`"desde" (${desde}) es posterior a "hasta" (${hasta})`);
  const fechas: string[] = [];
  const fin = Date.parse(`${hasta}T00:00:00.000Z`);
  for (let t = Date.parse(`${desde}T00:00:00.000Z`); t <= fin; t += 86_400_000) {
    fechas.push(new Date(t).toISOString().slice(0, 10));
  }
  return fechas;
}

/** `https://host` -> `https://host/v1`; no duplica `/v1` si ya viene. */
export function normalizarBaseUrl(url: string): string {
  const sinBarraFinal = url.replace(/\/+$/, '');
  return sinBarraFinal.endsWith('/v1') ? sinBarraFinal : `${sinBarraFinal}/v1`;
}

/** Subconjunto de `Asignacion` (@quivo/shared) que usa el script. `fecha` llega de la API como
 * ISO datetime (medianoche UTC de la fecha calendario). */
export interface AsignacionApi {
  id: string;
  vehiculoId: string;
  conductorId: string | null;
  rutaId: string;
  fecha: string;
  horario: string;
  orden: number;
  estado: string;
}

export interface ParVehiculo {
  vehiculoId: string;
  conductorId: string;
  rutaId: string;
  /** Fecha de la asignación de la que se derivó el par (la más reciente con conductor). */
  fechaReferencia: string;
}

export function fechaDeAsignacion(a: { fecha: string }): string {
  return a.fecha.slice(0, 10);
}

/** Par vehículo -> (conductor, ruta) derivado de la asignación MÁS RECIENTE de ese vehículo
 * en `horario` que tenga conductor. Vehículos sin ninguna asignación con conductor no entran. */
export function derivarPares(asignaciones: AsignacionApi[], horario: string): ParVehiculo[] {
  const porVehiculo = new Map<string, ParVehiculo>();
  for (const a of asignaciones) {
    if (a.horario !== horario || !a.conductorId) continue;
    const fecha = fechaDeAsignacion(a);
    const previo = porVehiculo.get(a.vehiculoId);
    if (!previo || fecha > previo.fechaReferencia) {
      porVehiculo.set(a.vehiculoId, {
        vehiculoId: a.vehiculoId,
        conductorId: a.conductorId,
        rutaId: a.rutaId,
        fechaReferencia: fecha,
      });
    }
  }
  return [...porVehiculo.values()].sort((x, y) => x.vehiculoId.localeCompare(y.vehiculoId));
}

export interface Faltante {
  vehiculoId: string;
  conductorId: string;
  rutaId: string;
  fecha: string;
}

export function claveAsignacion(vehiculoId: string, fecha: string, horario: string): string {
  return `${vehiculoId}|${fecha}|${horario}`;
}

/** Diff de faltantes: para cada par y cada fecha del rango sin asignación en `horario`
 * (cualquier estado, cualquier conductor: la unicidad del servidor es por
 * vehículo+fecha+horario) devuelve lo que hay que crear. Orden estable: vehículo, fecha. */
export function calcularFaltantes(
  pares: ParVehiculo[],
  existentes: AsignacionApi[],
  fechas: string[],
  horario: string,
): Faltante[] {
  const ocupadas = new Set(
    existentes.map((a) => claveAsignacion(a.vehiculoId, fechaDeAsignacion(a), a.horario)),
  );
  const faltantes: Faltante[] = [];
  for (const par of pares) {
    for (const fecha of fechas) {
      if (ocupadas.has(claveAsignacion(par.vehiculoId, fecha, horario))) continue;
      faltantes.push({
        vehiculoId: par.vehiculoId,
        conductorId: par.conductorId,
        rutaId: par.rutaId,
        fecha,
      });
    }
  }
  return faltantes;
}

export interface CoberturaVehiculo {
  vehiculoId: string;
  /** Fechas del rango sin asignación `horario` (o sin vigente cuando fecha >= hoy). */
  sinCubrir: string[];
  /** Fechas del rango cuya asignación tiene otro conductor que el esperado. */
  conductorDistinto: string[];
  vigentes: number;
}

/** Verificación de lectura: por vehículo, qué fechas del rango quedaron sin una asignación que
 * permita loguearse. Para fechas >= `hoy` se exige `estado === 'vigente'` y el conductor
 * esperado (la auth móvil Nivel 1 filtra por `estado: 'vigente'` y fecha de hoy). Las fechas
 * pasadas del rango solo requieren existir (el job de vencimiento las marca `vencida`). */
export function verificarCobertura(
  pares: ParVehiculo[],
  asignaciones: AsignacionApi[],
  fechas: string[],
  horario: string,
  hoy: string,
): CoberturaVehiculo[] {
  const porClave = new Map<string, AsignacionApi>();
  for (const a of asignaciones) {
    if (a.horario !== horario) continue;
    porClave.set(claveAsignacion(a.vehiculoId, fechaDeAsignacion(a), a.horario), a);
  }
  return pares.map((par) => {
    const sinCubrir: string[] = [];
    const conductorDistinto: string[] = [];
    let vigentes = 0;
    for (const fecha of fechas) {
      const a = porClave.get(claveAsignacion(par.vehiculoId, fecha, horario));
      if (!a) {
        sinCubrir.push(fecha);
        continue;
      }
      if (a.estado === 'vigente') vigentes++;
      if (fecha < hoy) continue; // histórico: solo importa que exista
      if (a.estado !== 'vigente') sinCubrir.push(fecha);
      else if (a.conductorId !== par.conductorId) conductorDistinto.push(fecha);
    }
    return { vehiculoId: par.vehiculoId, sinCubrir, conductorDistinto, vigentes };
  });
}

/** Renueva la sesión: primero `refrescar` (refresh token); si devuelve false o lanza, cae a
 * `loguear` (re-login con las credenciales de env). Si `loguear` lanza, propaga. */
export async function renovarSesion(deps: {
  refrescar: () => Promise<boolean>;
  loguear: () => Promise<void>;
}): Promise<void> {
  let ok = false;
  try {
    ok = await deps.refrescar();
  } catch {
    ok = false;
  }
  if (!ok) await deps.loguear();
}

/** Ejecuta `hacer`; si responde 401, renueva la sesión y reintenta UNA sola vez con el token
 * nuevo (el JWT de acceso dura ~15 min y un run largo lo supera). Devuelve la última respuesta. */
export async function ejecutarConReautenticacion<R extends { status: number }>(
  hacer: () => Promise<R>,
  renovar: () => Promise<void>,
): Promise<R> {
  const primera = await hacer();
  if (primera.status !== 401) return primera;
  await renovar();
  return hacer();
}

/** Normaliza una placa para comparar (mayúsculas, sin espacios/guiones). */
export function normalizarPlaca(placa: string): string {
  return placa
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Parsea `--placas 9001TST,9004TST` -> ['9001TST','9004TST'] (sin vacíos ni duplicados). */
export function parsearPlacas(valor: string): string[] {
  return [
    ...new Set(
      valor
        .split(',')
        .map(normalizarPlaca)
        .filter((p) => p.length > 0),
    ),
  ];
}

/** Limita los pares a las `placas` pedidas. Lanza si alguna placa no corresponde a un vehículo
 * con asignación y conductor en la rotación (no adivina). `placaPorVehiculoId`: id -> placa. */
export function filtrarParesPorPlacas(
  pares: ParVehiculo[],
  placaPorVehiculoId: Map<string, string>,
  placas: string[],
): ParVehiculo[] {
  const pedidas = new Set(placas.map(normalizarPlaca));
  const seleccionados = pares.filter((p) => {
    const placa = placaPorVehiculoId.get(p.vehiculoId);
    return placa !== undefined && pedidas.has(normalizarPlaca(placa));
  });
  const halladas = new Set(
    seleccionados.map((p) => normalizarPlaca(placaPorVehiculoId.get(p.vehiculoId)!)),
  );
  const faltan = [...pedidas].filter((p) => !halladas.has(p));
  if (faltan.length > 0) {
    throw new Error(`Placa(s) sin asignación con conductor en la rotación: ${faltan.join(', ')}`);
  }
  return seleccionados;
}
