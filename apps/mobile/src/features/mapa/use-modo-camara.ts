import { useCallback, useEffect, useReducer, useRef } from 'react';
import { estadoCamaraInicial, reducirModoCamara, type EstadoCamara } from './modo-camara';

/**
 * Hook fino sobre el reducer puro `modo-camara.ts`. Vive en la pantalla (no en el mapa) porque
 * la pantalla también necesita el modo: para el FAB de cámara y para colapsar el sheet. Traduce
 * los bordes de `tracking` a eventos del recorrido; el pan y el recentrar los disparan el mapa
 * y el FAB. Callbacks estables.
 */
export function useModoCamara(tracking: boolean): {
  camara: EstadoCamara;
  onPanUsuario: () => void;
  recentrar: () => void;
} {
  const [camara, despachar] = useReducer(reducirModoCamara, tracking, estadoCamaraInicial);

  const trackingPrevioRef = useRef(tracking);
  useEffect(() => {
    const previo = trackingPrevioRef.current;
    trackingPrevioRef.current = tracking;
    if (tracking && !previo) despachar({ tipo: 'iniciarRecorrido' });
    else if (!tracking && previo) despachar({ tipo: 'finalizarRecorrido' });
  }, [tracking]);

  const onPanUsuario = useCallback(() => despachar({ tipo: 'panUsuario' }), []);
  const recentrar = useCallback(() => despachar({ tipo: 'recentrar' }), []);

  return { camara, onPanUsuario, recentrar };
}
