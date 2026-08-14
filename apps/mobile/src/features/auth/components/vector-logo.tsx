import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  interpolate,
  Easing,
} from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

// Paths oficiales extraídos
const PATH_Q = "M162,53 L29,187 L29,698 L162,832 L449,833 L607,988 L723,871 L625,769 L693,699 L693,186 L560,53 Z M257,217 L466,217 L507,257 L507,627 L467,667 L255,667 L215,626 L215,258 Z";
const PATH_U = "M778,53 L778,695 L917,832 L1283,831 L1420,694 L1420,53 L1235,53 L1235,625 L1190,668 L1003,667 L964,628 L963,53 Z";
const PATH_I = "M1507,52 L1504,830 L1689,832 L1690,54 Z";
const PATH_V = "M1758,52 L2032,830 L2202,832 L2479,53 L2287,53 L2117,572 L1950,55 Z";
const PATH_O = "M2623,53 L2490,186 L2490,699 L2623,832 L3022,831 L3154,699 L3154,186 L3021,53 Z M2717,217 L2926,217 L2968,259 L2968,627 L2928,667 L2719,668 L2676,627 L2675,260 Z";

export function VectorLogo() {
  // --- TIMELINE SHARED VALUES ---

  // Fase 1: Aparición global
  const appearProgress = useSharedValue(0);

  // Fase 3: Retiro
  const iProgress = useSharedValue(0);
  const uProgress = useSharedValue(0);
  const vProgress = useSharedValue(0);

  // Fase 4: Convergencia
  const qProgress = useSharedValue(0);
  const oProgress = useSharedValue(0);

  // Fase 5: Ensamble (Overshoot)
  const groupScale = useSharedValue(1);

  useEffect(() => {
    // === EJECUCIÓN DEL TIMELINE (Exactamente 2.4s totales) ===
    
    // FASE 1: Aparición (0.00s a 0.45s)
    appearProgress.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) });

    // FASE 3: Retiro de U, I, V
    // I: Inicia a 0.85s (850ms)
    iProgress.value = withDelay(850, withTiming(1, { duration: 350, easing: Easing.in(Easing.quad) }));
    // U: Inicia a 0.90s (900ms)
    uProgress.value = withDelay(900, withTiming(1, { duration: 350, easing: Easing.in(Easing.quad) }));
    // V: Inicia a 0.95s (950ms)
    vProgress.value = withDelay(950, withTiming(1, { duration: 350, easing: Easing.in(Easing.quad) }));

    // FASE 4: Convergencia de Q y O
    // Q viaja a la derecha desde 1.00s
    qProgress.value = withDelay(1000, withTiming(1, { duration: 750, easing: Easing.inOut(Easing.cubic) }));
    // O viaja a la izquierda desde 1.03s (1030ms)
    oProgress.value = withDelay(1030, withTiming(1, { duration: 720, easing: Easing.inOut(Easing.cubic) }));

    // FASE 5: Ensamble Final Overshoot (1.70s)
    groupScale.value = withDelay(
      1700,
      withSequence(
        withTiming(1.025, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 200, easing: Easing.elastic(1) })
      )
    );
  }, []);

  // --- ANIMATED STYLES / PROPS ---

  const containerStyle = useAnimatedProps(() => {
    return {
      opacity: appearProgress.value,
      transform: [
        { translateY: interpolate(appearProgress.value, [0, 1], [20, 0]) }, // Aparición
        { scale: interpolate(appearProgress.value, [0, 1], [0.96, 1]) },
      ],
    };
  });

  // Retiro: U, I, V
  const iProps = useAnimatedProps(() => ({
    opacity: interpolate(iProgress.value, [0, 1], [1, 0]),
    transform: [
      { translateX: interpolate(iProgress.value, [0, 1], [0, 0]) },
      { translateY: interpolate(iProgress.value, [0, 1], [0, 20]) }, // Cae ligeramente en vez de blur
      { scale: interpolate(iProgress.value, [0, 1], [1, 0.84]) },
    ],
  }));

  const uProps = useAnimatedProps(() => ({
    opacity: interpolate(uProgress.value, [0, 1], [1, 0]),
    transform: [
      { translateX: interpolate(uProgress.value, [0, 1], [0, 30]) },
      { translateY: interpolate(uProgress.value, [0, 1], [0, 15]) },
      { scale: interpolate(uProgress.value, [0, 1], [1, 0.84]) },
    ],
  }));

  const vProps = useAnimatedProps(() => ({
    opacity: interpolate(vProgress.value, [0, 1], [1, 0]),
    transform: [
      { translateX: interpolate(vProgress.value, [0, 1], [0, -30]) },
      { translateY: interpolate(vProgress.value, [0, 1], [0, 15]) },
      { scale: interpolate(vProgress.value, [0, 1], [1, 0.84]) },
    ],
  }));

  // Convergencia: Q y O
  const qGroupProps = useAnimatedProps(() => ({
    transform: [{ translateX: interpolate(qProgress.value, [0, 1], [0, 877]) }],
  }));

  const oGroupProps = useAnimatedProps(() => ({
    transform: [{ translateX: interpolate(oProgress.value, [0, 1], [0, -883]) }],
  }));

  const qoGroupProps = useAnimatedProps(() => ({
    transform: [{ scale: groupScale.value }],
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <Svg viewBox="0 0 3179 1013" style={styles.svg}>
        
        {/* Letras que se retiran. Origin ajustado para su centro aproximado. */}
        <AnimatedG origin="1100, 416" animatedProps={uProps}>
          <Path d={PATH_U} fill="#FD9E15" />
        </AnimatedG>
        <AnimatedG origin="1597, 416" animatedProps={iProps}>
          <Path d={PATH_I} fill="#FD9E15" />
        </AnimatedG>
        <AnimatedG origin="2118, 416" animatedProps={vProps}>
          <Path d={PATH_V} fill="#FD9E15" />
        </AnimatedG>

        {/* Grupo Final QO */}
        <AnimatedG origin="1589, 416" animatedProps={qoGroupProps}>
          <AnimatedG animatedProps={qGroupProps}>
            <AnimatedPath d={PATH_Q} fillRule="evenodd" fill="#FD9E15" />
          </AnimatedG>
          <AnimatedG animatedProps={oGroupProps}>
            <AnimatedPath d={PATH_O} fillRule="evenodd" fill="#FD9E15" />
          </AnimatedG>
        </AnimatedG>
        
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    width: 280,
    height: 150,
  },
});
