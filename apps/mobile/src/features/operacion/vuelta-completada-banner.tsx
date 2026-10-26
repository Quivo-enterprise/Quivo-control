import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text } from '@quivo/design-system-native';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors, dsDuration, dsEasing } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';

const DURACION_AVISO_MS = 4000;

interface VueltaCompletadaBannerProps {
  /** Resumen de la vuelta que acaba de cerrarse; `null` = nada que mostrar. */
  resumen: { numero: number; pasados: number; total: number } | null;
  /** Posición (dp) desde el borde superior de la pantalla, bajo la tarjeta superior. */
  top: number;
  onTerminar: () => void;
  /** Alto medido (dp) mientras el banner está visible; 0 cuando no hay nada. Permite apilar otros
   * avisos debajo en vez de taparlo. */
  onAlto?: (alto: number) => void;
}

/** Aviso breve "Vuelta N completada · X/Y puntos", una vez por cierre de vuelta (RF-GPS-054).
 * Se apaga solo; la acción permite cerrarlo antes. */
export function VueltaCompletadaBanner({
  resumen,
  top,
  onTerminar,
  onAlto,
}: VueltaCompletadaBannerProps) {
  const opacidad = useRef(new Animated.Value(0)).current;
  const onTerminarRef = useRef(onTerminar);
  onTerminarRef.current = onTerminar;

  useEffect(() => {
    if (!resumen) return;
    opacidad.setValue(0);
    const animacion = Animated.sequence([
      Animated.timing(opacidad, {
        toValue: 1,
        duration: dsDuration.base,
        easing: dsEasing.easeOut,
        useNativeDriver: true,
      }),
      Animated.delay(DURACION_AVISO_MS),
      Animated.timing(opacidad, {
        toValue: 0,
        duration: dsDuration.base,
        easing: dsEasing.easeIn,
        useNativeDriver: true,
      }),
    ]);
    animacion.start(({ finished }) => {
      if (finished) onTerminarRef.current();
    });
    return () => animacion.stop();
  }, [resumen, opacidad]);

  const onAltoRef = useRef(onAlto);
  onAltoRef.current = onAlto;
  useEffect(() => {
    if (!resumen) onAltoRef.current?.(0);
  }, [resumen]);

  if (!resumen) return null;
  return (
    <Animated.View
      style={[styles.contenedor, { top, opacity: opacidad }]}
      onLayout={(e) => onAlto?.(e.nativeEvent.layout.height)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Burbuja style={styles.burbuja}>
        <Ionicons name="repeat" size={20} color={dsColors.success} />
        <Text size="sm" weight="semibold" style={styles.texto}>
          Vuelta {resumen.numero} completada · {resumen.pasados}/{resumen.total} puntos
        </Text>
        <Button variant="outline" onPress={onTerminar}>
          Terminar
        </Button>
      </Burbuja>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    position: 'absolute',
    left: quivoBubble.edge,
    right: quivoBubble.edge,
    alignItems: 'center',
    zIndex: 1500,
  },
  burbuja: { width: '100%', flexWrap: 'wrap' },
  texto: { color: dsColors.textPrimary, flex: 1, minWidth: 120 },
});
