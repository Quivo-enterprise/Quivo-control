import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { EstadoFilaSalida } from '@quivo/shared';
import { leerEstadoVueltaLocal } from '../../db/vuelta-actual-local';
import {
  ESTADO_LOCAL_INICIAL,
  designacionPendienteDeAviso,
  designacionVigente,
  esCacheDesactualizado,
  restanteEsperaMin,
  type Designacion,
  type EstadoLocalVuelta,
} from './vuelta-actual-core';
import {
  PISO_ENTRE_CONSULTAS_MS,
  consultarVueltaActual,
  entenderCancelacion,
  entenderDesignacion,
  limpiarVueltaActualDeOtrasSesiones,
  suscribirEstadoVuelta,
} from './vuelta-actual-oportunista';

/** Refresco del contador de espera en pantalla ("Podés salir en N min" cambia de a minutos). */
const REFRESCO_CONTADOR_MS = 15_000;
/** Cada cuánto se revalúa si el cache ya envejeció. */
const REVISION_CACHE_MS = 30_000;

interface Params {
  sesionId: string;
  /** Solo se consulta con el recorrido activo (el estado en cache se muestra igual sin red). */
  tracking: boolean;
  obtenerAccessToken: () => Promise<string | null>;
}

export interface EstadoVueltaActualUi {
  /** Designación a Molinos que el chofer todavía tiene que confirmar con "Entendido". */
  designacionPendiente: Designacion | null;
  /** Hay una cancelación sin cerrar. */
  cancelacionPendiente: boolean;
  /** Designación vigente (confirmada o no) con el recorrido activo: para el mapa, el tramo, el PC
   * de espera y la tarjeta de ruta (se calculan sin red, así que siguen aunque el cache envejezca;
   * ver `sinActualizar`). `null` = ruta base o sin recorrido. */
  designacionActiva: Designacion | null;
  /** La última consulta buena es vieja (> 15 min): la tarjeta lo marca "sin actualizar". */
  sinActualizar: boolean;
  /** Minutos que faltan para salir de Molinos; `null` = no está en espera (o cache viejo). */
  restanteEspera: number | null;
  /** Fila de salida de la terminal (del mismo cache); `null` = no está en la fila. Con recorrido
   * activo se sigue mostrando aunque el cache sea viejo (ver `filaSinActualizar`). */
  fila: EstadoFilaSalida | null;
  /** Hay `fila` pero la última consulta buena es vieja (> 15 min). */
  filaSinActualizar: boolean;
  /** `servidorTs - recepción local` (ms) de `fila`: base de la cuenta regresiva. */
  desfaseFilaMs: number | null;
  /** Salió de la fila y todavía no se alejó de la terminal (no se ofrece "Estoy en la fila"). */
  filaDesarmada: boolean;
  entenderDesignacion: () => void;
  entenderCancelacion: () => void;
}

/**
 * Vuelta actual del chofer: poll cada 20 s con la app en primer plano y el recorrido activo (los
 * eventos de ubicación disparan la misma consulta desde `use-gps-operativo.ts`/`headless-task.ts`,
 * con el mismo piso de 20 s, para cubrir el segundo plano). El estado se hidrata de SQLite al
 * montar, así el aviso/contador se ven sin red. Errores de red: silenciosos, se mantiene el
 * último estado (ver `vuelta-actual-oportunista.ts`).
 */
