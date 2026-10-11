import { fechaActualBolivia, inicioDeJornadaSiguienteBolivia } from '@quivo/shared';

/** Clave única (namespaced) bajo la que se guarda la declaración de jornada. */
export const JORNADA_STORAGE_KEY = 'quivo.mobile.jornada.v1';

export interface DeclaracionJornada {
  vehiculoId: string;
  conductorId: string;
  /** Sesión móvil que declaró: una sesión nueva el mismo día envía su propio `inicio_jornada`. */
  sesionId: string;
  /** Día calendario de Bolivia (`YYYY-MM-DD`) de la declaración. */
  jornada: string;
  /** Instante ISO de la declaración. */
  ts: string;
}

export interface IdentidadJornada {
  vehiculoId: string;
  conductorId: string;
  sesionId: string;
}

/** Subconjunto de AsyncStorage que usa el store (inyectable para tests). */
export interface AlmacenClaveValor {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Día calendario de Bolivia (`YYYY-MM-DD`) — nunca `toDateString()` (zona del dispositivo). */
export function diaBolivia(ahora: Date = new Date()): string {
  return fechaActualBolivia(ahora).toISOString().slice(0, 10);
}

/** Milisegundos hasta la próxima medianoche de Bolivia (siempre > 0). */
export function msHastaMedianoche(ahora: Date = new Date()): number {
  const siguiente = inicioDeJornadaSiguienteBolivia(fechaActualBolivia(ahora));
  return siguiente.getTime() - ahora.getTime();
}

/** Subtítulo de la fase `jornada`; el conteo se omite si aún no hay puntos (paquete cargando). */
export function subtituloJornada(linea: string, totalPuntos: number): string {
  if (totalPuntos <= 0) return `Línea ${linea}`;
  const puntos = totalPuntos === 1 ? '1 punto de control' : `${totalPuntos} puntos de control`;
  return `Línea ${linea}, ${puntos}`;
}

/** Parsea lo guardado; cualquier forma inesperada se trata como "sin declaración". */
export function parsearDeclaracion(raw: string | null): DeclaracionJornada | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (
      typeof o.vehiculoId !== 'string' ||
      typeof o.conductorId !== 'string' ||
      typeof o.sesionId !== 'string' ||
      typeof o.jornada !== 'string' ||
      typeof o.ts !== 'string'
    ) {
      return null;
    }
    return {
      vehiculoId: o.vehiculoId,
      conductorId: o.conductorId,
      sesionId: o.sesionId,
      jornada: o.jornada,
      ts: o.ts,
    };
  } catch {
    return null;
  }
}

/** `true` solo si la declaración es de esta sesión + vehículo + conductor + día de Bolivia. */
export function declaracionVigente(
  declaracion: DeclaracionJornada | null,
  identidad: IdentidadJornada,
  hoy: string,
): declaracion is DeclaracionJornada {
  return (
    declaracion !== null &&
    declaracion.vehiculoId === identidad.vehiculoId &&
    declaracion.conductorId === identidad.conductorId &&
    declaracion.sesionId === identidad.sesionId &&
    declaracion.jornada === hoy
  );
}

export function crearDeclaracion(identidad: IdentidadJornada, ahora: Date): DeclaracionJornada {
  return {
    vehiculoId: identidad.vehiculoId,
    conductorId: identidad.conductorId,
    sesionId: identidad.sesionId,
    jornada: diaBolivia(ahora),
    ts: ahora.toISOString(),
  };
}

/** Lee la declaración de hoy; un fallo de almacenamiento equivale a "no iniciada". */
export async function leerJornadaEn(
  almacen: AlmacenClaveValor,
  identidad: IdentidadJornada,
  ahora: Date = new Date(),
): Promise<DeclaracionJornada | null> {
  try {
    const declaracion = parsearDeclaracion(await almacen.getItem(JORNADA_STORAGE_KEY));
    return declaracionVigente(declaracion, identidad, diaBolivia(ahora)) ? declaracion : null;
  } catch {
    return null;
  }
}

/** Persiste la declaración. Devuelve `false` si el almacenamiento falló (nunca lanza). */
export async function guardarJornadaEn(
  almacen: AlmacenClaveValor,
  declaracion: DeclaracionJornada,
): Promise<boolean> {
  try {
    await almacen.setItem(JORNADA_STORAGE_KEY, JSON.stringify(declaracion));
    return true;
  } catch {
    return false;
  }
}
