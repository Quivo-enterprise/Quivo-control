import * as Sentry from '@sentry/react-native';
import type * as SQLite from 'expo-sqlite';
import { conReintentoSiHandleMuerto } from '../../db/outbox';
import { estadoInicialVuelta, pasoPunto, type EstadoProgresoVuelta } from './progreso-vuelta';

/**
 * Almacén del progreso de la vuelta (RF-GPS-054) sobre la MISMA SQLite del outbox
 * (`quivo-outbox.db`, tabla `progreso_vuelta`): ya es el almacén compartido entre el contexto de
 * foreground y el headless, y la lectura-modificación-escritura corre dentro de una transacción
 * (AsyncStorage no ofrece nada atómico entre contextos JS). Sin React: lo llaman por igual
 * `registrarPuntoGpsInterno` y `aplicarConfirmacionesForzadas` (`gps/headless-task.ts`), que son el
 * ÚNICO escritor — la UI solo lee (`use-progreso-vuelta.ts`).
 *
 * Es best-effort: el progreso es informativo para el chofer, la evidencia legal es el outbox. Un
 * fallo acá se reporta pero NUNCA debe tumbar el registro del cumplimiento.
 */

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

function parsear(sesionId: string, json: string | undefined): EstadoProgresoVuelta {
  if (!json) return estadoInicialVuelta(sesionId);
  try {
    const crudo = JSON.parse(json) as Partial<EstadoProgresoVuelta>;
    if (crudo.sesionId !== sesionId || !Array.isArray(crudo.pasados)) {
      return estadoInicialVuelta(sesionId);
    }
    return { ...estadoInicialVuelta(sesionId), ...crudo };
  } catch {
    return estadoInicialVuelta(sesionId);
  }
}

/** Estado persistido de la sesión; uno nuevo y vacío si no hay (sesión nueva = vuelta desde 0). */
export async function leerProgresoVuelta(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
): Promise<EstadoProgresoVuelta> {
  const fila = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.getFirstAsync<{ estado_json: string }>(
      'SELECT estado_json FROM progreso_vuelta WHERE sesion_id = ?',
      [sesionId],
    ),
  );
  return parsear(sesionId, fila?.estado_json);
}

// Cadena de promesas: serializa las escrituras de ESTE contexto JS (varios pasos del mismo tick).
// Entre contextos (headless vs foreground) la atomicidad la da la transacción de SQLite.
let cola: Promise<unknown> = Promise.resolve();

/**
 * Registra el paso por un punto en la vuelta de la sesión. Idempotente por `clave` (ver
 * `pasoPunto`). Nunca rechaza.
 */
export function registrarPasoEnVuelta(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  puntoId: string,
  clave: string,
  totalPuntos: number,
): Promise<void> {
  const operacion = cola.then(async () => {
    const nuevo = await conReintentoSiHandleMuerto(db, async (dbActiva) => {
      let resultado = estadoInicialVuelta(sesionId);
      await dbActiva.withTransactionAsync(async () => {
        const fila = await dbActiva.getFirstAsync<{ estado_json: string }>(
          'SELECT estado_json FROM progreso_vuelta WHERE sesion_id = ?',
          [sesionId],
        );
        resultado = pasoPunto(parsear(sesionId, fila?.estado_json), { puntoId, clave }, totalPuntos);
        await dbActiva.runAsync(
          `INSERT INTO progreso_vuelta (sesion_id, estado_json, actualizado_ts) VALUES (?, ?, ?)
           ON CONFLICT(sesion_id) DO UPDATE SET
             estado_json = excluded.estado_json,
             actualizado_ts = excluded.actualizado_ts`,
          [sesionId, JSON.stringify(resultado), new Date().toISOString()],
        );
        // Una sola sesión activa a la vez: las filas de sesiones viejas no se vuelven a leer.
        await dbActiva.runAsync('DELETE FROM progreso_vuelta WHERE sesion_id != ?', [sesionId]);
      });
      return resultado;
    });
    for (const oyente of oyentes) oyente(nuevo);
  });
  const segura = operacion.catch((error: unknown) => {
    console.error('[QUIVO][vuelta] No se pudo registrar el paso en el progreso de la vuelta', error);
    Sentry.captureException(error, {
      tags: { contexto: 'progreso-vuelta', paso: 'registrar-paso' },
      extra: { sesionId, puntoId },
    });
  });
  cola = segura;
  return segura;
}