export function useVueltaActual({ sesionId, tracking, obtenerAccessToken }: Params): EstadoVueltaActualUi {
  const [estado, setEstado] = useState<EstadoLocalVuelta>(ESTADO_LOCAL_INICIAL);
  const [ahora, setAhora] = useState(() => Date.now());
  const [reloj, setReloj] = useState(0);
  const [appActiva, setAppActiva] = useState(AppState.currentState === 'active');
  const tokenRef = useRef(obtenerAccessToken);
  tokenRef.current = obtenerAccessToken;
  const obtenerToken = useCallback(() => tokenRef.current(), []);

  // Sin recorrido (tracking false) no hay aviso: el cache solo se hidrata con el recorrido activo
  // (`iniciar()`/`detener()` lo limpian). Al reiniciar la app el tracking se restaura y este efecto
  // lo vuelve a leer.
  useEffect(() => {
    let vivo = true;
    setEstado(ESTADO_LOCAL_INICIAL);
    if (tracking) {
      leerEstadoVueltaLocal(sesionId)
        .then((e) => {
          if (vivo) setEstado(e);
        })
        .catch(() => undefined);
    }
    const baja = suscribirEstadoVuelta((id, e) => {
      if (vivo && id === sesionId) setEstado(e);
    });
    return () => {
      vivo = false;
      baja();
    };
  }, [sesionId, tracking]);

  // Al montar / cambiar de sesión solo se borran las filas de OTRAS sesiones: `tracking` arranca en
  // false y pasa a true de forma asíncrona, así que la fila de ESTA sesión puede ser una designación
  // activa que todavía no se hidrató y no se puede limpiar por antigüedad.
  useEffect(() => {
    void limpiarVueltaActualDeOtrasSesiones(sesionId);
  }, [sesionId]);

  // Reloj que re-evalúa la antigüedad del cache (no re-renderiza si no hay respuesta guardada).
  const hayCache = estado.ultimo !== null;
  useEffect(() => {
    if (!hayCache) return;
    const id = setInterval(() => setReloj((r) => r + 1), REVISION_CACHE_MS);
    return () => clearInterval(id);
  }, [hayCache]);
  // Derivado en el mismo render que el estado (sin efecto): al hidratar no hay un render
  // intermedio con el cache viejo presentado como actual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cacheViejo = useMemo(() => esCacheDesactualizado(estado, Date.now()), [estado, reloj]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setAppActiva(s === 'active'));
    return () => sub.remove();
  }, []);

  const activo = tracking && appActiva;
  useEffect(() => {
    if (!activo) return;
    void consultarVueltaActual(obtenerToken, { forzar: true });
    const id = setInterval(() => void consultarVueltaActual(obtenerToken), PISO_ENTRE_CONSULTAS_MS);
    return () => clearInterval(id);
  }, [activo, obtenerToken]);

  const designacionCache = tracking ? designacionVigente(estado) : null;
  const enEspera = designacionCache ? (estado.ultimo?.enEspera ?? null) : null;
  useEffect(() => {
    if (!enEspera) return;
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), REFRESCO_CONTADOR_MS);
    return () => clearInterval(id);
  }, [enEspera]);

  // La antigüedad del cache NO anula la designación mientras haya recorrido: el tramo y el PC de
  // espera se calculan sin red y se marca "sin actualizar". La cuenta regresiva SÍ se corta con
  // cache viejo: depende de `enEspera`, que solo el servidor confirma (offline quedaría congelada).
  const designacionActiva = designacionCache;
  const restanteEspera = useMemo(
    () =>
      tracking && !cacheViejo && enEspera && designacionActiva
        ? restanteEsperaMin(designacionActiva.puntoEspera.esperaMin, enEspera.desdeTs, ahora)
        : null,
    [tracking, cacheViejo, enEspera, designacionActiva, ahora],
  );

  const fila = tracking ? (estado.ultimo?.fila ?? null) : null;

  return {
    designacionPendiente: tracking ? designacionPendienteDeAviso(estado) : null,
    cancelacionPendiente: tracking && estado.cancelacionPendiente !== null,
    designacionActiva,
    sinActualizar: cacheViejo && designacionCache !== null,
    restanteEspera,
    fila,
    filaSinActualizar: cacheViejo && fila !== null,
    desfaseFilaMs: estado.desfaseFilaMs ?? null,
    filaDesarmada: estado.filaDesarmada === true,
    entenderDesignacion: () => {
      if (tracking) void entenderDesignacion(obtenerToken, sesionId);
    },
    entenderCancelacion: () => {
      if (tracking) void entenderCancelacion(sesionId);
    },
  };
}
