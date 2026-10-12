import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type { PuntoControlPaquete } from '@quivo/shared';
import { abrirOutbox } from '../../db/outbox';
import {
  derivarProgreso,
  estadoInicialVuelta,
  type EstadoProgresoVuelta,
  type ProgresoDerivado,
} from './progreso-vuelta';
import { leerProgresoVuelta, suscribirProgresoVuelta } from './progreso-vuelta-store';

export interface ProgresoVueltaUi extends ProgresoDerivado {
  /** Resumen de la última vuelta cerrada, para el aviso "Vuelta N completada". */
  ultimaVueltaResumen: EstadoProgresoVuelta['ultimaVueltaResumen'];
  /** Cierre de vuelta ocurrido EN VIVO (esta sesión de pantalla) pendiente de avisar; lo que se
   * hidrata de disco (cierres con la app en segundo plano) no dispara aviso. */
  avisoVuelta: NonNullable<EstadoProgresoVuelta['ultimaVueltaResumen']> | null;
  descartarAvisoVuelta: () => void;
}

/**
 * Progreso de la vuelta para la UI (RF-GPS-054). Solo LEE: el escritor es `registrarPasoEnVuelta`
 * (`progreso-vuelta-store.ts`), invocado desde el registro de cumplimientos tanto en foreground
 * como en headless. Se hidrata de disco al montar y cada vez que la app vuelve a `active` (lo que
 * el headless escribió con la app en segundo plano), y recibe en el acto lo que escribe este
 * mismo contexto por la suscripción en-proceso.
 *
 * `activo` = recorrido en curso: sin él se deriva de un estado vacío (la ruta en espera se
 * muestra "virgen", mismo criterio que el mapa).
 */
export function useProgresoVuelta(
  sesionId: string,
  puntosControl: readonly PuntoControlPaquete[],
  posicion: { lat: number; lng: number } | null,
  activo: boolean,
): ProgresoVueltaUi {
  const [estado, setEstado] = useState<EstadoProgresoVuelta>(() => estadoInicialVuelta(sesionId));
  const [avisoVuelta, setAvisoVuelta] = useState<ProgresoVueltaUi['avisoVuelta']>(null);
  // Número de la última vuelta ya conocida (hidratada o avisada): solo uno MAYOR es un cierre nuevo.
  const numeroConocido = useRef(0);
  const descartarAvisoVuelta = useCallback(() => setAvisoVuelta(null), []);

  useEffect(() => {
    let vigente = true;
    setEstado(estadoInicialVuelta(sesionId));
    setAvisoVuelta(null);
    numeroConocido.current = 0;
    const hidratar = () => {
      abrirOutbox()
        .then((db) => leerProgresoVuelta(db, sesionId))
        .then((leido) => {
          if (!vigente) return;
          numeroConocido.current = Math.max(
            numeroConocido.current,
            leido.ultimaVueltaResumen?.numero ?? 0,
          );
          setEstado(leido);
        })
        .catch((error: unknown) => {
          Sentry.captureException(error, {
            tags: { contexto: 'progreso-vuelta', paso: 'hidratar' },
          });
        });
    };
    hidratar();
    const bajaAppState = AppState.addEventListener('change', (siguiente) => {
      if (siguiente === 'active') hidratar();
    });
    const bajaEmisor = suscribirProgresoVuelta((nuevo) => {
      if (!vigente || nuevo.sesionId !== sesionId) return;
      setEstado(nuevo);
      const resumen = nuevo.ultimaVueltaResumen;
      if (resumen && resumen.numero > numeroConocido.current) {
        numeroConocido.current = resumen.numero;
        setAvisoVuelta(resumen);
      }
    });
    return () => {
      vigente = false;
      bajaAppState.remove();
      bajaEmisor();
    };
  }, [sesionId]);

  return useMemo(() => {
    const efectivo = activo ? estado : estadoInicialVuelta(sesionId);
    return {
      ...derivarProgreso(efectivo, puntosControl, posicion),
      ultimaVueltaResumen: efectivo.ultimaVueltaResumen,
      avisoVuelta,
      descartarAvisoVuelta,
    };
  }, [activo, estado, sesionId, puntosControl, posicion, avisoVuelta, descartarAvisoVuelta]);
}
