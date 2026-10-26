import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Heading, Text, Loader, colors, space, fontSize } from '@quivo/design-system-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { VectorLogo } from './components/vector-logo';
import { Button } from '../../shared/components/Button';

export interface SplashScreenProps {
  onLoadData: () => Promise<void>;
  onReady: () => void;
}

export function SplashScreen({ onLoadData, onReady }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  // 'sin_conexion' es SOLO para cuando `NetInfo.fetch()` confirmó que no hay red — nunca para
  // una restauración de sesión lenta (ver el motivo del estado 'tardanza' más abajo).
  const [status, setStatus] = useState<'verificando' | 'sin_conexion' | 'tardanza'>('verificando');

  const checkConnectionAndData = async () => {
    const startTime = Date.now();
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

      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 2500 - elapsed);

      setTimeout(() => {
        setTimeout(() => {
          onReady();
        }, 300);
      }, remainingTime);
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
    <Animated.View style={styles.container} exiting={FadeOut.duration(300)}>
      <LinearGradient
        colors={[colors.light.dark, colors.light.primary]}
        style={[styles.gradient, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <Animated.View entering={FadeIn.duration(400)} style={styles.logoContainer}>
          <VectorLogo />
        </Animated.View>

        <View style={styles.contentContainer}>
          {status === 'verificando' ? (
            <>
              <View style={styles.spinnerWrapper}>
                <Loader size="lg" tone="accent" />
              </View>
              <Heading size="xl" style={styles.title}>
                Preparando tu jornada
              </Heading>
              <Text style={styles.subtitle}>Verificando conexión y{'\n'}datos operativos</Text>
            </>
          ) : (
            <Animated.View entering={FadeIn}>
              {status === 'sin_conexion' ? (
                <>
                  <Heading size="xl" style={styles.title}>
                    Error de conexión
                  </Heading>
                  <Text style={styles.subtitle}>
                    No pudimos verificar tus datos.{'\n'}Revisa tu conexión a internet.
                  </Text>
                </>
              ) : (
                <>
                  <Heading size="xl" style={styles.title}>
                    Esto está tardando
                  </Heading>
                  <Text style={styles.subtitle}>
                    Preparar tu sesión está tardando más de lo esperado.{'\n'}Puedes reintentar.
                  </Text>
                </>
              )}
              <Button
                variant="accent"
                size="lg"
                rounded
                elevated
                style={styles.retryButton}
                onPress={() => void checkConnectionAndData()}
              >
                {status === 'sin_conexion' ? 'Reintentar' : 'Reintentar'}
              </Button>
            </Animated.View>
          )}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const c = colors.light;
const styles = StyleSheet.create({
  container: { flex: 1, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
  gradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    width: '100%',
    marginBottom: space['2xl'] * 2,
  },
  contentContainer: { alignItems: 'center', minHeight: 180, paddingHorizontal: space.xl },
  spinnerWrapper: {
    marginBottom: space.lg,
    justifyContent: 'center',
    alignItems: 'center',
    height: 60,
  },
  title: { color: c.textInverse, marginBottom: space.sm, textAlign: 'center' },
  subtitle: { color: c.textInverse, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 22 },
  retryButton: { marginTop: space.xl, width: 220, minHeight: 48 },
});
