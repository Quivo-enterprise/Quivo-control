import { useEffect, useRef } from 'react';
import { useNetInfo } from '@react-native-community/netinfo';
import {
  DEBOUNCE_RECONEXION_MS,
  crearDetectorReconexion,
  esOnline,
  type DetectorReconexion,
} from './reconexion-detector';

/**
 * Hook delgado: suscribe `useNetInfo()` y alimenta `crearDetectorReconexion` (lógica pura, ver
 * `reconexion-detector.ts`) con el resultado de `esOnline` en cada render donde cambió.
 * `onReconectado` se lee por ref (mismo patrón que `enviarEstadoCompleto`/`estadoActualRef` en
 * `route-map-view.tsx`) para que el detector no se recree si el llamador pasa una función nueva
 * en cada render.
 *
 * Sin test propio a propósito: este archivo importa `@react-native-community/netinfo`, que
 * arrastra `react-native` entero y no corre bajo `vitest`/Node (mismo motivo por el que
 * `use-sync-status.ts` — el hook equivalente para el estado de sync — tampoco tiene test propio;
 * ver el comentario en `sync-outbox.lease.test.ts`). La lógica que sí vale la pena testear
 * (`esOnline`, `crearDetectorReconexion` — la transición offline→online, el debounce) vive en
 * `reconexion-detector.ts`, sin ningún import de React/RN, y se testea ahí directo.
 */
export function useReconexionMapaOffline(onReconectado: () => void): void {
  const netInfo = useNetInfo();
  const online = esOnline(netInfo.isConnected, netInfo.isInternetReachable);

  const onReconectadoRef = useRef(onReconectado);
  onReconectadoRef.current = onReconectado;

  const detectorRef = useRef<DetectorReconexion | null>(null);
  if (detectorRef.current === null) {
    detectorRef.current = crearDetectorReconexion({
      debounceMs: DEBOUNCE_RECONEXION_MS,
      onReconectado: () => onReconectadoRef.current(),
    });
  }

  useEffect(() => {
    detectorRef.current?.notificar(online);
  }, [online]);

  useEffect(() => {
    return () => detectorRef.current?.destruir();
  }, []);
}
