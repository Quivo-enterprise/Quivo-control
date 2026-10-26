import { ActivityIndicator, Pressable, Text, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { colors, elevation, fontSize, fontStyle, fontWeight, radius, space, type QuivoTheme } from "../tokens";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "outline"
  | "ghost"
  | "danger"
  | "success"
  | "warning"
  | "dark"
  | "link";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

export type ButtonProps = Omit<PressableProps, "children"> & {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  theme?: QuivoTheme;
  style?: StyleProp<ViewStyle>;
};

const SIZE_CONFIG: Record<ButtonSize, { paddingV: number; paddingH: number; fontSize: number; minHeight: number }> = {
  xs: { paddingV: 6, paddingH: 10, fontSize: fontSize.xs, minHeight: 29 },
  sm: { paddingV: 9, paddingH: 14, fontSize: fontSize.xs, minHeight: 36 },
  md: { paddingV: 12, paddingH: 18, fontSize: fontSize.sm, minHeight: 44 },
  lg: { paddingV: 14, paddingH: 24, fontSize: fontSize.md, minHeight: 52 },
  xl: { paddingV: 16, paddingH: 30, fontSize: fontSize.lg, minHeight: 60 },
};

function variantColors(variant: ButtonVariant, theme: QuivoTheme) {
  const c = colors[theme];
  switch (variant) {
    case "primary":
      return { background: c.primary, text: c.textOnPrimary, border: "transparent" };
    case "secondary":
      return { background: c.primarySubtle, text: c.primaryText, border: c.primarySoft };
    case "accent":
      return { background: c.accent, text: c.black, border: "transparent" };
    case "outline":
      return { background: "transparent", text: c.primaryText, border: c.primaryText };
    case "ghost":
      return { background: "transparent", text: c.primaryText, border: "transparent" };
    case "danger":
      return { background: c.danger, text: c.textInverse, border: "transparent" };
    case "success":
      return { background: c.success, text: c.textInverse, border: "transparent" };
    case "warning":
      return { background: c.warning, text: c.black, border: "transparent" };
    case "dark":
      return { background: c.dark, text: c.textInverse, border: "transparent" };
    case "link":
      return { background: "transparent", text: c.primaryText, border: "transparent" };
  }
}

/**
 * Primary tappable action, mirroring the web `Button`'s variant/size API.
 * Reach for `primary`/`accent` for the main call-to-action on a screen
 * (only one per screen, ideally), `secondary`/`outline`/`ghost` for
 * lower-emphasis actions, and `link` when it should read as inline text
 * rather than a button. Always pass the same `theme` the surrounding screen
 * uses — this component doesn't read theme from context.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  theme = "light",
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const sizing = SIZE_CONFIG[size];
  const { background, text, border } = variantColors(variant, theme);
  const isElevated = variant === "primary" || variant === "accent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm,
          minHeight: variant === "link" ? undefined : sizing.minHeight,
          paddingVertical: variant === "link" ? 0 : sizing.paddingV,
          paddingHorizontal: variant === "link" ? 0 : sizing.paddingH,
          borderRadius: radius.full,
          backgroundColor: background,
          borderWidth: border === "transparent" ? 0 : 1,
          borderColor: border,
          opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          width: fullWidth ? "100%" : undefined,
        },
        isElevated && !isDisabled ? elevation(2) : null,
        style,
      ]}
      {...props}
    >
      {loading && <ActivityIndicator size="small" color={text} />}
      <Text
        style={{
          color: text,
          fontSize: sizing.fontSize,
          ...fontStyle("body", fontWeight.bold),
          textDecorationLine: variant === "link" ? "underline" : "none",
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
