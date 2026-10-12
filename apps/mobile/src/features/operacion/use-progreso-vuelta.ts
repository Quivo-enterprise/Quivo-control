import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type { PuntoControlPaquete } from '@quivo/shared';
import { abrirOutbox } from '../../db/outbox';
import {
  conProximo,
  derivarProgresoEstatico,
  estadoInicialVuelta,
  proximoMasCercanoId,
  type EstadoProgresoVuelta,
  type ProgresoDerivado,
} from './progreso-vuelta';
import { leerProgresoVuelta, suscribirProgresoVuelta } from './progreso-vuelta-store';

type ResumenVuelta = NonNullable<EstadoProgresoVuelta['ultimaVueltaResumen']>;

export interface ProgresoVueltaUi extends ProgresoDerivado {
  /** Cierre de vuelta ocurrido EN VIVO (esta sesión de pantalla, app en primer plano) pendiente
   * de avisar; lo que se hidrata de disco (cierres con la app en segundo plano) no dispara aviso. */
  avisoVuelta: ResumenVuelta | null;
  descartarAvisoVuelta: () => void;
}

/**
 * Progreso de la vuelta para la UI (RF-GPS-054). Solo LEE: el escritor es `registrarPasoEnVuelta`
 * (`progreso-vuelta-store.ts`), invocado desde el registro de cumplimientos tanto en foreground
 * como en headless. Se hidrata de disco al montar y cada vez que la app vuelve a `active` (lo que
 * el headless escribió con la app en segundo plano), y recibe en el acto lo que escribe este
 * mismo contexto por la suscripción en-proceso. Un estado (hidratado o emitido) solo se aplica si
 * no es más viejo que el que ya se tiene (`fecha`, luego `version`).
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
  const [avisoVuelta, setAvisoVuelta] = useState<ResumenVuelta | null>(null);
  // Número de la última vuelta ya conocida (hidratada o avisada): solo uno MAYOR es un cierre nuevo.
  const numeroConocido = useRef(0);
  const descartarAvisoVuelta = useCallback(() => setAvisoVuelta(null), []);

  useEffect(() => {
    let vigente = true;
    let sostenido = estadoInicialVuelta(sesionId);
    setEstado(sostenido);
    setAvisoVuelta(null);
    numeroConocido.current = 0;
    // ¿`candidato` es al menos tan nuevo como el que se sostiene? (día más reciente, o mismo día
    // y `version` >=). Evita que una lectura de disco lenta pise un estado más nuevo ya emitido.
    const aceptar = (candidato: EstadoProgresoVuelta): boolean => {
      if (candidato.sesionId !== sesionId) return false;
      if (candidato.fecha !== sostenido.fecha) return candidato.fecha > sostenido.fecha;
      return candidato.version >= sostenido.version;
    };
    const hidratar = () => {
      abrirOutbox()
        .then((db) => leerProgresoVuelta(db, sesionId))
        .then((leido) => {
          if (!vigente || !aceptar(leido)) return;
          sostenido = leido;
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
      if (!vigente || !aceptar(nuevo)) return;
      sostenido = nuevo;
      setEstado(nuevo);
      const resumen = nuevo.ultimaVueltaResumen;
      if (resumen && resumen.numero > numeroConocido.current) {
        numeroConocido.current = resumen.numero;
        // En segundo plano el aviso no se vería (la animación correría sin pantalla): solo se
        // registra el número como conocido.
        if (AppState.currentState === 'active') setAvisoVuelta(resumen);
      }
    });
    return () => {
      vigente = false;
      bajaAppState.remove();
      bajaEmisor();
    };
  }, [sesionId]);

  const vacio = useMemo(() => estadoInicialVuelta(sesionId), [sesionId]);
  // Progreso estático (sin posición): solo se recalcula si cambia el estado o los puntos.
  const estatico = useMemo(
    () => derivarProgresoEstatico(activo ? estado : vacio, puntosControl),
    [activo, estado, vacio, puntosControl],
  );
  // La posición solo importa mientras no haya punto de inicio (próximo = el más cercano); el
  // memo devuelve un id (string), así que moverse no invalida nada mientras el id no cambie.
  const cercanoId = useMemo(
    () => (estatico.conInicio ? null : proximoMasCercanoId(puntosControl, posicion)),
    [estatico.conInicio, puntosControl, posicion],
  );
  const derivado = useMemo(() => conProximo(estatico, cercanoId), [estatico, cercanoId]);

  return useMemo(
    () => ({ ...derivado, avisoVuelta, descartarAvisoVuelta }),
    [derivado, avisoVuelta, descartarAvisoVuelta],
  );
}
