import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import { distanciaAPolilineaM, type PuntoControlPaquete } from '@quivo/shared';
import { conReintentoSiHandleMuerto } from '../../db/outbox';
import { leerDesignacionOrdenLocal } from '../../db/vuelta-actual-local';
import {
  evaluarFixFase,
  faseDe,
  mitadesDelCircuito,
  puntoRetorno,
  puntosDeFase,
} from './fase-vuelta';
import {
  claveProgresoVuelta,
  estadoInicialVuelta,
  fechaLocal,
  ordenEfectivoPuntos,
  pasoPunto,
  puntoTerminal,
  reiniciarVuelta,
  separarClaveProgreso,
  type EstadoProgresoVuelta,
} from './progreso-vuelta';

/**
 * Almacén del progreso de la vuelta (RF-GPS-054) sobre la MISMA SQLite del outbox
 * (`quivo-outbox.db`, tabla `progreso_vuelta`, una fila por `sesionId:fechaLocal`): ya es el
 * almacén compartido entre el contexto de foreground y el headless. Sin React: lo llaman por igual
 * `registrarPuntoGpsInterno` y `aplicarConfirmacionesForzadas` (`gps/headless-task.ts`), que son el
 * ÚNICO escritor de pasos — la UI solo lee (`use-progreso-vuelta.ts`).
 *
 * Atomicidad entre contextos SIN transacciones: la lectura-modificación-escritura usa control de
 * concurrencia optimista sobre la columna `version` (UPSERT condicional `WHERE version = ?`,
 * reintento si otro contexto escribió en medio). No se usa `withTransactionAsync` (no es
 * exclusivo en una conexión compartida: choca con las transacciones del outbox o barre otras
 * sentencias) ni `withExclusiveTransactionAsync` (abre otra conexión sin `busy_timeout`: un
 * `SQLITE_BUSY` podría caer sobre una escritura de evidencia del outbox).
 *
 * Es best-effort: el progreso es informativo para el chofer, la evidencia legal es el outbox. Un
 * fallo acá se reporta pero NUNCA debe tumbar el registro del cumplimiento.
 */

/** Filas sin actualizarse en este lapso se descartan (limpieza al escribir). */
const RETENCION_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_INTENTOS_CAS = 5;

type Oyente = (estado: EstadoProgresoVuelta) => void;
const oyentes = new Set<Oyente>();

/** Suscripción en-proceso a los cambios que este mismo contexto JS escribe (foreground): evita
 * esperar un re-lectura de disco para refrescar la UI. Devuelve la función de baja. */
