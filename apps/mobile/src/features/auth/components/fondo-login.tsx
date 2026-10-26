import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { dsColors } from '../../../shared/theme/design-system';

// Índigo noche derivado del primario QUIVO para preservar la lectura de los textos blancos.
const INDIGO_NOCHE = '#14113F';
type Variante = 'a' | 'b' | 'c';
type Mancha = {
  id: string;
  color: string;
  x: number;
  y: number;
  size: number;
  opacity: number;
  travel: number;
  duration: number;
  phase: number;
};
const indigo = dsColors.primaryStrong;
const naranja = dsColors.accent;
const variantes: Record<Variante, Mancha[]> = {
  a: [
    {
      id: 'indigo-1',
      color: indigo,
      x: 0.12,
      y: 0.2,
      size: 0.85,
      opacity: 0.38,
      travel: 12,
      duration: 18000,
      phase: 0,
    },
    {
      id: 'naranja',
      color: naranja,
      x: 0.9,
      y: 0.8,
      size: 0.45,
      opacity: 0.17,
      travel: 8,
      duration: 20000,
      phase: 0.4,
    },
  ],
  b: [
    {
      id: 'indigo-1',
      color: indigo,
      x: 0.12,
      y: 0.2,
      size: 0.85,
      opacity: 0.38,
      travel: 12,
      duration: 18000,
      phase: 0,
    },
    {
      id: 'naranja',
      color: naranja,
      x: 0.88,
      y: 0.77,
      size: 0.58,
      opacity: 0.24,
      travel: 8,
      duration: 20000,
      phase: 0.4,
    },
  ],
  c: [
    {
      id: 'indigo-1',
      color: indigo,
      x: 0.12,
      y: 0.2,
      size: 0.85,
      opacity: 0.38,
      travel: 18,
      duration: 16000,
      phase: 0,
    },
    {
      id: 'naranja',
      color: naranja,
      x: 0.9,
      y: 0.8,
      size: 0.45,
      opacity: 0.17,
      travel: 12,
      duration: 19000,
      phase: 0.4,
    },
    {
      id: 'indigo-2',
      color: indigo,
      x: 0.75,
      y: 0.48,
      size: 0.65,
      opacity: 0.24,
      travel: 16,
      duration: 17500,
      phase: 0.7,
    },
  ],
};

function ManchaAurora({
  mancha,
  width,
  height,
  reduceMotion,
}: {
  mancha: Mancha;
  width: number;
  height: number;
  reduceMotion: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const diameter = Math.max(width, height) * mancha.size;
  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: mancha.duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: mancha.duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [mancha.duration, progress, reduceMotion]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: diameter,
        height: diameter,
        left: width * mancha.x - diameter / 2,
        top: height * mancha.y - diameter / 2,
        opacity: mancha.opacity,
        transform: [
          {
            translateX: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-mancha.travel, mancha.travel],
            }),
          },
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [mancha.travel * mancha.phase, -mancha.travel],
            }),
          },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] }) },
        ],
      }}
    >
      <Svg width={diameter} height={diameter} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`brillo-${mancha.id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={mancha.color} stopOpacity="1" />
            <Stop offset="100%" stopColor={mancha.color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#brillo-${mancha.id})`} />
      </Svg>
    </Animated.View>
  );
}

export function FondoLogin({ variante = 'a' }: { variante?: Variante }) {
  const { width, height } = useWindowDimensions();
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
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="base-indigo" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={INDIGO_NOCHE} />
            <Stop offset="100%" stopColor={dsColors.primary} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#base-indigo)" />
      </Svg>
      {variantes[variante].map((mancha) => (
        <ManchaAurora
          key={mancha.id}
          mancha={mancha}
          width={width}
          height={height}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}
