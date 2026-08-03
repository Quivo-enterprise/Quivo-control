import { useCallback, useEffect, useRef, useState } from 'react';
import { abrirOutbox, contarEventosPendientes } from '../../db/outbox';
import { iniciarSyncAutomatico, sincronizarPendientes, type ResultadoSync } from './sync-outbox';

const REFRESCO_MS = 15_000;

export interface EstadoSyncStatus {
  pendientes: number;
  errorSync: string | null;
}

/**
 * Estado de conexión/sync para la pantalla de operación (QUI-240/243) — pendientes en el
 * outbox local (QUI-238) y disparo del sync automático al detectar conexión.
 *
 * Bug real encontrado probando en un dispositivo real (Moto E13): `iniciarSyncAutomatico`
 * se registraba ANTES de que el token (async, `obtenerAccessToken`) terminara de resolverse
 * — el primer disparo del listener de NetInfo (que llega ni bien se suscribe, con el estado
 * de red YA conectado) encontraba el token todavía en `null` y no hacía nada; como el
 * teléfono seguía conectado todo el tiempo, nunca volvía a haber un evento de "reconexión"
 * que reintentara. Fix: esperar a que el token esté listo antes de suscribirse al listener.
 * Además, el intervalo de refresco ahora también intenta sincronizar directamente (no solo
 * releer el contador) como red de seguridad — NetInfo puede comportarse distinto entre
 * fabricantes, sobre todo en los dispositivos de gama baja a los que apunta esta app.
 */
export function useSyncStatus(obtenerAccessToken: () => Promise<string | null>): EstadoSyncStatus {
  const [pendientes, setPendientes] = useState(0);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const actualizarPendientes = useCallback(async () => {
    const db = await abrirOutbox();
    setPendientes(await contarEventosPendientes(db));
  }, []);

  useEffect(() => {
    let activo = true;
    let detenerSync = () => {};

    const releerToken = async () => {
      const token = await obtenerAccessToken();
      if (activo) tokenRef.current = token;
      return token;
    };

    const iniciar = async () => {
      await releerToken();
      await actualizarPendientes();
      if (!activo) return;
      detenerSync = iniciarSyncAutomatico(
        () => tokenRef.current,
        (resultado: ResultadoSync) => {
          if (!activo) return;
          setErrorSync('error' in resultado ? resultado.error : null);
          void actualizarPendientes();
        },
      );
    };
    void iniciar();

    const intervalo = setInterval(() => {
      void (async () => {
        const token = await releerToken();
        if (token) {
          try {
            await sincronizarPendientes(token);
            setErrorSync(null);
          } catch (error) {
            setErrorSync(error instanceof Error ? error.message : 'Error de sincronización');
          }
        }
        await actualizarPendientes();
      })();
    }, REFRESCO_MS);

    return () => {
      activo = false;
      detenerSync();
      clearInterval(intervalo);
    };
  }, [obtenerAccessToken, actualizarPendientes]);

  return { pendientes, errorSync };
}
