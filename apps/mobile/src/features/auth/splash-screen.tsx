import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import Svg, { Circle } from 'react-native-svg';
import { VectorLogo } from './components/vector-logo';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoSpacing } from '../../shared/theme/quivo-theme';

export interface SplashScreenProps {
  onLoadData: () => Promise<void>;
  onReady: () => void;
}

export function SplashScreen({ onLoadData, onReady }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<'verificando' | 'error'>('verificando');

  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, {
        duration: 1200,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [rotation]);

  const animatedSpinnerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });
  
  const AnimatedSvg = Animated.createAnimatedComponent(Svg);

  const checkConnectionAndData = async () => {
    const startTime = Date.now();
    setStatus('verificando');

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 5000);
    });

    try {
      await Promise.race([
        (async () => {
          const state = await NetInfo.fetch();
          
          if (!state.isConnected) {
            throw new Error('no_network');
          }
          await onLoadData();
        })(),
        timeoutPromise,
      ]);

      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 2500 - elapsed);

      setTimeout(() => {
        setTimeout(() => {
          onReady();
        }, 300);
      }, remainingTime);
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    void checkConnectionAndData();
  }, []);

  return (
    <Animated.View 
      style={styles.container} 
      exiting={FadeOut.duration(300)}
    >
      <LinearGradient
        colors={['#0F1B5C', '#1a2d7f']}
        style={[styles.gradient, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <Animated.View entering={FadeIn.duration(400)} style={styles.logoContainer}>
          <VectorLogo />
        </Animated.View>

        <View style={styles.contentContainer}>
          {status === 'verificando' ? (
            <>
              <View style={styles.spinnerWrapper}>
                <AnimatedSvg width="60" height="60" viewBox="0 0 100 100" style={animatedSpinnerStyle}>
                  <Circle cx="50" cy="50" r="40" stroke="#FD9E15" strokeWidth="12" fill="none" strokeDasharray="180 250" strokeLinecap="round" />
                </AnimatedSvg>
              </View>
              <Text style={styles.title}>Preparando tu jornada</Text>
              <Text style={styles.subtitle}>Verificando conexión y{'\n'}datos operativos</Text>
            </>
          ) : (
            <Animated.View entering={FadeIn}>
              <Text style={styles.title}>Error de conexión</Text>
              <Text style={styles.subtitle}>No pudimos verificar tus datos.{'\n'}Revisa tu conexión a internet.</Text>
              <Button
                variant="accent"
                size="lg"
                rounded
                elevated
                style={styles.retryButton}
                onPress={() => void checkConnectionAndData()}
              >
                Reintentar Conexión
              </Button>
            </Animated.View>
          )}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    width: '100%',
    marginBottom: quivoSpacing.xxxl * 2,
  },
  contentContainer: {
    alignItems: 'center',
    minHeight: 180,
    paddingHorizontal: quivoSpacing.xxl,
  },
  spinnerWrapper: {
    marginBottom: quivoSpacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    height: 60,
  },
  title: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 18,
    marginBottom: quivoSpacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    color: quivoColors.primarySoft,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: quivoSpacing.xxl,
    width: 220,
  },
});
