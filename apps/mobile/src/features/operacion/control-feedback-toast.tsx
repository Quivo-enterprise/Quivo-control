import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, Vibration, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoSpacing } from '../../shared/theme/quivo-theme';
import type { DeteccionPuntoControl } from '../../gps/geofence';

interface ControlFeedbackToastProps {
  ultimaDeteccion: DeteccionPuntoControl | null;
}

export function ControlFeedbackToast({ ultimaDeteccion }: ControlFeedbackToastProps) {
  const [queue, setQueue] = useState<DeteccionPuntoControl[]>([]);
  const [current, setCurrent] = useState<DeteccionPuntoControl | null>(null);
  const timerRef = useRef<NodeJS.Timeout>();
  
  // Animations for modal entry/exit
  const containerOpacity = useSharedValue(0);
  const containerScale = useSharedValue(0.8);
  
  // Animation for checkmark growth
  const checkmarkScale = useSharedValue(0);

  // Ripple animation
  const rippleScale = useSharedValue(1);
  const rippleOpacity = useSharedValue(0);

  const dismissTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!ultimaDeteccion || !ultimaDeteccion.cumplido) return;
    setQueue((prev) => [...prev, ultimaDeteccion]);
  }, [ultimaDeteccion]);

  useEffect(() => {
    if (current) return;
    if (queue.length === 0) return;

    const next = queue[0];
    setCurrent(next!);
    setQueue((prev) => prev.slice(1));
  }, [queue, current]);

  useEffect(() => {
    if (!current) return;

    // Háptica
    Vibration.vibrate(100);

    // Entrada del modal (scale + opacity)
    containerOpacity.value = withTiming(1, { duration: 200 });
    containerScale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.back(1.2)) });
    checkmarkScale.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.back(1.5)) });

    // Ripple continuo
    rippleScale.value = 1;
    rippleOpacity.value = 0.5;
    rippleScale.value = withRepeat(withTiming(1.5, { duration: 1000, easing: Easing.out(Easing.ease) }), -1);
    rippleOpacity.value = withRepeat(withTiming(0, { duration: 1000, easing: Easing.out(Easing.ease) }), -1);

    // Reposo 2 segundos, luego Fade out: 500ms
    timerRef.current = setTimeout(() => {
      dismiss();
    }, 2500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dismissTimeoutRef.current) clearTimeout(dismissTimeoutRef.current);
    };
  }, [current]);

  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (dismissTimeoutRef.current) return; // Ya estamos ocultando
    
    // Salida animada
    containerOpacity.value = withTiming(0, { duration: 500 });
    containerScale.value = withTiming(0.8, { duration: 500 });
    
    // Esperar que termine la salida para vaciar el current
    dismissTimeoutRef.current = setTimeout(() => {
      setCurrent(null);
      checkmarkScale.value = 0;
      rippleOpacity.value = 0;
      dismissTimeoutRef.current = undefined;
    }, 500);
  };

  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ scale: containerScale.value }],
  }));

  const animatedCheckmarkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
  }));

  const animatedRippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rippleScale.value }],
    opacity: rippleOpacity.value,
  }));

  if (!current) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.overlay, animatedContainerStyle]} pointerEvents="auto">
        <Pressable 
          onPress={dismiss} 
          style={styles.content}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Control registrado automáticamente. Punto de control. Hora: ${new Date().toLocaleTimeString('es-BO')}`}
        >
          <View style={styles.iconContainer}>
            <Animated.View style={[styles.ripple, animatedRippleStyle]} />
            <Animated.View style={[styles.circle, animatedCheckmarkStyle]}>
              <Ionicons name="checkmark" size={80} color="#4CAF50" />
            </Animated.View>
          </View>
          
          <Text style={styles.title}>Control registrado automáticamente</Text>
          
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>Punto de Control #{current.puntoControlId.substring(0,4)}</Text>
            <Text style={styles.infoText}>
              {new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.85)', // Fondo blanco/transparente
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: quivoSpacing.xl,
  },
  iconContainer: {
    position: 'relative',
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: quivoSpacing.xl,
  },
  circle: {
    width: 120, // 120x120 dp
    height: 120,
    borderRadius: 60,
    backgroundColor: quivoColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 2,
  },
  ripple: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(76, 175, 80, 0.2)', // Ripple verde claro
    zIndex: 1,
  },
  title: {
    color: '#4CAF50',
    fontFamily: quivoFonts.displayBold,
    fontSize: 18, // Ligeramente ajustado para verse bien
    textAlign: 'center',
    marginBottom: quivoSpacing.md,
  },
  infoContainer: {
    alignItems: 'center',
    gap: quivoSpacing.xs,
  },
  infoText: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
  },
});
