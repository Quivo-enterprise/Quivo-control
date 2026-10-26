import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  Button as DSButton,
  Text,
  colors,
  elevation,
  fontSize,
  radius,
  space,
} from '@quivo/design-system-native';
import { quivoBubble } from '../theme/quivo-theme';

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
  textStyle?: TextStyle | TextStyle[];
}
const minHeight: Record<ButtonSize, number> = { xs: 44, sm: 44, md: 48, lg: 52, xl: 60 };
const textSize: Record<ButtonSize, number> = {
  xs: fontSize.sm,
  sm: fontSize.sm,
  md: fontSize.md,
  lg: fontSize.lg,
  xl: fontSize.xl,
};
const c = colors.light;

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
  textStyle,
}: ButtonProps) {
  const blocked = disabled || loading;
  const commonStyle = [
    styles.base,
    { minHeight: minHeight[size] },
    fullWidth && styles.fullWidth,
    rounded && styles.rounded,
    elevated && elevation(2),
    iconOnly && styles.iconOnly,
    style,
  ];
  const isPlainText = typeof children === 'string' || typeof children === 'number';
  if (isPlainText && !leftIcon && !rightIcon && !iconOnly && !textStyle && variant !== 'glass') {
    return (
      <DSButton
        accessibilityHint={accessibilityHint}
        disabled={disabled}
        loading={loading}
        onPress={onPress}
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        style={commonStyle}
      >
        {String(children)}
      </DSButton>
    );
  }
  const background =
    variant === 'glass'
      ? c.surfaceRaised
      : variant === 'accent'
        ? c.accent
        : variant === 'danger'
          ? c.danger
          : variant === 'success'
            ? c.success
            : variant === 'warning'
              ? c.warning
              : variant === 'dark'
                ? c.dark
                : variant === 'secondary'
                  ? c.primarySubtle
                  : variant === 'outline' || variant === 'ghost' || variant === 'link'
                    ? 'transparent'
                    : c.primary;
  const foreground = ['primary', 'danger', 'success', 'dark'].includes(variant)
    ? c.textInverse
    : variant === 'accent' || variant === 'warning'
      ? c.black
      : c.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        commonStyle,
        {
          backgroundColor: background,
          borderWidth: variant === 'outline' || variant === 'glass' ? 1 : 0,
          borderColor: variant === 'glass' ? c.borderSubtle : c.primaryText,
          opacity: blocked ? 0.65 : pressed ? 0.85 : 1,
        },
        // El `style` de quien llama gana sobre el color del variante (p. ej. borde `danger` en un outline).
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <>
          {leftIcon}
          {isPlainText ? (
            <Text
              weight="bold"
              style={[
                {
                  color: foreground,
                  fontSize: textSize[size],
                  textAlign: 'center',
                },
                textStyle,
              ]}
            >
              {children}
            </Text>
          ) : (
            children
          )}
          {rightIcon}
        </>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
  },
  fullWidth: { width: '100%' },
  rounded: { borderRadius: radius.full },
  iconOnly: { width: quivoBubble.touch, paddingHorizontal: 0 },
});
