import { Text, View, type ViewProps } from "react-native";
import { colors, fontSize, space, type QuivoTheme } from "../tokens";

export type DividerProps = ViewProps & {
  orientation?: "horizontal" | "vertical";
  label?: string;
  theme?: QuivoTheme;
};

/**
 * Thin separator line between sections or list items. Only pass `label` for
 * a horizontal divider (e.g. "O continúa con") — it's ignored for vertical
 * ones, which are for separating inline items in a `Row`/toolbar and need an
 * explicit `height` from the parent since they can't infer one on their own.
 */
export function Divider({ orientation = "horizontal", label, theme = "light", style, ...props }: DividerProps) {
  const c = colors[theme];

  if (orientation === "vertical") {
    return <View style={[{ width: 1, backgroundColor: c.borderSubtle }, style]} {...props} />;
  }

  if (!label) {
    return <View style={[{ height: 1, backgroundColor: c.borderSubtle }, style]} {...props} />;
  }

  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: space.sm }, style]} {...props}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.borderSubtle }} />
      <Text style={{ color: c.textMuted, fontSize: fontSize.xs }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.borderSubtle }} />
    </View>
  );
}
