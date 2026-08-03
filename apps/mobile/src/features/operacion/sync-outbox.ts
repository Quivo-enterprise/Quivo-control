import NetInfo from '@react-native-community/netinfo';
import type { EventoSync } from '@quivo/shared';
import {
  abrirOutbox,
  marcarAcusados,
  marcarEnviados,
  obtenerLotePendiente,
  revertirAPendiente,
} from '../../db/outbox';
import { ApiError } from '../../shared/api/http-client';
import { syncApi } from '../../shared/api/sync-api';
import { idsNoAcusados } from './sync-diff';

const LOTE_MAXIMO = 500;
const BACKOFF_INICIAL_MS = 2_000;
const BACKOFF_MAXIMO_MS = 60_000;

export { idsNoAcusados };

/** Un ciclo de sync: toma hasta `LOTE_MAXIMO` eventos pendientes, los manda, y marca según
 * el acuse del servidor — el cliente SOLO da por sincronizado lo que vino acusado (QUI-238). */
export async function sincronizarPendientes(accessToken: string): Promise<{ enviados: number }> {
  const db = await abrirOutbox();
  const lote = await obtenerLotePendiente(db, LOTE_MAXIMO);
  if (lote.length === 0) {
    return { enviados: 0 };
  }

  const eventIds = lote.map((evento) => evento.eventId);
  await marcarEnviados(db, eventIds);
  try {
    const eventos: EventoSync[] = lote.map((evento) => ({
      eventId: evento.eventId,
      deviceId: evento.deviceId,
      ts: evento.ts,
      tipo: evento.tipo,
      payload: evento.payload,
    }));
    const respuesta = await syncApi.enviarLote(eventos, accessToken);
    await marcarAcusados(db, respuesta.aceptados);
    await revertirAPendiente(db, idsNoAcusados(eventIds, respuesta.aceptados));
    return { enviados: respuesta.aceptados.length };
  } catch (error) {
    // Fallo de red/servidor: todo el lote vuelve a pendiente para el próximo intento.
    await revertirAPendiente(db, eventIds);
    throw error instanceof ApiError
      ? error
      : new ApiError('network', 'Error de red al sincronizar');
  }
}

export type ResultadoSync = { enviados: number } | { error: string };

/**
 * Dispara `sincronizarPendientes` al detectar conexión y reintenta con backoff exponencial
 * ante fallos (RNF-36) — devuelve una función para des-suscribirse (llamarla al desmontar
 * la pantalla que lo use, QUI-243).
 */
export function iniciarSyncAutomatico(
  obtenerAccessToken: () => string | null,
  onResultado?: (resultado: ResultadoSync) => void,
): () => void {
  let backoffMs = BACKOFF_INICIAL_MS;
  let detenido = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const intentarSync = async (): Promise<void> => {
    if (detenido) return;
    const accessToken = obtenerAccessToken();
    if (!accessToken) return;

    try {
      const resultado = await sincronizarPendientes(accessToken);
      backoffMs = BACKOFF_INICIAL_MS;
      onResultado?.(resultado);
      if (resultado.enviados > 0) {
        // Puede haber más pendientes que el límite de un lote — seguir de inmediato.
        timeoutId = setTimeout(() => void intentarSync(), 500);
      }
    } catch (error) {
      onResultado?.({ error: error instanceof Error ? error.message : 'Error de sincronización' });
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAXIMO_MS);
      timeoutId = setTimeout(() => void intentarSync(), backoffMs);
    }
  };

  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void intentarSync();
    }
  });

  return () => {
    detenido = true;
    if (timeoutId) clearTimeout(timeoutId);
    unsubscribe();
  };
}
