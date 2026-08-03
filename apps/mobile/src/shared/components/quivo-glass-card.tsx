import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { quivoColors, quivoRadius } from '../theme/quivo-theme';

interface QuivoGlassCardProps extends ViewProps {
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
}

/** Superficie flotante oficial para contenido colocado sobre mapas o imágenes. */
export function QuivoGlassCard({
  children,
  style,
  contentStyle,
  intensity = 64,
  ...props
}: QuivoGlassCardProps) {
  return (
    <View style={[styles.shadow, style]} {...props}>
      <BlurView intensity={intensity} tint="light" style={styles.blur}>
        <View style={[styles.surface, contentStyle]}>{children}</View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: quivoRadius.lg,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 9,
  },
  blur: {
    overflow: 'hidden',
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    borderColor: quivoColors.glassBorder,
  },
  surface: { backgroundColor: quivoColors.glassSurface },
});
