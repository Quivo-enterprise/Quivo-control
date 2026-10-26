import { useState, type ReactNode } from "react";
import { Text as RNText, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { colors, fontSize, fontStyle, fontWeight, radius, space, type QuivoTheme } from "../tokens";

export type InputControlSize = "sm" | "md" | "lg";

export type InputProps = TextInputProps & {
  label?: string;
  helperText?: string;
  error?: string;
  controlSize?: InputControlSize;
  fullWidth?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  theme?: QuivoTheme;
};

const SIZE_CONFIG: Record<InputControlSize, { minHeight: number; fontSize: number }> = {
  sm: { minHeight: 36, fontSize: fontSize.xs },
  md: { minHeight: 44, fontSize: fontSize.sm },
  lg: { minHeight: 52, fontSize: fontSize.md },
};

/**
 * Single-line text field with an attached label/helper/error, mirroring the
 * web `Input`. Pass `error` to show a validation message and switch the
 * border to the danger color — don't render your own error text below it,
 * that's what `error` is for. Use `leftSlot`/`rightSlot` for a fixed icon or
 * a unit ("Bs.", "@"), not for interactive controls (those need their own
 * hit target, which these slots don't provide).
 */
export function Input({
  label,
  helperText,
  error,
  controlSize = "md",
  fullWidth = true,
  leftSlot,
  rightSlot,
  theme = "light",
  style,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const c = colors[theme];
  const sizing = SIZE_CONFIG[controlSize];
  const borderColor = error ? c.danger : focused ? c.primary : c.borderSubtle;

  const containerStyle: ViewStyle = {
    alignSelf: fullWidth ? "stretch" : "flex-start",
    gap: 6,
  };

  return (
    <View style={containerStyle}>
      {label && <RNText style={{ color: c.textPrimary, fontSize: fontSize.sm, ...fontStyle("body", fontWeight.bold) }}>{label}</RNText>}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: sizing.minHeight,
          paddingHorizontal: space.ms,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor,
          backgroundColor: c.surfaceCard,
        }}
      >
        {leftSlot}
        <TextInput
          style={[{ flex: 1, fontSize: sizing.fontSize, color: c.textPrimary, padding: 0, ...fontStyle("body") }, style]}
          placeholderTextColor={c.textTertiary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {rightSlot}
      </View>
      {error ? (
        <RNText style={{ color: c.danger, fontSize: fontSize.xs, ...fontStyle("body") }}>{error}</RNText>
      ) : helperText ? (
        <RNText style={{ color: c.textTertiary, fontSize: fontSize.xs, ...fontStyle("body") }}>{helperText}</RNText>
      ) : null}
    </View>
  );
}
