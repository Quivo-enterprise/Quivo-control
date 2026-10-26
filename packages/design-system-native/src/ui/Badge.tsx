import { Text, View, type ViewProps } from "react-native";
import { colors, fontSize, fontWeight, radius, space, type QuivoTheme } from "../tokens";

export type BadgeVariant = "primary" | "accent" | "success" | "warning" | "danger" | "neutral";
export type BadgeSize = "sm" | "md";

export type BadgeProps = ViewProps & {
  children: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  theme?: QuivoTheme;
};

function variantColors(variant: BadgeVariant, theme: QuivoTheme) {
  const c = colors[theme];
  switch (variant) {
    case "primary":
      return { background: c.primarySubtle, text: c.primaryText };
    case "accent":
      return { background: c.accentSoft, text: "#8a4f00" };
    case "success":
      return { background: c.successSoft, text: c.success };
    case "warning":
      return { background: c.warningSoft, text: "#92400e" };
    case "danger":
      return { background: c.dangerSoft, text: c.danger };
    case "neutral":
      return { background: c.surfaceSoft, text: c.textSecondary };
  }
}

/**
 * Small inline status/label pill — for a category tag or count, not for a
 * live status that changes (route state, connection status): those read
 * better as plain colored text next to an icon. Keep the label to 1-2 words;
 * it doesn't wrap.
 */
export function Badge({ children, variant = "primary", size = "md", theme = "light", style, ...props }: BadgeProps) {
  const { background, text } = variantColors(variant, theme);

  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          borderRadius: radius.full,
          backgroundColor: background,
          paddingVertical: size === "sm" ? 4 : 6,
          paddingHorizontal: size === "sm" ? space.sm : 10,
        },
        style,
      ]}
      {...props}
    >
      <Text style={{ color: text, fontSize: size === "sm" ? fontSize.xs : fontSize.sm, fontWeight: fontWeight.bold }}>
        {children}
      </Text>
    </View>
  );
}
