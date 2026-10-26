import type { ReactNode } from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';
import { Card as DSCard, colors, radius, space } from '@quivo/design-system-native';
export type CardVariant =
  'surface' | 'soft' | 'brand' | 'glass' | 'accent' | 'outline' | 'elevated' | 'interactive';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export interface CardProps extends ViewProps {
  variant?: CardVariant;
  padding?: CardPadding;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}
const c = colors.light;
const pad = { none: 0, sm: space.sm, md: space.md, lg: space.lg };
export function Card({
  variant = 'surface',
  padding = 'md',
  header,
  footer,
  style,
  children,
  ...props
}: CardProps) {
  const mapped = variant === 'glass' || variant === 'interactive' ? 'surface' : variant;
  const override: ViewStyle = {
    borderRadius: radius.lg,
    padding: 0,
    backgroundColor:
      variant === 'glass'
        ? c.surfaceRaised
        : variant === 'surface' || variant === 'interactive'
          ? c.surfaceCard
          : undefined,
    borderColor:
      variant === 'glass' || variant === 'interactive' || variant === 'surface'
        ? c.borderSubtle
        : undefined,
  };
  return (
    <DSCard variant={mapped} style={[override, style]} {...props}>
      {header ? (
        <View
          style={{ padding: pad[padding], borderBottomWidth: 1, borderBottomColor: c.borderSubtle }}
        >
          {header}
        </View>
      ) : null}
      <View style={{ padding: pad[padding] }}>{children}</View>
      {footer ? (
        <View style={{ padding: pad[padding], borderTopWidth: 1, borderTopColor: c.borderSubtle }}>
          {footer}
        </View>
      ) : null}
    </DSCard>
  );
}
