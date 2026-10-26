import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { colors, fontSize, fontWeight, type QuivoTheme } from "../tokens";

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
export type TextWeight = "regular" | "medium" | "semibold" | "bold";
export type TextVariant = "primary" | "secondary" | "muted" | "inverse" | "error" | "success" | "warning";

export type TextProps = RNTextProps & {
  size?: TextSize;
  weight?: TextWeight;
  variant?: TextVariant;
  theme?: QuivoTheme;
};

const WEIGHT_MAP: Record<TextWeight, TextStyle["fontWeight"]> = {
  regular: fontWeight.normal,
  medium: fontWeight.medium,
  semibold: fontWeight.semibold,
  bold: fontWeight.bold,
};

function variantColor(variant: TextVariant, theme: QuivoTheme) {
  const c = colors[theme];
  switch (variant) {
    case "primary":
      return c.textPrimary;
    case "secondary":
      return c.textSecondary;
    case "muted":
      return c.textMuted;
    case "inverse":
      return c.textInverse;
    case "error":
      return c.danger;
    case "success":
      return c.success;
    case "warning":
      return c.warning;
  }
}

/**
 * Body/caption text. Use `variant` for semantic color (`error`/`success`/
 * `warning` for status messages, `secondary`/`muted` for de-emphasized
 * copy) rather than hardcoding a color — that's what keeps light/dark theme
 * support automatic. For page/section titles use `Heading` instead, which
 * uses the display font.
 */
export function Text({
  size = "md",
  weight = "regular",
  variant = "primary",
  theme = "light",
  style,
  children,
  ...props
}: TextProps) {
  return (
    <RNText
      style={[
        {
          fontSize: fontSize[size],
          fontWeight: WEIGHT_MAP[weight],
          color: variantColor(variant, theme),
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}
