import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet } from 'react-native';
import logoWhite from '../../../../assets/images/logo-white.png';

export function VectorLogo({
  checking,
  reduceMotion,
}: {
  checking: boolean;
  reduceMotion: boolean;
}) {
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.92)).current;
  const breathing = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    opacity.stopAnimation();
    scale.stopAnimation();
    if (reduceMotion) {
      opacity.setValue(1);
      scale.setValue(1);
      return;
    }
    const entrance = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [opacity, reduceMotion, scale]);

  useEffect(() => {
    breathing.stopAnimation();
    breathing.setValue(1);
    if (!checking || reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathing, { toValue: 0.85, duration: 1000, useNativeDriver: true }),
        Animated.timing(breathing, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      breathing.setValue(1);
    };
  }, [breathing, checking, reduceMotion]);

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="QUIVO Control"
      style={[
        styles.container,
        { opacity: Animated.multiply(opacity, breathing), transform: [{ scale }] },
      ]}
    >
      {/* El PNG aprobado para el login evita transformaciones SVG que fallan en Android. */}
      <Image source={logoWhite} resizeMode="contain" style={styles.logo} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 280, height: 112 },
});
