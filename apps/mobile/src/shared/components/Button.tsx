import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'warning'
  | 'dark'
  | 'glass'
  | 'link';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps {
  children?: ReactNode;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  rounded?: boolean;
  elevated?: boolean;
  iconOnly?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  accessibilityHint?: string;
  style?: ViewStyle | ViewStyle[];
}

export function Button({
  children,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  rounded = false,
  elevated = false,
  iconOnly = false,
  leftIcon,
  rightIcon,
  accessibilityHint,
  style,
}: ButtonProps) {
  const bloqueado = disabled || loading;

  const buttonStyles: StyleProp<ViewStyle>[] = [
    styles.base,
    (styles[`variant_${variant}` as keyof typeof styles] as ViewStyle) || styles.variant_primary,
    (styles[`size_${size}` as keyof typeof styles] as ViewStyle) || styles.size_md,
    fullWidth && styles.fullWidth,
    rounded && styles.rounded,
    elevated && styles.elevated,
    iconOnly && styles.iconOnly,
    ...(Array.isArray(style) ? style : [style]),
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: bloqueado, busy: loading }}
      disabled={bloqueado}
      onPress={onPress}
      style={({ pressed }) => [
        ...buttonStyles,
        pressed && !bloqueado ? styles.pressed : null,
        bloqueado ? styles.disabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            ['secondary', 'outline', 'ghost'].includes(variant)
              ? quivoColors.primary
              : quivoColors.white
          }
        />
      ) : (
        <>
          {leftIcon}
          {children && (
            <Text
              style={[
                styles.label,
                (styles[`label_size_${size}` as keyof typeof styles] as TextStyle) || styles.label_size_md,
                (styles[`label_variant_${variant}` as keyof typeof styles] as TextStyle) ||
                  styles.label_variant_primary,
              ]}
            >
              {children}
            </Text>
          )}
          {rightIcon}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: quivoRadius.md,
    gap: quivoSpacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  rounded: {
    borderRadius: quivoRadius.pill,
  },
  elevated: {
    elevation: 4,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  iconOnly: {
    paddingHorizontal: 0,
    width: 52,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.5,
  },
  
  // Sizes
  size_xs: { minHeight: 32, paddingHorizontal: quivoSpacing.sm },
  size_sm: { minHeight: 40, paddingHorizontal: quivoSpacing.md },
  size_md: { minHeight: 52, paddingHorizontal: quivoSpacing.xl },
  size_lg: { minHeight: 60, paddingHorizontal: quivoSpacing.xxl },
  size_xl: { minHeight: 72, paddingHorizontal: quivoSpacing.xxxl },

  // Label sizes
  label_size_xs: { fontSize: 12 },
  label_size_sm: { fontSize: 14 },
  label_size_md: { fontSize: 15 },
  label_size_lg: { fontSize: 16 },
  label_size_xl: { fontSize: 18 },

  label: {
    fontFamily: quivoFonts.bodySemiBold,
  },

  // Variants (Button Background and Border)
  variant_primary: { backgroundColor: quivoColors.primary, borderColor: quivoColors.primary },
  variant_secondary: { backgroundColor: quivoColors.card, borderColor: quivoColors.primarySoft },
  variant_accent: { backgroundColor: quivoColors.accent, borderColor: quivoColors.accent },
  variant_outline: { backgroundColor: 'transparent', borderColor: quivoColors.border },
  variant_ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  variant_danger: { backgroundColor: quivoColors.danger, borderColor: quivoColors.danger },
  variant_success: { backgroundColor: quivoColors.success, borderColor: quivoColors.success },
  variant_warning: { backgroundColor: quivoColors.accent, borderColor: quivoColors.accent },
  variant_dark: { backgroundColor: quivoColors.text, borderColor: quivoColors.text },
  variant_glass: { backgroundColor: quivoColors.glassSurface, borderColor: quivoColors.glassBorder },
  variant_link: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 0, minHeight: 0 },

  // Variants (Text Color)
  label_variant_primary: { color: quivoColors.white },
  label_variant_secondary: { color: quivoColors.primary },
  label_variant_accent: { color: quivoColors.white },
  label_variant_outline: { color: quivoColors.text },
  label_variant_ghost: { color: quivoColors.primary },
  label_variant_danger: { color: quivoColors.white },
  label_variant_success: { color: quivoColors.white },
  label_variant_warning: { color: quivoColors.white },
  label_variant_dark: { color: quivoColors.white },
  label_variant_glass: { color: quivoColors.primary },
  label_variant_link: { color: quivoColors.primary, textDecorationLine: 'underline' },
});
