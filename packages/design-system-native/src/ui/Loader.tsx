import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";
import { colors, type QuivoTheme } from "../tokens";

export type LoaderSize = "sm" | "md" | "lg";
export type LoaderTone = "primary" | "accent" | "inverse";

export type LoaderProps = Omit<ActivityIndicatorProps, "size" | "color"> & {
  size?: LoaderSize;
  tone?: LoaderTone;
  theme?: QuivoTheme;
};

const SIZE_MAP: Record<LoaderSize, ActivityIndicatorProps["size"]> = {
  sm: "small",
  md: "small",
  lg: "large",
};

function toneColor(tone: LoaderTone, theme: QuivoTheme) {
  const c = colors[theme];
  switch (tone) {
    case "primary":
      return c.primary;
    case "accent":
      return c.accent;
    case "inverse":
      return c.textInverse;
  }
}

/**
 * Inline loading spinner for a button/small area — for a full-screen loading
 * state use a dedicated loading screen instead of centering this alone on
 * the page, since it carries no message or branding by itself.
 */
export function Loader({ size = "md", tone = "primary", theme = "light", ...props }: LoaderProps) {
  return <ActivityIndicator size={SIZE_MAP[size]} color={toneColor(tone, theme)} {...props} />;
}
