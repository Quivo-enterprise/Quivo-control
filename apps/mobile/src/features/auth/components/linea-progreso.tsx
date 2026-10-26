import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, radius } from '@quivo/design-system-native';

export function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function LineaProgreso({ reduceMotion }: { reduceMotion: boolean }) {
  const position = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    position.stopAnimation();
    position.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(position, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [position, reduceMotion]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Preparando tu jornada"
      style={styles.track}
    >
      <Animated.View
        style={[
          styles.segment,
          {
            transform: [
              {
                translateX: reduceMotion
                  ? 0
                  : position.interpolate({ inputRange: [0, 1], outputRange: [-48, 72] }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const c = colors.light;
// Blanco de marca al 20 % para la pista que queda detrás del segmento de progreso.
const BLANCO_PISTA = 'rgba(255, 255, 255, 0.2)';
const styles = StyleSheet.create({
  track: {
    width: 120,
    height: 3,
    overflow: 'hidden',
    borderRadius: radius.full,
    backgroundColor: BLANCO_PISTA,
  },
  segment: { width: 48, height: 3, borderRadius: radius.full, backgroundColor: c.accent },
});
