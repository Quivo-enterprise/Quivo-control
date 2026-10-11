import { memo, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useVecinosRuta } from './use-vecinos-ruta';
import { VecinosRutaCard } from './vecinos-ruta-card';
import { estadoFila, sinActualizar, tarjetaVisible } from './estado-vecinos';

interface Props {
  tracking: boolean;
  online: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  hayPosicion: boolean;
  /** Getter estable (no la posición misma) para que el GPS a 1 Hz no re-renderice el panel. */
  obtenerPosicion: () => { lat: number; lng: number } | null;
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

  if (!params.tracking || !datos || recibidoEn === null) return null;
  const transcurridoMs = Math.max(0, ahora - recibidoEn);
  const delante = estadoFila(datos.delante, transcurridoMs);
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
