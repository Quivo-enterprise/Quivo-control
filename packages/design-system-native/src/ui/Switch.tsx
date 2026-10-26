import type { ReactElement } from "react";
import { Switch as RNSwitch, Text, View, type SwitchProps as RNSwitchProps } from "react-native";
import { colors, fontSize, fontStyle, fontWeight, space, type QuivoTheme } from "../tokens";

export type SwitchProps = Omit<RNSwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor"> & {
  label?: string;
  description?: string;
  theme?: QuivoTheme;
};

/**
 * Boolean on/off control for a settings-style toggle (not for submitting a
 * choice — use that pattern with a `Button` instead). Always controlled:
 * pass `value` + `onValueChange`, there's no internal state. Reach for
 * `Switch` over a checkbox-style control whenever the effect is immediate
 * (toggling a preference), not deferred to a form submit.
 *
 * Note: on the Expo Web target, `react-native-web`'s `Switch` polyfill only
 * partially honors `thumbColor` (it can render the browser's native
 * checkbox accent instead) — this renders correctly on iOS/Android, so
 * don't "fix" the colors based on what the web preview shows.
 */
export function Switch({ label, description, theme = "light", disabled, ...props }: SwitchProps): ReactElement {
  const c = colors[theme];

  const control = (
    <RNSwitch
      disabled={disabled}
      trackColor={{ false: c.borderStrong, true: c.primary }}
      thumbColor={c.white}
      ios_backgroundColor={c.borderStrong}
      {...props}
    />
  );

  if (!label && !description) return control;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, opacity: disabled ? 0.55 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        {label && <Text style={{ color: c.textPrimary, fontSize: fontSize.sm, ...fontStyle("body", fontWeight.bold) }}>{label}</Text>}
        {description && <Text style={{ color: c.textSecondary, fontSize: fontSize.xs, ...fontStyle("body") }}>{description}</Text>}
      </View>
      {control}
    </View>
  );
}
