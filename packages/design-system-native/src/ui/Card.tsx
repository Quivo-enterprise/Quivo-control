import { View, type ViewProps } from "react-native";
import { colors, elevation, radius, space, type QuivoTheme } from "../tokens";

export type CardVariant = "surface" | "soft" | "brand" | "accent" | "outline" | "elevated";
export type CardPadding = "none" | "sm" | "md" | "lg";

export type CardProps = ViewProps & {
  variant?: CardVariant;
  padding?: CardPadding;
  theme?: QuivoTheme;
};

const PADDING_MAP: Record<CardPadding, number> = {
  none: 0,
  sm: space.md,
  md: space.lg,
  lg: space.xl,
};

function variantStyle(variant: CardVariant, theme: QuivoTheme) {
  const c = colors[theme];
  switch (variant) {
    case "surface":
      return { backgroundColor: c.surfaceCard, borderColor: c.borderSubtle };
    case "soft":
      return { backgroundColor: c.surfaceSoft, borderColor: "transparent" };
    case "brand":
      return { backgroundColor: c.dark, borderColor: "rgba(255, 255, 255, 0.14)" };
    case "accent":
      return { backgroundColor: "rgba(253, 158, 21, 0.1)", borderColor: "rgba(253, 158, 21, 0.22)" };
    case "outline":
      return { backgroundColor: "transparent", borderColor: c.borderStrong };
    case "elevated":
      return { backgroundColor: c.surfaceCard, borderColor: "transparent" };
  }
}

/**
 * Generic content container. `surface`/`soft` for ordinary grouped content,
 * `elevated` when it needs to visually float above the page (a modal-like
 * panel that isn't actually a modal), `outline` for a lower-emphasis
 * grouping that shouldn't compete with a nearby `elevated` card, and
 * `brand`/`accent` for callouts. It has no built-in press/tap behavior —
 * wrap it in a `Pressable` yourself if the whole card should be tappable.
 */
export function Card({ variant = "surface", padding = "md", theme = "light", style, children, ...props }: CardProps) {
  const { backgroundColor, borderColor } = variantStyle(variant, theme);

  return (
    <View
      style={[
        {
          borderRadius: radius.md,
          borderWidth: variant === "outline" || borderColor !== "transparent" ? 1 : 0,
          padding: PADDING_MAP[padding],
          backgroundColor,
          borderColor,
          overflow: "hidden",
        },
        variant === "elevated" ? elevation(1) : null,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
