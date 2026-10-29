import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { estadoCamaraInicial, reducirModoCamara, type EstadoCamara } from './modo-camara';

/** Tras este tiempo sin tocar el mapa en `libre`, la cámara vuelve sola a seguir al vehículo. */
export const AUTO_RECENTRAR_MS = 5_000;

/** Temporizador reiniciable: `armar` cancela el pendiente y agenda `accion` en `ms`. */
export function crearTemporizadorReiniciable(ms: number, accion: () => void) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const cancelar = () => {
    if (id !== undefined) clearTimeout(id);
    id = undefined;
  };
  const armar = () => {
    cancelar();
    id = setTimeout(accion, ms);
  };
  return { armar, cancelar };
}

/** Dedo apoyado cancela el temporizador; soltarlo lo arma (solo en `libre`). `puedeArmar` es para
 * el efecto que arma al entrar a `libre`: no arma con el dedo puesto. */
export function crearGestorToque(
  temporizador: { armar: () => void; cancelar: () => void },
  esLibre: () => boolean,
) {
  let activo = false;
  return {
    puedeArmar: () => !activo,
    onToque: (apoyado: boolean) => {
      activo = apoyado;
      if (apoyado) temporizador.cancelar();
      else if (esLibre()) temporizador.armar();
    },
  };
}

/**
 * Hook fino sobre el reducer puro `modo-camara.ts`. Vive en la pantalla (no en el mapa) porque
 * la pantalla también necesita el modo: para el FAB de cámara y la brújula. Traduce
 * los bordes de `tracking` a eventos del recorrido; el pan y el recentrar los disparan el mapa
 * y el FAB. Callbacks estables.
 */
export function useModoCamara(tracking: boolean): {
  camara: EstadoCamara;
  onPanUsuario: () => void;
  onToqueMapa: (activo: boolean) => void;
  recentrar: () => void;
  alternarOrientacion: () => void;
} {
  const [camara, despachar] = useReducer(reducirModoCamara, tracking, estadoCamaraInicial);

  const trackingPrevioRef = useRef(tracking);
  useEffect(() => {
    const previo = trackingPrevioRef.current;
    trackingPrevioRef.current = tracking;
    if (tracking && !previo) despachar({ tipo: 'iniciarRecorrido' });
    else if (!tracking && previo) despachar({ tipo: 'finalizarRecorrido' });
  }, [tracking]);

  // Auto-recentrar: en `libre` los 5 s corren desde que se suelta el dedo; con el dedo apoyado
  // (aunque quieto) el timer no corre, para que la cámara no salte bajo el dedo.
  const temporizador = useMemo(
    () => crearTemporizadorReiniciable(AUTO_RECENTRAR_MS, () => despachar({ tipo: 'recentrar' })),
    [],
  );
  const modoRef = useRef(camara.modo);
  modoRef.current = camara.modo;
  const gestorToque = useMemo(
    () => crearGestorToque(temporizador, () => modoRef.current === 'libre'),
    [temporizador],
  );
  useEffect(() => {
    if (camara.modo === 'libre' && gestorToque.puedeArmar()) temporizador.armar();
    else temporizador.cancelar();
    return temporizador.cancelar;
  }, [camara.modo, temporizador, gestorToque]);

  const onPanUsuario = useCallback(() => despachar({ tipo: 'panUsuario' }), []);
  const onToqueMapa = gestorToque.onToque;
  const recentrar = useCallback(() => despachar({ tipo: 'recentrar' }), []);

  const alternarOrientacion = useCallback(() => despachar({ tipo: 'alternarOrientacion' }), []);

  return { camara, onPanUsuario, onToqueMapa, recentrar, alternarOrientacion };
}
