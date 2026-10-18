import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { FaseCircuito, VecinosRuta } from '@quivo/shared';
import { vecinosRutaApi, type PosicionVecinos } from '../../shared/api/vecinos-ruta-api';

export const INTERVALO_VECINOS_MS = 30_000;

interface Params {
  /** Solo se consulta mientras hay recorrido en curso. */
  tracking: boolean;
  /** `!isOffline` de `useSyncStatus`. */
  online: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  /**
   * Hay una posición conocida. Sin ella no se consulta: una sesión nueva aún no tiene fila en
   * `gps_sesion_resumen` y el servidor respondería "nadie" en ambos lados (falso negativo).
   */
  hayPosicion: boolean;
  /**
   * Getter estable de la posición actual. Se lee por ref al consultar, así los cambios de
   * posición (1 Hz) no re-renderizan el panel ni reinician el intervalo.
   */
  obtenerPosicion: () => PosicionVecinos | null;
  /**
   * Getter estable de la fase de la vuelta (ida/regreso; `null` si la ruta no tiene retorno). Va
   * por ref, igual que la posición: un cambio de fase no reinicia el intervalo.
   */
  obtenerFase: () => FaseCircuito | null;
}

export interface EstadoVecinosRuta {
  /** Último resultado bueno (se conserva ante errores y pausas). */
  datos: VecinosRuta | null;
  /** Epoch ms de recepción de `datos`, para mostrar la edad acumulada. */
  recibidoEn: number | null;
  /** Fallos de red consecutivos desde el último éxito (0 = último intento bueno). */
  fallosConsecutivos: number;
}

const ESTADO_INICIAL: EstadoVecinosRuta = { datos: null, recibidoEn: null, fallosConsecutivos: 0 };

/**
 * Polling cada 30 s de los vecinos de ruta. Solo corre con `tracking` + app en primer plano +
 * online + posición conocida; el primer fetch es inmediato al cumplirse las condiciones. Nunca
 * lanza: ante un error conserva el último dato bueno y cuenta los fallos consecutivos (la UI
 * avisa "Sin actualizar" al pasar el umbral). Cada recorrido es una "generación": al terminar
 * (o desmontar) se invalida, y las respuestas de una generación anterior se descartan.
 */
export function useVecinosRuta({
  tracking,
  online,
  obtenerAccessToken,
  hayPosicion,
  obtenerPosicion,
  obtenerFase,
}: Params): EstadoVecinosRuta {
  const [estado, setEstado] = useState<EstadoVecinosRuta>(ESTADO_INICIAL);
  const [appActiva, setAppActiva] = useState(AppState.currentState === 'active');

  // Refs para que el cambio de token/getter NO reinicie el intervalo.
  const posicionRef = useRef(obtenerPosicion);
  const tokenRef = useRef(obtenerAccessToken);
  const faseRef = useRef(obtenerFase);
  posicionRef.current = obtenerPosicion;
  faseRef.current = obtenerFase;
  tokenRef.current = obtenerAccessToken;

  // Generación del recorrido actual; se incrementa al terminarlo y al desmontar.
  const generacion = useRef(0);
  // Generación con una consulta en vuelo (null = ninguna). Por generación: tras false→true una
  // consulta vieja aún pendiente no bloquea la inmediata del recorrido nuevo.
  const enVuelo = useRef<number | null>(null);

  useEffect(
    () => () => {
      generacion.current += 1;
    },
    [],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      setAppActiva(s === 'active');
    });
    return () => sub.remove();
  }, []);

  const consultar = useCallback(async () => {
    const gen = generacion.current;
    if (enVuelo.current === gen) return;
    enVuelo.current = gen;
    try {
      const token = await tokenRef.current();
      if (!token) throw new Error('sin token');
      const datos = await vecinosRutaApi.obtener(token, posicionRef.current(), faseRef.current());
      if (gen !== generacion.current) return;
      setEstado({ datos, recibidoEn: Date.now(), fallosConsecutivos: 0 });
    } catch {
      if (gen !== generacion.current) return;
      setEstado((prev) => ({ ...prev, fallosConsecutivos: prev.fallosConsecutivos + 1 }));
    } finally {
      if (enVuelo.current === gen) enVuelo.current = null;
    }
  }, []);

  const activo = tracking && appActiva && online && hayPosicion;
  useEffect(() => {
    if (!activo) return;
    void consultar();
    const id = setInterval(() => void consultar(), INTERVALO_VECINOS_MS);
    return () => clearInterval(id);
  }, [activo, consultar]);

  // Al terminar el recorrido el dato viejo no aplica a la próxima jornada: se invalida la
  // generación (descarta respuestas en vuelo) y se limpia el estado.
  useEffect(() => {
    if (tracking) return;
    generacion.current += 1;
    setEstado(ESTADO_INICIAL);
  }, [tracking]);

  return estado;
}
