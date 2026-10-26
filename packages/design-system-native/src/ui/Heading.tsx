import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { colors, fontSize, fontStyle, fontWeight, type QuivoTheme } from "../tokens";

export type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type HeadingSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";

export type HeadingProps = RNTextProps & {
  level?: HeadingLevel;
  size?: HeadingSize;
  theme?: QuivoTheme;
};

const SIZE_MAP: Record<HeadingLevel, HeadingSize> = {
  h1: "3xl",
  h2: "2xl",
  h3: "xl",
  h4: "lg",
  h5: "md",
  h6: "sm",
};

/** Renders as bold display-font text; `level` only picks the default size (no semantic HTML tag on native). */
export function Heading({ level = "h2", size, theme = "light", style, children, ...props }: HeadingProps) {
  const headingSize = size ?? SIZE_MAP[level];

  return (
    <RNText
      accessibilityRole="header"
      style={[
        {
          fontSize: fontSize[headingSize],
          ...fontStyle("display", fontWeight.bold),
          color: colors[theme].textPrimary,
          lineHeight: fontSize[headingSize] * 1.15,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}
