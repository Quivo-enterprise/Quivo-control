import { useCallback, useEffect, useRef, useState } from 'react';
import { useNetInfo } from '@react-native-community/netinfo';
import { Vibration } from 'react-native';
import { abrirOutbox, contarEventosPendientes } from '../../db/outbox';
import { iniciarSyncAutomatico, sincronizarPendientes, type ResultadoSync } from './sync-outbox';

const REFRESCO_MS = 15_000;

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

/** A partir de cuántos fallos consecutivos de sincronización se considera "fallo definitivo"
 * (QUI-346) — distinto de "reintentando". `sync-outbox.ts` reintenta indefinidamente con
 * backoff hasta 60s y por diseño NUNCA se rinde (no queremos perder eventos), pero el
 * conductor necesita una señal distinta de "sigue reintentando en silencio" cuando ya
 * llevamos varios intentos fallidos seguidos. Exportado y puro para poder testear el umbral
 * sin levantar el hook completo — este paquete no tiene entorno de testing con DOM/hooks. */
export const UMBRAL_FALLO_DEFINITIVO = 3;
export function esFalloDefinitivo(fallosConsecutivos: number): boolean {
  return fallosConsecutivos >= UMBRAL_FALLO_DEFINITIVO;
}

/**
 * Pura y testeada aparte (`use-sync-status.test.ts`) — acá vivía el bug real (QUI-348 #1, el
 * que rompía QUI-261 entero). `isInternetReachable` queda en `null` mientras NetInfo todavía
 * no resuelve la conectividad real, que es el estado más común en Android de gama baja (el
 * target de este proyecto) apenas arranca la app o cambia de red. Con `&&` alcanzaba con que
 * CUALQUIERA de los dos todavía no fuera exactamente `false` para que `isOffline` quedara
 * pegado en `false` — típicamente `isConnected === false` pero `isInternetReachable === null`
 * (sin resolver): el banner offline nunca aparecía, el badge nunca decía "(local)" y el
 * intervalo seguía intentando sincronizar contra una red que no existe.
 * `isConnected === false` YA es una señal suficiente y confiable de que no hay conexión — no
 * hace falta esperar a que `isInternetReachable` también resuelva a `false`.
 */
export function calcularIsOffline(
  isConnected: boolean | null,
  isInternetReachable: boolean | null,
): boolean {
  return isConnected === false || isInternetReachable === false;
}

export interface EstadoSyncStatus {
  pendientes: number;
  errorSync: string | null;
  /** Distingue "llevamos varios intentos fallidos seguidos" (QUI-346) de un fallo aislado —
   * el motor de sync sigue reintentando en segundo plano; esto es solo una señal para la UI. */
  syncFalloDefinitivo: boolean;
  /** `null` = todavía no hubo ninguna sincronización exitosa en esta sesión de la pantalla. */
  ultimaSyncOk: Date | null;
  isOffline: boolean;
  isSyncing: boolean;
}

export interface UseSyncStatusOpciones {
  /** QUI-338 (c): flag de demo/QA para forzar un fallo de sincronización sin tener que
   * desconectar de verdad el dispositivo. Quien la pasa es responsable de gatearla detrás de
   * `__DEV__` (ver el botón de debug en `operation-screen.tsx`) — nunca debe quedar accesible
   * en el build de release. */
  simularFalloSync?: boolean;
}

export function useSyncStatus(
  obtenerAccessToken: () => Promise<string | null>,
  opciones?: UseSyncStatusOpciones,
): EstadoSyncStatus {
  const [pendientes, setPendientes] = useState(0);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const [syncFalloDefinitivo, setSyncFalloDefinitivo] = useState(false);
  const [ultimaSyncOk, setUltimaSyncOk] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const netInfo = useNetInfo();
  const isOffline = calcularIsOffline(netInfo.isConnected, netInfo.isInternetReachable);
  const tokenRef = useRef<string | null>(null);
  const simularFalloSync = opciones?.simularFalloSync ?? false;

  // El intervalo de sync de abajo necesita el valor MÁS RECIENTE de `isOffline` en cada tick,
  // pero sin que cada cambio de conectividad destruya y recree el motor de sync completo (el
  // resto de QUI-348 #1): `isOffline` vivía en las dependencias del efecto de sync, así que
  // cualquier parpadeo de red desmontaba `iniciarSyncAutomatico` y lo volvía a montar. Ahora
  // se lee por ref dentro del intervalo en vez de por closure/dependencia del efecto.
  const isOfflineRef = useRef(isOffline);
  useEffect(() => {
    isOfflineRef.current = isOffline;
  }, [isOffline]);

  // Contador de fallos consecutivos (QUI-346) — compartido entre el reintento automático de
  // `iniciarSyncAutomatico` y el sync directo del intervalo de abajo, para que "fallo
  // definitivo" refleje intentos reales sin importar qué camino los disparó.
  const fallosConsecutivosRef = useRef(0);
  const registrarExito = useCallback(() => {
    fallosConsecutivosRef.current = 0;
    setSyncFalloDefinitivo(false);
    setUltimaSyncOk(new Date());
  }, []);
  const registrarFallo = useCallback(() => {
    fallosConsecutivosRef.current += 1;
    if (esFalloDefinitivo(fallosConsecutivosRef.current)) setSyncFalloDefinitivo(true);
  }, []);

  // Efecto para vibración al recuperar conexión
  const wasOffline = useRef(false);
  useEffect(() => {
    if (isOffline) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      Vibration.vibrate([0, 100, 100, 100]); // Patrón de reconexión
    }
  }, [isOffline]);

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
          setIsSyncing(false);
          if ('error' in resultado) {
            setErrorSync(resultado.error);
            registrarFallo();
          } else {
            setErrorSync(null);
            registrarExito();
          }
          void actualizarPendientes();
        },
        () => {
          if (activo) setIsSyncing(true);
        }
      );
    };
    void iniciar();

    const intervalo = setInterval(() => {
      void (async () => {
        const token = await releerToken();
        if (token && !isOfflineRef.current) {
          try {
            setIsSyncing(true);
            if (simularFalloSync) {
              // QUI-338 (c): camino de demo/QA — nunca toca la red de verdad.
              throw new Error('Fallo de sincronización simulado (QA)');
            }
            await sincronizarPendientes(token);
            setErrorSync(null);
            registrarExito();
          } catch (error) {
            setErrorSync(error instanceof Error ? error.message : 'Error de sincronización');
            registrarFallo();
          } finally {
            setIsSyncing(false);
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
  }, [obtenerAccessToken, actualizarPendientes, simularFalloSync, registrarExito, registrarFallo]);

  return { pendientes, errorSync, syncFalloDefinitivo, ultimaSyncOk, isOffline, isSyncing };
}
