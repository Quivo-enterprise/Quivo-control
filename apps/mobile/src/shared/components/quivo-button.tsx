import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

type Variante = 'primary' | 'secondary' | 'danger';

interface QuivoButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variante;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function QuivoButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  accessibilityHint,
  style,
}: QuivoButtonProps) {
  const bloqueado = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: bloqueado, busy: loading }}
      disabled={bloqueado}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !bloqueado ? styles.pressed : null,
        bloqueado ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' ? quivoColors.primary : quivoColors.white}
        />
      ) : (
        <Text style={[styles.label, variant === 'secondary' ? styles.secondaryLabel : null]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: quivoRadius.md,
    paddingHorizontal: quivoSpacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primary: { backgroundColor: quivoColors.primary, borderColor: quivoColors.primary },
  secondary: { backgroundColor: quivoColors.card, borderColor: quivoColors.primarySoft },
  danger: { backgroundColor: quivoColors.danger, borderColor: quivoColors.danger },
  label: { color: quivoColors.white, fontFamily: quivoFonts.bodySemiBold, fontSize: 15 },
  secondaryLabel: { color: quivoColors.primary },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
});
