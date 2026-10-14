import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

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
 * Pasivo (`pointerEvents="none"`): no tapa el mapa ni exige una acción del chofer. */
export function VueltaCompletadaBanner({ resumen, top, onTerminar, onAlto }: VueltaCompletadaBannerProps) {
  const opacidad = useRef(new Animated.Value(0)).current;
  const onTerminarRef = useRef(onTerminar);
  onTerminarRef.current = onTerminar;

  useEffect(() => {
    if (!resumen) return;
    opacidad.setValue(0);
    const animacion = Animated.sequence([
      Animated.timing(opacidad, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(DURACION_AVISO_MS),
      Animated.timing(opacidad, { toValue: 0, duration: 400, useNativeDriver: true }),
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
      pointerEvents="none"
      style={[styles.contenedor, { top, opacity: opacidad }]}
      onLayout={(e) => onAlto?.(e.nativeEvent.layout.height)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.pill}>
        <Ionicons name="repeat" size={18} color={quivoColors.success} />
        <Text style={styles.texto}>
          Vuelta {resumen.numero} completada · {resumen.pasados}/{resumen.total} puntos
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1500,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.lg,
    paddingVertical: quivoSpacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  texto: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 14,
  },
});