export function suscribirProgresoVuelta(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

interface FilaProgreso {
  estado_json: string;
  version: number;
}

function parsear(
  sesionId: string,
  fecha: string,
  fila: FilaProgreso | null | undefined,
): EstadoProgresoVuelta {
  const inicial = estadoInicialVuelta(sesionId, fecha);
  if (!fila) return inicial;
  try {
    const crudo = JSON.parse(fila.estado_json) as Partial<EstadoProgresoVuelta>;
    if (!Array.isArray(crudo.pasados)) return { ...inicial, version: fila.version };
    return { ...inicial, ...crudo, sesionId, fecha, version: fila.version };
  } catch {
    return { ...inicial, version: fila.version };
  }
}

const SQL_LEER = 'SELECT estado_json, version FROM progreso_vuelta WHERE clave = ?';

/** Estado persistido de la sesión en el día local `fecha`; uno nuevo y vacío si no hay. */
export async function leerProgresoVuelta(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  fecha: string = fechaLocal(),
): Promise<EstadoProgresoVuelta> {
  return conReintentoSiHandleMuerto(db, async (dbActiva) => {
    const fila = await dbActiva.getFirstAsync<FilaProgreso>(SQL_LEER, [claveProgresoVuelta(sesionId, fecha)]);
    return conFaseHeredada(dbActiva, sesionId, fecha, parsear(sesionId, fecha, fila), !!fila);
  });
}

// Cadena de promesas: serializa las escrituras de ESTE contexto JS (varios pasos del mismo tick).
// Entre contextos (headless vs foreground) la atomicidad la da el CAS por `version`.
let cola: Promise<unknown> = Promise.resolve();

/**
 * Lectura-modificación-escritura optimista de la fila `clave`. `aplicar` devuelve el estado nuevo
 * o el MISMO objeto recibido si no hay nada que escribir. Devuelve el estado escrito, o `null`
 * si no hubo escritura.
 */
/** Día local anterior a `fecha` (`YYYY-MM-DD`). */
function fechaAnterior(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return fechaLocal(new Date(a, m - 1, d - 1).getTime());
}

/**
 * Sin fila del día (p. ej. pasada la medianoche) la fase NO se reinicia: se hereda del día local
 * anterior de la misma sesión. Solo la fase y su contador; las vueltas son por día.
 */
async function conFaseHeredada(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  fecha: string,
  actual: EstadoProgresoVuelta,
  hayFila: boolean,
): Promise<EstadoProgresoVuelta> {
  if (hayFila) return actual;
  const anterior = parsear(
    sesionId,
    fecha,
    await db.getFirstAsync<FilaProgreso>(SQL_LEER, [claveProgresoVuelta(sesionId, fechaAnterior(fecha))]),
  );
  return anterior.fase ? { ...actual, fase: anterior.fase, fixesRegreso: anterior.fixesRegreso } : actual;
}

async function modificar(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  fecha: string,
  aplicar: (actual: EstadoProgresoVuelta) => EstadoProgresoVuelta,
): Promise<EstadoProgresoVuelta | null> {
  const clave = claveProgresoVuelta(sesionId, fecha);
  return conReintentoSiHandleMuerto(db, async (dbActiva) => {
    for (let intento = 0; intento < MAX_INTENTOS_CAS; intento++) {
      const fila = await dbActiva.getFirstAsync<FilaProgreso>(SQL_LEER, [clave]);
      const actual = await conFaseHeredada(dbActiva, sesionId, fecha, parsear(sesionId, fecha, fila), !!fila);
      const calculado = aplicar(actual);
      if (calculado === actual) return null;
      const nuevo: EstadoProgresoVuelta = { ...calculado, version: actual.version + 1 };
      const ahoraMs = Date.now();
      const json = JSON.stringify(nuevo);
      const resultado = fila
        ? await dbActiva.runAsync(
            'UPDATE progreso_vuelta SET estado_json = ?, version = ?, actualizado_ms = ? WHERE clave = ? AND version = ?',
            [json, nuevo.version, ahoraMs, clave, actual.version],
          )
        : await dbActiva.runAsync(
            'INSERT OR IGNORE INTO progreso_vuelta (clave, estado_json, version, actualizado_ms) VALUES (?, ?, ?, ?)',
            [clave, json, nuevo.version, ahoraMs],
          );
      if (resultado.changes === 1) {
        // Limpieza: filas que no se tocan hace más de 3 días no se vuelven a leer.
        await dbActiva.runAsync('DELETE FROM progreso_vuelta WHERE actualizado_ms < ?', [
          ahoraMs - RETENCION_MS,
        ]);
        return nuevo;
      }
      // Otro contexto (headless/foreground) escribió en medio: releer y reaplicar.
    }
    throw new Error('progreso_vuelta: conflicto de escritura persistente (CAS agotado)');
  });
}

type AplicarProgreso = (actual: EstadoProgresoVuelta) => EstadoProgresoVuelta;

function encolar(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  fecha: string,
  obtenerAplicar: () => AplicarProgreso | Promise<AplicarProgreso>,
  contextoError: { paso: string; extra: Record<string, unknown> },
): Promise<void> {
  const operacion = cola.then(async () => {
    // `obtenerAplicar` corre DENTRO de la cola: lo que lea (p. ej. la designación) no queda
    // desfasado respecto de las escrituras anteriores encoladas.
    const aplicar = await obtenerAplicar();
    const nuevo = await modificar(db, sesionId, fecha, aplicar);
    if (nuevo) for (const oyente of oyentes) oyente(nuevo);
  });
  const segura = operacion.catch((error: unknown) => {
    console.error('[QUIVO][vuelta] No se pudo actualizar el progreso de la vuelta', error);
    Sentry.captureException(error, {
      tags: { contexto: 'progreso-vuelta', paso: contextoError.paso },
      extra: { sesionId, fecha, ...contextoError.extra },
    });
  });
  cola = segura;
  return segura;
}

/**
 * Registra el paso por un punto en la vuelta del día local de la sesión. Idempotente por `clave`
 * (ver `pasoPunto`). `puntosControl` = paquete vigente: la vuelta se cuenta con el ORDEN EFECTIVO
 * (sin el PC de espera de Molinos salvo que haya una designación activa, que se lee del cache
 * SQLite de la vuelta actual — igual en foreground y headless), y un PC de espera nunca ancla la
 * vuelta. Nunca rechaza.
 */
export async function registrarPasoEnVuelta(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  puntoId: string,
  clave: string,
  puntosControl: readonly PuntoControlPaquete[],
): Promise<void> {
  await encolar(
    db,
    sesionId,
    fechaLocal(),
    async () => {
      const designacion = await leerDesignacionOrdenLocal(sesionId);
      const idsEfectivos = ordenEfectivoPuntos(puntosControl, designacion).map((p) => p.id);
      const idsEspera = puntosControl.filter((p) => p.rol === 'espera').map((p) => p.id);
      const roles = {
        retornoId: puntoRetorno(puntosControl)?.id ?? null,
        terminalId: puntoTerminal(puntosControl)?.id ?? null,
      };
      return (actual) => pasoPunto(actual, { puntoId, clave }, idsEfectivos, idsEspera, roles);
    },
    { paso: 'registrar-paso', extra: { puntoId } },
  );
}

/**
 * Arranca un recorrido: la vuelta en curso de `clave` (`sesionId:fecha`) empieza de cero y se
 * conserva el conteo de vueltas del día. Con `anclaTerminalId` la vuelta nace anclada en la terminal.
 * Sin fila previa y sin ancla no escribe nada. Nunca rechaza.
 */
export function reiniciarVueltaEnCurso(
  db: SQLite.SQLiteDatabase,
  clave: string,
  anclaTerminalId: string | null = null,
): Promise<void> {
  const { sesionId, fecha } = separarClaveProgreso(clave);
  return encolar(db, sesionId, fecha, () => (actual) => reiniciarVuelta(actual, anclaTerminalId), {
    paso: 'reiniciar-vuelta',
    extra: {},
  });
}

/**
 * PC que se DETECTAN en este fix: los de la fase actual de la vuelta (`fase-vuelta.ts`). Es el
 * único punto donde foreground y headless deciden la fase, leyéndola del mismo progreso persistido
 * que escribe `registrarPasoEnVuelta`. Sin PC `retorno` devuelve `puntosControl` tal cual (misma
 * referencia, sin I/O: líneas 120/Z12 intactas). Además corre el fallback por geometría (el GPS
 * pudo no capturar el retorno): persiste el contador solo cuando cambia. Best-effort: ante un
 * fallo de lectura/escritura propaga el error y el llamador cae a todos los PC.
 */
export async function puntosDeLaFaseActual(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  puntosControl: PuntoControlPaquete[],
  geometriaRuta: [number, number][] | undefined,
  fix: { lng: number; lat: number; accuracy?: number | null },
): Promise<PuntoControlPaquete[]> {
  if (!puntoRetorno(puntosControl)) return puntosControl;
  const estado = await leerProgresoVuelta(db, sesionId);
  let fase = faseDe(estado);
  const mitades = geometriaRuta ? mitadesDelCircuito(geometriaRuta, puntosControl) : null;
  if (mitades) {
    const posicion: [number, number] = [fix.lng, fix.lat];
    const dIda = distanciaAPolilineaM(posicion, mitades.ida);
    const dRegreso = distanciaAPolilineaM(posicion, mitades.regreso);
    const evaluado = evaluarFixFase(estado, dIda, dRegreso, fix.accuracy);
    if (evaluado !== estado) {
      fase = faseDe(evaluado);
      await encolar(
        db,
        sesionId,
        fechaLocal(),
        () => (actual) => evaluarFixFase(actual, dIda, dRegreso, fix.accuracy),
        { paso: 'fase-fallback', extra: {} },
      );
    }
  }
  return puntosDeFase(puntosControl, fase);
}
