import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { abrirOutbox, encolarEvento } from '../../db/outbox';
import { guardarJornada, leerJornada } from './jornada-store';
import {
  crearDeclaracion,
  declaracionVigente,
  diaBolivia,
  msHastaMedianoche,
  type DeclaracionJornada,
} from './jornada-store-core';

const MENSAJE_ERROR_EMPEZAR = 'No se pudo registrar el inicio del día. Intenta de nuevo.';

export interface UseJornadaParams {
  vehiculoId: string;
  conductorId: string;
  sesionId: string;
  deviceId: string;
}

export interface UseJornadaResult {
  jornadaIniciada: boolean;
  /** Instante ISO de la declaración vigente (la pantalla lo formatea en hora de Bolivia). */
  inicioTs: string | null;
  /** `true` hasta que termina la primera lectura del almacenamiento local. */
  cargando: boolean;
  /** `true` mientras `empezarDia` está en curso (también protegido por una ref). */
  empezando: boolean;
  /** Error del último intento de `empezarDia`; `null` si no hubo o si se reintenta. */
  errorEmpezarDia: string | null;
  /** Declara el día (`inicio_jornada`). Nunca rechaza: los fallos quedan en `errorEmpezarDia`. */
  empezarDia: () => Promise<void>;
}

/**
 * Jornada del conductor (release 13, feature A). La declaración vive en memoria (fuente del
 * render) y se espeja en AsyncStorage; el evento `inicio_jornada` sale por el outbox, así que
 * funciona offline. La declaración solo se da por hecha si el evento quedó encolado: si el
 * outbox falla se expone `errorEmpezarDia` y el chofer puede reintentar. Está atada a la sesión,
 * al vehículo, al conductor y al día de Bolivia. El día se re-evalúa al volver la app a primer
 * plano y con un timer a la próxima medianoche de Bolivia (la pantalla se mantiene despierta,
 * así que `AppState` puede no cambiar nunca durante la noche).
 */
export function useJornada(params: UseJornadaParams): UseJornadaResult {
  const { vehiculoId, conductorId, sesionId, deviceId } = params;
  const identidad = useMemo(
    () => ({ vehiculoId, conductorId, sesionId }),
    [vehiculoId, conductorId, sesionId],
  );
  const [declaracion, setDeclaracion] = useState<DeclaracionJornada | null>(null);
  const [cargando, setCargando] = useState(true);
  const [empezando, setEmpezando] = useState(false);
  const [errorEmpezarDia, setErrorEmpezarDia] = useState<string | null>(null);
  const [hoy, setHoy] = useState(() => diaBolivia());
  const enVueloRef = useRef(false);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    void leerJornada(identidad).then((leida) => {
      if (cancelado) return;
      // Si el chofer ya declaró en memoria mientras se leía, esa declaración manda.
      setDeclaracion((actual) =>
        declaracionVigente(actual, identidad, diaBolivia()) ? actual : leida,
      );
      setCargando(false);
    });
    return () => {
      cancelado = true;
    };
  }, [identidad]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') setHoy(diaBolivia());
    });
    return () => sub.remove();
  }, []);

  // Cambio de día con la app en primer plano: timer a la próxima medianoche de Bolivia, que se
  // vuelve a armar tras disparar (cada disparo cambia `hoy` y re-ejecuta este efecto).
  useEffect(() => {
    const timer = setTimeout(() => setHoy(diaBolivia()), msHastaMedianoche() + 250);
    return () => clearTimeout(timer);
  }, [hoy]);

  const empezarDia = useCallback(async () => {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setEmpezando(true);
    setErrorEmpezarDia(null);
    try {
      const ahora = new Date();
      const nueva = crearDeclaracion(identidad, ahora);
      try {
        // 1) Durable primero: el outbox es lo que llega al servidor.
        const db = await abrirOutbox();
        await encolarEvento(db, { deviceId, tipo: 'inicio_jornada', payload: { sesionId } });
      } catch (error) {
        console.error('[QUIVO][jornada] No se pudo encolar inicio_jornada', error);
        Sentry.captureException(error, {
          tags: { contexto: 'jornada', paso: 'encolar-inicio-jornada' },
        });
        // Sin evento encolado NO se declara el día: el chofer reintenta.
        setErrorEmpezarDia(MENSAJE_ERROR_EMPEZAR);
        return;
      }
      // 2) Espejo local; si falla el chofer sigue en memoria esta corrida.
      if (!(await guardarJornada(nueva))) {
        Sentry.captureMessage('jornada: no se pudo persistir la declaración local', 'warning');
      }
      setHoy(diaBolivia(ahora));
      setDeclaracion(nueva);
    } catch (error) {
      // Cinturón: esta función nunca debe rechazar (la pantalla la llama con `void`).
      Sentry.captureException(error, { tags: { contexto: 'jornada', paso: 'empezar-dia' } });
      setErrorEmpezarDia(MENSAJE_ERROR_EMPEZAR);
    } finally {
      enVueloRef.current = false;
      setEmpezando(false);
    }
  }, [identidad, deviceId, sesionId]);

  const vigente = declaracionVigente(declaracion, identidad, hoy);
  return {
    jornadaIniciada: vigente,
    inicioTs: vigente && declaracion ? declaracion.ts : null,
    cargando,
    empezando,
    errorEmpezarDia,
    empezarDia,
  };
}
