import { Image, StyleSheet, Text as SystemText, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, colors, elevation, space } from '@quivo/design-system-native';
import { FondoLogin } from './fondo-login';
import { LineaProgreso, useReduceMotion } from './linea-progreso';
import { quivoBubble } from '../../../shared/theme/quivo-theme';
import logoWhite from '../../../../assets/images/logo-white.png';

interface PantallaCargaProps {
  label: string;
  error?: boolean;
}

export function PantallaCarga({ label, error = false }: PantallaCargaProps) {
  const reduceMotion = useReduceMotion();

  return (
    <View style={styles.container}>
      <FondoLogin variante="c" />
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeContent}>
        <StatusBar style="light" backgroundColor="transparent" />
        <View style={styles.content}>
          <View style={styles.logoArea}>
            <Image
              source={logoWhite}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel="QUIVO Control"
              style={styles.logo}
            />
            {!error ? (
              <View style={styles.progressArea}>
                <LineaProgreso reduceMotion={reduceMotion} />
                <Text size="sm" style={styles.label}>
                  {label}
                </Text>
              </View>
            ) : null}
          </View>
          {error ? (
            <View style={styles.errorArea} accessibilityRole="alert">
              <View style={styles.errorBubble}>
                <View style={styles.errorIcon}>
                  <Ionicons name="alert-circle" size={24} color={colors.light.danger} />
                </View>
                {/* En este caso fallaron las fuentes de marca; conserva la fuente del sistema. */}
                <SystemText style={styles.errorText}>{label}</SystemText>
              </View>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const c = colors.light;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.primaryStrong },
  safeContent: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  logoArea: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 280, height: 112 },
  progressArea: { alignItems: 'center', marginTop: space.lg, gap: space.md },
  label: { color: c.white, opacity: 0.8, textAlign: 'center' },
  errorArea: { width: '100%', marginTop: space.lg },
  errorBubble: {
    width: '100%',
    alignItems: 'center',
    gap: quivoBubble.gap,
    padding: space.lg,
    borderRadius: quivoBubble.radius,
    backgroundColor: c.surfaceRaised,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    ...elevation(3),
  },
  errorIcon: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: c.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { color: c.textPrimary, fontSize: 14, textAlign: 'center' },
});
