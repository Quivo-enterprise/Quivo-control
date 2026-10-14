import { abrirPaqueteDiaDb } from './paquete-dia';
import { VueltaActualMovilSchema } from '@quivo/shared';
import {
  ESTADO_LOCAL_INICIAL,
  designacionVigente,
  resolverEstadoParaRecorrido,
  type EstadoLocalVuelta,
} from '../features/vuelta-actual/vuelta-actual-core';
import { leerRecorridoActual } from './recorrido-actual';

/**
 * Estado local de la vuelta actual / avisos de designación, por sesión, en la MISMA SQLite del
 * paquete del día (`quivo-paquete-dia.db`): sobrevive al reinicio de la app y lo leen por igual
 * el foreground y el headless. Una fila por `sesion_id`; se limpian las de otras sesiones al
 * escribir (el chofer solo tiene una sesión operativa a la vez). La tabla se crea al abrir la DB
 * del paquete (`abrirPaqueteDiaDbNueva` en `paquete-dia.ts`), junto a `paquete_dia`.
 */
/** Interpreta el JSON persistido; ante corrupción o forma inesperada devuelve el estado inicial
 * (peor caso se vuelve a avisar una vez, nunca se tumba la pantalla). Exportada para tests. */
export function interpretarEstadoLocal(crudo: string | null | undefined): EstadoLocalVuelta {
  if (!crudo) return ESTADO_LOCAL_INICIAL;
  try {
    const o = JSON.parse(crudo) as Partial<EstadoLocalVuelta>;
    const ultimo = VueltaActualMovilSchema.safeParse(o.ultimo);
    const lista = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const intentos: Record<string, number> = {};
    if (o.intentosAnuncio && typeof o.intentosAnuncio === 'object') {
      for (const [k, v] of Object.entries(o.intentosAnuncio)) {
        if (typeof v === 'number' && Number.isFinite(v)) intentos[k] = v;
      }
    }
    return {
      ultimo: ultimo.success ? ultimo.data : null,
      anunciadas: lista(o.anunciadas),
      cerradas: lista(o.cerradas),
      cancelacionPendiente: typeof o.cancelacionPendiente === 'string' ? o.cancelacionPendiente : null,
      actualizadoEn:
        typeof o.actualizadoEn === 'number' && Number.isFinite(o.actualizadoEn) ? o.actualizadoEn : null,
      intentosAnuncio: intentos,
      acusesAbandonados: lista(o.acusesAbandonados),
      recorridoId: typeof o.recorridoId === 'string' ? o.recorridoId : null,
    };
  } catch {
    return ESTADO_LOCAL_INICIAL;
  }
}

export async function leerEstadoVueltaLocal(sesionId: string): Promise<EstadoLocalVuelta> {
  const db = await abrirPaqueteDiaDb();
  const fila = await db.getFirstAsync<{ estado: string }>(
    'SELECT estado FROM vuelta_actual_local WHERE sesion_id = ?',
    [sesionId],
  );
  return interpretarEstadoLocal(fila?.estado);
}

export async function guardarEstadoVueltaLocal(
  sesionId: string,
  estado: EstadoLocalVuelta,
): Promise<void> {
  const db = await abrirPaqueteDiaDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO vuelta_actual_local (sesion_id, estado, actualizado_en) VALUES (?, ?, ?)',
    [sesionId, JSON.stringify(estado), new Date().toISOString()],
  );
  await db.runAsync('DELETE FROM vuelta_actual_local WHERE sesion_id <> ?', [sesionId]);
}

/** Borra la fila de la sesión (fin del recorrido). */
export async function borrarEstadoVueltaLocal(sesionId: string): Promise<void> {
  const db = await abrirPaqueteDiaDb();
  await db.runAsync('DELETE FROM vuelta_actual_local WHERE sesion_id = ?', [sesionId]);
}

/** Borra las filas de las demás sesiones (cache que sobrevivió a un cambio de sesión sin escrituras). */
export async function borrarEstadosVueltaLocalDeOtrasSesiones(sesionId: string): Promise<void> {
  const db = await abrirPaqueteDiaDb();
  await db.runAsync('DELETE FROM vuelta_actual_local WHERE sesion_id <> ?', [sesionId]);
}

/**
 * Estado del cache para el recorrido ACTIVO, de SOLO LECTURA (no escribe ni borra nada: el
 * reemplazo del cache de otro recorrido ocurre únicamente dentro de la cola `serializar` de
 * `vuelta-actual-oportunista.ts`). Con la fila de otro recorrido, o sin recorrido, devuelve un
 * estado vacío (`resolverEstadoParaRecorrido`). Si el registro del recorrido no se pudo leer
 * (`ok: false`) devuelve `null`: no se sabe de qué recorrido es el cache, así que no se usa (el
 * llamador conserva su estado en memoria).
 */
export async function leerEstadoVueltaVigente(sesionId: string): Promise<EstadoLocalVuelta | null> {
  const recorrido = await leerRecorridoActual(sesionId);
  if (!recorrido.ok) return null;
  const crudo = await leerEstadoVueltaLocal(sesionId);
  return resolverEstadoParaRecorrido(crudo, recorrido.recorridoId);
}

/** Designación del cache local de la sesión PARA EL RECORRIDO ACTIVO, en la forma mínima que usa el
 * orden de los PC (`ordenEfectivoPuntos`). Para contextos sin React (store de vueltas, voz,
 * headless). Solo lectura. `null` si no hay recorrido activo ni cache/designación, si el registro
 * del recorrido no se pudo leer (`ok: false`: el cache puede ser de otro recorrido) o si la lectura
 * falla (best-effort: sin designación = ruta base). */
export async function leerDesignacionOrdenLocal(
  sesionId: string,
): Promise<{ puntoEspera: { id: string } } | null> {
  try {
    const estado = await leerEstadoVueltaVigente(sesionId);
    const d = estado ? designacionVigente(estado) : null;
    return d ? { puntoEspera: { id: d.puntoEspera.id } } : null;
  } catch {
    return null;
  }
}
