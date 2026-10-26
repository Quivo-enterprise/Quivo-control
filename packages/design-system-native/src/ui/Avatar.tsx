import { Image, Text, View, type ViewProps } from "react-native";
import { colors, fontSize, fontWeight, radius, type QuivoColors, type QuivoTheme } from "../tokens";

export type AvatarSize = "sm" | "md" | "lg" | "xl";
export type AvatarStatus = "online" | "busy" | "offline";

export type AvatarProps = ViewProps & {
  src?: string;
  name: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  theme?: QuivoTheme;
};

const SIZE_MAP: Record<AvatarSize, { box: number; font: number }> = {
  sm: { box: 32, font: fontSize.xs },
  md: { box: 44, font: fontSize.sm },
  lg: { box: 56, font: fontSize.md },
  xl: { box: 72, font: fontSize.lg },
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function statusColor(status: AvatarStatus, c: QuivoColors) {
  switch (status) {
    case "online":
      return c.success;
    case "busy":
      return c.warning;
    case "offline":
      return c.textMuted;
  }
}

/**
 * Person/entity avatar with an automatic initials fallback — pass `src` when
 * you have a photo, otherwise it renders `name`'s initials on a brand
 * gradient-like solid. Only set `status` for something the user is actively
 * monitoring (a driver's connection, a contact's presence); it adds a
 * corner dot, so don't use it just to add color variety.
 */
export function Avatar({ src, name, size = "md", status, theme = "light", style, ...props }: AvatarProps) {
  const c = colors[theme];
  const { box, font } = SIZE_MAP[size];

  return (
    <View
      style={[
        {
          width: box,
          height: box,
          borderRadius: radius.full,
          backgroundColor: c.primary,
          alignItems: "center",
          justifyContent: "center",
          overflow: "visible",
        },
        style,
      ]}
      accessibilityLabel={name}
      {...props}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: box, height: box, borderRadius: radius.full }} />
      ) : (
        <Text style={{ color: c.textInverse, fontSize: font, fontWeight: fontWeight.extrabold }}>{initials(name)}</Text>
      )}
      {status && (
        <View
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: box * 0.28,
            height: box * 0.28,
            borderRadius: radius.full,
            backgroundColor: statusColor(status, c),
            borderWidth: 2,
            borderColor: c.surfaceCard,
          }}
        />
      )}
    </View>
  );
}
