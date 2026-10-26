import { memo, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as Speech from 'expo-speech';
import * as Sentry from '@sentry/react-native';
import type { FaseCircuito } from '@quivo/shared';
import type { PosicionVecinos } from '../../shared/api/vecinos-ruta-api';
import { useVecinosRuta } from './use-vecinos-ruta';
import { VecinosRutaCard } from './vecinos-ruta-card';
import { decidirAlertaVecino, distanciaHablada, estadoFila, sinActualizar, tarjetaVisible } from './estado-vecinos';

interface Props {
  tracking: boolean;
  online: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  hayPosicion: boolean;
  /** Getter estable (no la posición misma) para que el GPS a 1 Hz no re-renderice el panel. */
  obtenerPosicion: () => PosicionVecinos | null;
  /** Getter estable de la fase de la vuelta, para que el servidor ubique el progreso en el circuito. */
  obtenerFase: () => FaseCircuito | null;
  /** Borde inferior medido del overlay superior; el panel se ancla justo debajo. */
  topBase: number;
}

const SEPARACION_PX = 8;

/**
 * Conecta el hook con la tarjeta. Es un overlay propio (NO dentro del `topOverlay` medido): así
 * su montaje tardío no altera `insetSuperior` ni el padding de la cámara de navegación. No
 * renderiza nada sin datos ni cuando ambas filas están sin dato. Solo re-renderiza por datos,
 * tick, AppState o tracking.
 */
export const VecinosRutaPanel = memo(function VecinosRutaPanel({ topBase, ...params }: Props) {
  const { datos, recibidoEn, fallosConsecutivos } = useVecinosRuta(params);
  const [ahora, setAhora] = useState(() => Date.now());

  // "Ahora" fresco al llegar datos nuevos y al volver a primer plano (el timer pudo congelarse).
  useEffect(() => setAhora(Date.now()), [recibidoEn]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setAhora(Date.now());
    });
    return () => sub.remove();
  }, []);

  // Tick cada 15 s para que "hace N min" y el umbral de frescura avancen aun con el polling
  // pausado u offline.
  useEffect(() => {
    if (!datos) return;
    const id = setInterval(() => setAhora(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [datos]);

  const transcurridoMs = recibidoEn === null ? 0 : Math.max(0, ahora - recibidoEn);
  const delante = estadoFila(datos?.delante ?? null, transcurridoMs);
  const delanteM = params.tracking && delante.tipo === 'vecino' ? delante.vecino.distanciaM : null;

  // Alerta hablada del vehículo de adelante: una vez por cruce a <= 300 m (re-arme > 350 m).
  // Empieza desarmada: solo avisa tras ver el vehículo lejos y acercarse (no en la cola de salida).
  const alertaArmada = useRef(false);
  useEffect(() => {
    const r = decidirAlertaVecino(delanteM, alertaArmada.current);
    alertaArmada.current = r.armada;
    if (!r.hablar) return;
    try {
      Speech.speak(`Vehículo delante a ${distanciaHablada(delanteM ?? 0)}`, { volume: 1.0 });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'vecinos-ruta-panel', paso: 'voz-alerta-delante' },
      });
    }
  }, [delanteM]);
  // Un recorrido nuevo empieza desarmado: solo avisa al acercarse.
  useEffect(() => {
    if (!params.tracking) alertaArmada.current = false;
  }, [params.tracking]);

  if (!params.tracking || !datos || recibidoEn === null) return null;
  const detras = estadoFila(datos.detras, transcurridoMs);
  if (!tarjetaVisible(delante, detras)) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { top: topBase + SEPARACION_PX }]}
    >
      <VecinosRutaCard
        delante={delante}
        detras={detras}
        transcurridoMs={transcurridoMs}
        sinActualizar={sinActualizar(fallosConsecutivos)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  // Mismos márgenes horizontales que `topOverlay` de la pantalla de operación.
  overlay: { position: 'absolute', left: 16, right: 16 },
});
