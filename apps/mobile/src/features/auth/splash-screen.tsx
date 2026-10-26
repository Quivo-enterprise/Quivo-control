import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Heading, Text, colors, fontStyle, space } from '@quivo/design-system-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { VectorLogo } from './components/vector-logo';
import { FondoLogin } from './components/fondo-login';
import { Burbuja } from '../../shared/components/burbuja';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { LineaProgreso, useReduceMotion } from './components/linea-progreso';

export interface SplashScreenProps {
  onLoadData: () => Promise<void>;
  onReady: () => void;
}

export function SplashScreen({ onLoadData, onReady }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  // 'sin_conexion' es SOLO para cuando `NetInfo.fetch()` confirmó que no hay red — nunca para
  // una restauración de sesión lenta (ver el motivo del estado 'tardanza' más abajo).
  const [status, setStatus] = useState<'verificando' | 'sin_conexion' | 'tardanza'>('verificando');
  const [showCaption, setShowCaption] = useState(false);
  const [verificationDone, setVerificationDone] = useState(false);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (status !== 'verificando' || verificationDone) {
      setShowCaption(false);
      return;
    }
    const timer = setTimeout(() => setShowCaption(true), 800);
    return () => clearTimeout(timer);
  }, [status, verificationDone]);

  const checkConnectionAndData = async () => {
    const startTime = Date.now();
    setVerificationDone(false);
    setStatus('verificando');

    // Cota de seguridad real, no estética: `onLoadData` (= `esperarRestauracion()` en App.tsx)
    // espera a que termine la restauración de sesión (`obtenerDeviceIdMovil()` +
    // `cargarSesionMovil()` contra SecureStore/Android Keystore), que no hace ningún request de
    // red. Sin esta cota, un fallo real ahí (Keystore colgado, no una lentitud normal) dejaría
    // al conductor mirando el spinner para siempre. Por eso, si esto dispara, el mensaje de
    // abajo JAMÁS dice "revisá tu conexión" — sólo lo decimos cuando `NetInfo.fetch()` confirmó
    // que no hay red (ver el catch). Si fue este timeout, avisamos que tardó y dejamos
    // reintentar: gracias al fix del cleanup en App.tsx, `esperarRestauracion()` ya resuelve
    // bien la transición de etapa, así que un reintento que llega después de que la
    // restauración terminó resuelve al toque (no vuelve a esperar 5s).
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

      setVerificationDone(true);
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 900 - elapsed);

      setTimeout(onReady, remainingTime);
    } catch (error) {
      // Sólo 'no_network' viene de una verificación real de conectividad (`NetInfo.fetch()`).
      // Cualquier otra causa —el timeout de arriba, o un error inesperado dentro de
      // `onLoadData`— NO es evidencia de que falle la red: no le mentimos al conductor.
      setStatus(
        error instanceof Error && error.message === 'no_network' ? 'sin_conexion' : 'tardanza',
      );
    }
  };

  useEffect(() => {
    void checkConnectionAndData();
  }, []);

  return (
    <Animated.View style={styles.container} exiting={FadeOut.duration(200)}>
      <FondoLogin variante="c" />
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.logoArea}>
          <VectorLogo checking={status === 'verificando'} reduceMotion={reduceMotion} />
          {status === 'verificando' && (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.progressArea}>
              <LineaProgreso reduceMotion={reduceMotion} />
              {showCaption && (
                <Animated.View entering={FadeIn.duration(200)}>
                  <Text size="sm" style={styles.caption}>
                    Preparando tu jornada
                  </Text>
                </Animated.View>
              )}
            </Animated.View>
          )}
        </View>
        {status !== 'verificando' && (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.errorArea}>
            <View accessibilityRole="alert">
              <Burbuja direction="column" style={styles.errorBubble}>
                <View style={styles.errorIcon}>
                  <Ionicons
                    name={status === 'sin_conexion' ? 'cloud-offline-outline' : 'time-outline'}
                    size={24}
                    color={colors.light.primaryText}
                  />
                </View>
                <Heading size="md" style={styles.errorTitle}>
                  {status === 'sin_conexion' ? 'Sin conexión' : 'Esto está tardando'}
                </Heading>
                <Text size="sm" variant="secondary" style={styles.errorMessage}>
                  {status === 'sin_conexion'
                    ? 'No pudimos verificar tus datos. Revisa tu conexión a internet.'
                    : 'Preparar tu sesión está tardando más de lo esperado. Puedes reintentar.'}
                </Text>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  style={styles.retryButton}
                  onPress={() => void checkConnectionAndData()}
                >
                  Reintentar
                </Button>
              </Burbuja>
            </View>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const c = colors.light;
const styles = StyleSheet.create({
  container: { flex: 1, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoArea: { alignItems: 'center', justifyContent: 'center', minHeight: 180 },
  progressArea: { alignItems: 'center', marginTop: space.lg, minHeight: 48 },
  caption: {
    marginTop: space.md,
    color: c.white,
    opacity: 0.8,
    textAlign: 'center',
    ...fontStyle('body', '500'),
  },
  errorArea: { position: 'absolute', top: '60%', left: quivoBubble.edge, right: quivoBubble.edge },
  errorBubble: { width: '100%', padding: space.lg },
  errorIcon: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: c.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: { textAlign: 'center' },
  errorMessage: { textAlign: 'center' },
  retryButton: { minHeight: 52, borderRadius: quivoBubble.innerRadius, marginTop: space.sm },
});
